/**
 * Donde viven los videos que sube el gimnasio.
 *
 * Tres decisiones, y las tres se ven en la forma de este archivo:
 *
 *  1. **el archivo NO pasa por la api.** Se firma una URL y el telefono sube
 *     directo al bucket. Meter 200 MB por un proceso de Cloud Run con 512 MiB y
 *     30s de timeout es la forma conocida de tumbar la api con una sola subida,
 *     y encima se pagaria el trafico dos veces;
 *
 *  2. **el objeto es PRIVADO y se sirve firmado.** Es lo que el enlace de
 *     YouTube nunca pudo dar: un video oculto de YouTube lo ve cualquiera que
 *     tenga la direccion, y aqui la direccion caduca y solo la firma la api para
 *     quien pasa `checkRoutineAccess`. El contenido de alumnos pasa a ser
 *     exclusivo de verdad;
 *
 *  3. **es opcional.** Sin `VIDEO_BUCKET` la biblioteca funciona entera con
 *     enlaces y subir queda apagado con un mensaje que lo dice. Un despliegue
 *     sin bucket degrada, no rompe — que es lo que hace falta para poder soltar
 *     esto antes de haber creado la infraestructura.
 *
 * La interfaz existe para que el e2e pueda inyectar una implementacion falsa,
 * igual que se hace con `FirebaseVerifier`: probar la subida de verdad exigiria
 * un bucket real en CI.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Storage, type Bucket } from '@google-cloud/storage';
import { VIDEO_MAX_BYTES, type VideoContentType } from '@sinchi/shared';
import { loadEnv } from '../../config/env';

export interface SignedUpload {
  readonly url: string;
  /**
   * Cabeceras que el telefono DEBE mandar tal cual.
   *
   * Van firmadas, asi que no son una sugerencia: `x-goog-content-length-range`
   * hace que el propio almacenamiento rechace un archivo mas grande que el tope.
   * Sin eso, el tope seria una comprobacion del cliente — es decir, ninguna.
   */
  readonly headers: Record<string, string>;
  readonly expiresInSeconds: number;
}

export abstract class VideoStorage {
  /** `false` cuando no hay bucket configurado: subir queda apagado. */
  abstract readonly enabled: boolean;
  abstract signUpload(input: {
    readonly objectPath: string;
    readonly contentType: VideoContentType;
  }): Promise<SignedUpload>;
  /** URL de lectura, corta de vida. Solo se firma tras comprobar el acceso. */
  abstract signPlayback(objectPath: string): Promise<string>;
  /** Bytes del objeto, o `null` si no llego a subirse. */
  abstract sizeOf(objectPath: string): Promise<number | null>;
  abstract remove(objectPath: string): Promise<void>;
}

/** Sin bucket configurado. Dice que no, y dice por que. */
@Injectable()
export class DisabledVideoStorage extends VideoStorage {
  readonly enabled = false;

  private no(): never {
    throw new ServiceUnavailableException(
      'Subir videos no está configurado en este servidor. Pega el enlace de YouTube o Vimeo mientras tanto.',
    );
  }

  signUpload(): Promise<SignedUpload> {
    this.no();
  }
  signPlayback(): Promise<string> {
    this.no();
  }
  async sizeOf(): Promise<number | null> {
    return null;
  }
  async remove(): Promise<void> {
    // Sin bucket no hay nada que borrar. Callar aqui es correcto: se llama al
    // limpiar rutinas, y no se puede impedir borrar una rutina porque el
    // almacenamiento este apagado.
  }
}

/** Dos horas: lo que dura mirar una rutina entera con sus repeticiones. */
const PLAYBACK_TTL_SECONDS = 2 * 60 * 60;
/** Quince minutos para subir. Un video de 300 MB por datos móviles cabe. */
const UPLOAD_TTL_SECONDS = 15 * 60;

@Injectable()
export class GcsVideoStorage extends VideoStorage {
  readonly enabled = true;
  private readonly bucket: Bucket;

  /**
   * Las URLs firmadas se cachean hasta poco antes de caducar.
   *
   * Sin esto, abrir la misma rutina tres veces son tres firmas; y sin clave de
   * cuenta de servicio cada firma es una llamada a la api de IAM. Es un `Map` en
   * memoria del proceso a proposito: son URLs efimeras y publicas-por-un-rato,
   * no hay nada que valga la pena guardar entre despliegues.
   */
  private readonly cache = new Map<string, { readonly url: string; readonly hasta: number }>();

  constructor(bucketName: string, signingKeyJson?: string) {
    super();
    const storage =
      signingKeyJson === undefined
        ? new Storage()
        : new Storage({ credentials: JSON.parse(signingKeyJson) as Record<string, unknown> });
    this.bucket = storage.bucket(bucketName);
  }

  async signUpload(input: {
    readonly objectPath: string;
    readonly contentType: VideoContentType;
  }): Promise<SignedUpload> {
    /**
     * El tope de tamano va FIRMADO, no confiado al cliente.
     *
     * `x-goog-content-length-range` forma parte de lo que se firma: si el
     * telefono manda otro valor la firma no cuadra, y si manda el correcto pero
     * sube mas bytes, es el propio almacenamiento el que corta. Comprobarlo en
     * la api despues seria descubrir el problema con los 900 MB ya subidos y
     * pagados.
     */
    const rango = `0,${VIDEO_MAX_BYTES}`;

    const [url] = await this.bucket.file(input.objectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + UPLOAD_TTL_SECONDS * 1000,
      contentType: input.contentType,
      extensionHeaders: { 'x-goog-content-length-range': rango },
    });

    return {
      url,
      headers: {
        'Content-Type': input.contentType,
        'x-goog-content-length-range': rango,
      },
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    };
  }

  async signPlayback(objectPath: string): Promise<string> {
    const enCache = this.cache.get(objectPath);
    if (enCache !== undefined && enCache.hasta > Date.now()) return enCache.url;

    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + PLAYBACK_TTL_SECONDS * 1000,
    });

    // Se guarda con un margen: una URL entregada justo antes de caducar deja al
    // alumno con el reproductor en negro a mitad de la tecnica.
    this.cache.set(objectPath, { url, hasta: Date.now() + (PLAYBACK_TTL_SECONDS - 600) * 1000 });
    return url;
  }

  async sizeOf(objectPath: string): Promise<number | null> {
    try {
      const [metadata] = await this.bucket.file(objectPath).getMetadata();
      const size = metadata.size;
      return size === undefined ? null : Number(size);
    } catch {
      // No existe, o no se llego a subir. Las dos cosas significan lo mismo para
      // quien pregunta: ese video todavia no esta.
      return null;
    }
  }

  async remove(objectPath: string): Promise<void> {
    this.cache.delete(objectPath);
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }
}

/** Elige implementacion segun el entorno. Sin bucket, la que dice que no. */
export const videoStorageProvider = {
  provide: VideoStorage,
  useFactory: (): VideoStorage => {
    const env = loadEnv();
    if (env.VIDEO_BUCKET === undefined) return new DisabledVideoStorage();
    return new GcsVideoStorage(env.VIDEO_BUCKET, env.VIDEO_SIGNING_KEY_JSON);
  },
};
