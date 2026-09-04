/**
 * La biblioteca del gimnasio: rutinas y tecnicas, con sus videos.
 *
 * Es lo primero que el producto ofrece SIN que la persona cruce la puerta, y por
 * eso el archivo entero gira alrededor de una columna: `visibility`.
 *
 *  · **publica** es un anuncio. La ve cualquiera desde la ficha del directorio,
 *    sin cuenta y sin haber pisado el local, y es lo que hace que alguien elija
 *    ESTE dojo entre cinco;
 *  · **de alumnos** es media razon para seguir pagando la mensualidad.
 *
 * El mismo gimnasio necesita las dos a la vez, y por eso la decision va por
 * rutina y no por local — que es exactamente lo que se pidio.
 *
 * De ahi cae la regla de este servicio, y es la unica que importa: **la api
 * nunca entrega la direccion de un video a quien no puede verlo**. Filtrar en la
 * pantalla seria decorativo — el JSON viaja igual — asi que quien no tiene
 * acceso recibe un ANZUELO: el titulo, de que va y cuantos pasos tiene. Bastante
 * para querer entrar, nada para consumir.
 *
 * Quien pasa lo decide `checkRoutineAccess`, en `@sinchi/shared`, que es la
 * misma funcion con la que la app decide que ofrecer. Repartir esa regla entre
 * la pantalla y la api es como acaban discrepando.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  canonicalVideoUrl,
  checkRoutineAccess,
  checkRoutineDraft,
  checkVideoUpload,
  isVideoContentType,
  membersOnlyCount,
  routineDenialMessage,
  videoObjectPath,
  videoUploadDenialMessage,
  visibleRoutines,
  type Routine,
  type RoutineAccessDenial,
  type RoutineItem,
  type RoutineLevel,
  type RoutineStatus,
  type RoutineViewer,
  type RoutineVisibility,
  type VideoContentType,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, type Database, type Tx } from '../../db/client';
import { toRoutine, toRoutineItem } from '../../common/mappers';
import { VideoStorage } from './video-storage';

/** Un paso tal como llega del formulario. */
export interface RoutineItemInput {
  readonly title: string;
  readonly instructions: string | null;
  readonly videoUrl: string | null;
  /** El video subido de este paso. Nunca junto con `videoUrl`. */
  readonly videoAssetId: string | null;
  readonly prescription: string | null;
}

export interface RoutineInput {
  readonly title: string;
  readonly summary: string | null;
  readonly videoUrl: string | null;
  readonly videoAssetId: string | null;
  readonly level: RoutineLevel | null;
  readonly visibility: RoutineVisibility;
  readonly published: boolean;
  readonly items: readonly RoutineItemInput[];
}

/**
 * Una rutina en la lista.
 *
 * Sin los pasos: una biblioteca de treinta rutinas con sus videos y sus
 * instrucciones es medio megabyte para pintar una lista de titulos, y la ficha
 * del gimnasio la abre gente con el dato del celular.
 */
export interface RoutineCard {
  readonly routine: Routine;
  readonly itemCount: number;
  /**
   * El ENLACE que representa a la rutina: el suyo, o el del primer paso que
   * tenga uno.
   *
   * Lo elige la api y no la pantalla porque las tres superficies tienen que
   * ensenar la misma portada, y de ahi sale la miniatura sin subir ninguna
   * imagen (`parseVideoLink`).
   *
   * Vale `null` cuando el video es un archivo SUBIDO, y es deliberado: en una
   * lista no se reproduce nada, asi que firmar una URL por fila seria pagar una
   * firma —y sin clave de cuenta de servicio, una llamada de red— por algo que
   * nadie va a abrir. Un archivo tampoco trae miniatura. Para saber que la
   * rutina tiene video esta `hasVideo`.
   */
  readonly coverVideoUrl: string | null;
  /** Tiene video, venga de donde venga. La lista pinta su marcador con esto. */
  readonly hasVideo: boolean;
}

/**
 * Lo que se entrega de una rutina, con acceso o sin el.
 *
 * Union discriminada y 200 en los dos casos, como el check-in y las plazas de un
 * evento: que sea contenido de alumnos no es un error de la peticion sino el
 * resultado del negocio. Es, ademas, la unica pantalla del producto donde
 * alguien de fuera esta mirando algo que quiere — devolver un 403 pelado ahi es
 * tirar a la basura la mejor conversion que tiene el gimnasio.
 */
export type RoutineView =
  | { readonly unlocked: true; readonly card: RoutineCard; readonly items: readonly RoutineItem[] }
  | {
      readonly unlocked: false;
      readonly reason: RoutineAccessDenial;
      /** Sin videos y sin instrucciones. Lo justo para querer entrar. */
      readonly teaser: {
        readonly id: string;
        readonly title: string;
        readonly summary: string | null;
        readonly level: RoutineLevel | null;
        readonly itemCount: number;
      };
    };

@Injectable()
export class RoutinesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: VideoStorage,
  ) {}

  /**
   * La biblioteca, con los ojos de quien pregunta.
   *
   * Un solo metodo para las tres superficies —el mostrador, el alumno y la
   * calle— porque son la misma lista mirada por tres publicos. Tenerlos
   * separados es como uno se queda sin el filtro cuando cambia la regla.
   */
  async library(
    tenantId: string,
    viewer: RoutineViewer,
  ): Promise<{ readonly routines: readonly RoutineCard[]; readonly membersOnly: number }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.routines)
        // Lo ultimo que publico el gimnasio, arriba: una biblioteca ordenada por
        // titulo esconde justo lo que hace volver al alumno.
        .orderBy(desc(schema.routines.updatedAt));

      const todas = rows.map(toRoutine);
      const visibles = visibleRoutines(todas, viewer);

      return {
        routines: await this.withCovers(tx, visibles),
        /**
         * Cuantas se pierde quien mira desde fuera.
         *
         * "12 rutinas mas para alumnos" vende la mensualidad mejor que cualquier
         * texto, y ensenar los TITULOS de lo que no puede ver regalaria la mitad
         * del valor. Para el alumno y el staff es 0: ya las tienen.
         */
        membersOnly: viewer === 'visitor' ? membersOnlyCount(todas) : 0,
      };
    });
  }

  /** La rutina abierta, o el anzuelo si no le toca verla. */
  async view(tenantId: string, routineId: string, viewer: RoutineViewer): Promise<RoutineView> {
    return withTenant(this.db, tenantId, async (tx) => {
      const routine = await this.findInTx(tx, routineId);
      const denial = checkRoutineAccess(routine, viewer);

      if (denial !== null) {
        /**
         * Un borrador no existe para quien no es del local.
         *
         * No hay nada que vender: es contenido que el gimnasio todavia no
         * escribio. Ensenar su titulo con un candado prometeria algo que quiza
         * nunca se publique.
         */
        if (denial.code === 'not_published') {
          throw new NotFoundException('Esa rutina no existe.');
        }

        /**
         * Se CUENTAN los pasos, no se traen.
         *
         * Con las filas cargadas —cada una con su enlace de video y sus
         * instrucciones— la unica cosa que separa el anzuelo de la fuga es que
         * nadie las meta en la respuesta al editar esto dentro de seis meses.
         * Sin cargarlas, esa tentacion no existe.
         */
        return {
          unlocked: false,
          reason: denial,
          teaser: {
            id: routine.id,
            title: routine.title,
            summary: routine.summary,
            level: routine.level,
            itemCount: await this.countItems(tx, routineId),
          },
        };
      }

      const items = await this.itemsFor(tx, [routineId]);
      const [card] = await this.withCovers(tx, [routine], items);
      return {
        unlocked: true,
        card: { ...card!, routine: (await this.conVideosFirmados(tx, [routine]))[0]! },
        items: await this.conVideosFirmadosEnPasos(tx, items),
      };
    });
  }

  async create(tenantId: string, input: RoutineInput): Promise<RoutineView> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.routines)
        .values({ tenantId, ...this.toColumns(input) })
        .returning();

      await this.replaceItems(tx, tenantId, row!.id, input.items);
      return this.viewInTx(tx, row!.id);
    });
  }

  /**
   * Reescribe la rutina entera, pasos incluidos.
   *
   * Los pasos se borran y se vuelven a insertar en vez de irse comparando uno a
   * uno. Es a proposito: reordenar, quitar el tercero y anadir dos al final es
   * una sola operacion para quien la escribe, y resolverla con altas y bajas
   * parciales es el sitio donde aparece el paso duplicado. Va dentro de la misma
   * transaccion, asi que nadie ve la rutina a medias, y no se pierde nada porque
   * los ids de los pasos no los referencia nadie.
   */
  async update(tenantId: string, routineId: string, input: RoutineInput): Promise<RoutineView> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const actual = await this.findInTx(tx, routineId);
      const pasosAntes = await this.itemsFor(tx, [routineId]);

      await tx
        .update(schema.routines)
        .set({ ...this.toColumns(input), updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId));

      await this.replaceItems(tx, tenantId, routineId, input.items);

      await this.borrarHuerfanos(
        tx,
        [actual.videoAssetId, ...pasosAntes.map((paso) => paso.videoAssetId)],
        [input.videoAssetId, ...input.items.map((item) => item.videoAssetId)],
      );

      return this.viewInTx(tx, routineId);
    });
  }

  /**
   * Publicar o volver a borrador.
   *
   * Es un paso aparte de escribir por la misma razon que en los eventos: la
   * rutina se graba el martes, se escriben las instrucciones el jueves y se
   * publica cuando esta entera.
   */
  async setStatus(tenantId: string, routineId: string, status: RoutineStatus): Promise<Routine> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.routines)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId))
        .returning();

      if (row === undefined) throw new NotFoundException('Esa rutina no existe en este gimnasio.');
      return toRoutine(row);
    });
  }

  /**
   * Cambia el publico sin tocar nada mas.
   *
   * Existe suelto porque es la decision que el dueno va a cambiar de opinion
   * sobre ella: publica el uchimata para atraer, ve que funciona, y quiere
   * guardarse la serie entera para alumnos. Hacerlo pasar por el editor completo
   * convierte un toque en un formulario.
   */
  async setVisibility(
    tenantId: string,
    routineId: string,
    visibility: RoutineVisibility,
  ): Promise<Routine> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.routines)
        .set({ visibility, updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId))
        .returning();

      if (row === undefined) throw new NotFoundException('Esa rutina no existe en este gimnasio.');
      return toRoutine(row);
    });
  }

  /**
   * Borra la rutina y sus pasos.
   *
   * Aqui no hay a quien avisar —al contrario que un evento con plazas vendidas—
   * asi que borrar es una salida legitima. Lo unico que se protege es el
   * despiste: una rutina PUBLICADA se despublica primero. Es la misma pausa que
   * pone un `Alert` de confirmacion, pero del lado que no se puede saltar.
   */
  async remove(tenantId: string, routineId: string): Promise<{ readonly deleted: true }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const routine = await this.findInTx(tx, routineId);
      if (routine.status === 'published') {
        throw new ConflictException(
          'Despublícala antes de borrarla: así no desaparece de golpe de la app de quien la estaba usando.',
        );
      }

      // Los archivos se van con ella: nadie mas los referencia.
      const pasos = await this.itemsFor(tx, [routineId]);
      await tx.delete(schema.routines).where(eq(schema.routines.id, routineId));
      await this.borrarHuerfanos(
        tx,
        [routine.videoAssetId, ...pasos.map((paso) => paso.videoAssetId)],
        [],
      );
      return { deleted: true as const };
    });
  }

  /**
   * Con que ojos mira esta membresia.
   *
   * **La deuda NO cierra la biblioteca; la baja si.** Al moroso ya se le cierra
   * la puerta, que es la palanca que cobra; quitarle ademas el video no recupera
   * un sol —servirlo no le cuesta nada al gimnasio— y le quita lo unico que lo
   * mantiene atado a la escuela mientras junta la plata. Por eso valen tambien
   * `in_grace` y `suspended`.
   *
   * Ser alumno se mide por la SUSCRIPCION y no por `memberships.status`, y eso
   * hay que decirlo porque la columna existe y engana: en todo el producto nada
   * la pone en `inactive`. La baja de este gimnasio es una suscripcion
   * cancelada, que es lo mismo que cuenta el padron para su pestana "Bajas" y lo
   * mismo con lo que la ficha del directorio decide si eres de casa. Mirar la
   * columna habria dejado la biblioteca abierta para siempre a quien se fue.
   */
  async viewerForMembership(tenantId: string, membershipId: string): Promise<RoutineViewer> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.subscriptions.id })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.membershipId, membershipId),
            ne(schema.subscriptions.status, 'canceled'),
          ),
        )
        .limit(1);

      return row === undefined ? 'visitor' : 'member';
    });
  }

  // -------------------------------------------------------------------------
  // Subir un video
  // -------------------------------------------------------------------------

  /**
   * Abre una subida: crea la fila y devuelve una URL firmada.
   *
   * El archivo NO pasa por aqui. La api solo firma un permiso para escribir UN
   * objeto concreto, de un tipo concreto y con un tope de tamano, y el telefono
   * sube directo al bucket. La fila nace `pending` porque en este momento el
   * archivo todavia no existe.
   */
  async createUpload(
    tenantId: string,
    input: {
      readonly contentType: string;
      readonly sizeBytes?: number | undefined;
      readonly originalName?: string | undefined;
    },
  ): Promise<{
    readonly assetId: string;
    readonly uploadUrl: string;
    readonly headers: Record<string, string>;
    readonly expiresInSeconds: number;
  }> {
    const denial = checkVideoUpload({ contentType: input.contentType, sizeBytes: input.sizeBytes });
    if (denial !== null) throw new BadRequestException(videoUploadDenialMessage(denial));
    // `checkVideoUpload` ya lo garantiza; el estrechamiento de tipo no.
    if (!isVideoContentType(input.contentType)) {
      throw new BadRequestException('Ese archivo no es un video.');
    }
    const contentType: VideoContentType = input.contentType;

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.routineVideos)
        .values({
          tenantId,
          // Provisional: la ruta definitiva se deriva del id, que solo existe
          // despues de insertar. Se corrige en el mismo `withTenant`.
          objectPath: `pendiente/${crypto.randomUUID()}`,
          contentType,
          originalName: input.originalName ?? null,
        })
        .returning();

      const objectPath = videoObjectPath(tenantId, row!.id, contentType);
      await tx
        .update(schema.routineVideos)
        .set({ objectPath })
        .where(eq(schema.routineVideos.id, row!.id));

      const firma = await this.storage.signUpload({ objectPath, contentType });
      return {
        assetId: row!.id,
        uploadUrl: firma.url,
        headers: firma.headers,
        expiresInSeconds: firma.expiresInSeconds,
      };
    });
  }

  /**
   * Confirma que el archivo llego, preguntandoselo al ALMACENAMIENTO.
   *
   * No se le cree al cliente: "ya subi" es justo lo que diria quien no subio
   * nada, y una rutina publicada contra un objeto inexistente es un reproductor
   * en negro que el dueno descubre por un alumno. El tamano tambien sale de
   * aqui, porque el telefono puede declarar 10 MB y subir 900.
   */
  async confirmUpload(tenantId: string, assetId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.routineVideos)
        .where(eq(schema.routineVideos.id, assetId))
        .limit(1);
      if (row === undefined) throw new NotFoundException('Ese video no existe en este gimnasio.');
      if (row.status === 'ready') return { assetId, sizeBytes: row.sizeBytes };

      const sizeBytes = await this.storage.sizeOf(row.objectPath);
      if (sizeBytes === null) {
        throw new ConflictException(
          'El video todavía no llegó completo. Vuelve a intentarlo cuando termine de subir.',
        );
      }

      await tx
        .update(schema.routineVideos)
        .set({ status: 'ready', sizeBytes, readyAt: new Date() })
        .where(eq(schema.routineVideos.id, assetId));

      return { assetId, sizeBytes };
    });
  }

  /**
   * Borra los archivos que la rutina dejo de usar.
   *
   * Sin esto, cambiar el video de un paso cinco veces deja cuatro archivos
   * pagandose para siempre en un bucket que nadie mira. Se compara contra lo que
   * la rutina tenia ANTES, asi que un archivo de otra rutina no entra nunca en
   * el conjunto.
   */
  private async borrarHuerfanos(
    tx: Tx,
    antes: readonly (string | null)[],
    despues: readonly (string | null)[],
  ): Promise<void> {
    const vivos = new Set(despues.filter((id): id is string => id !== null));
    const sobran = [...new Set(antes.filter((id): id is string => id !== null))].filter(
      (id) => !vivos.has(id),
    );
    if (sobran.length === 0) return;

    const rows = await tx
      .select({ id: schema.routineVideos.id, objectPath: schema.routineVideos.objectPath })
      .from(schema.routineVideos)
      .where(inArray(schema.routineVideos.id, sobran));

    await tx.delete(schema.routineVideos).where(inArray(schema.routineVideos.id, sobran));
    // El objeto se borra DESPUES de la fila y sin bloquear: si esta llamada
    // falla queda un archivo huerfano en el bucket, que cuesta centavos; al
    // reves, una fila viva apuntando a un objeto borrado es un reproductor en
    // negro para el alumno.
    await Promise.all(rows.map((row) => this.storage.remove(row.objectPath).catch(() => {})));
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async viewInTx(tx: Tx, routineId: string): Promise<RoutineView> {
    const routine = await this.findInTx(tx, routineId);
    const items = await this.itemsFor(tx, [routineId]);
    const [card] = await this.withCovers(tx, [routine], items);
    return {
      unlocked: true,
      card: { ...card!, routine: (await this.conVideosFirmados(tx, [routine]))[0]! },
      items: await this.conVideosFirmadosEnPasos(tx, items),
    };
  }

  /**
   * Cambia los videos SUBIDOS por una URL firmada que caduca.
   *
   * Se llama solo desde donde ya se concedio el acceso, y esa es toda la
   * seguridad del contenido exclusivo: el objeto del bucket es privado, asi que
   * sin pasar por aqui no hay direccion con la que verlo. Es lo que un enlace de
   * YouTube oculto no podia dar.
   *
   * Se firman todas de una vez y no de una en una: una rutina son la portada y
   * hasta cuarenta pasos, y encadenar cuarenta llamadas es lo que convierte una
   * ficha en cinco segundos de espera.
   */
  private async conVideosFirmados(tx: Tx, routines: readonly Routine[]): Promise<Routine[]> {
    const rutas = await this.objectPaths(
      tx,
      routines.map((r) => r.videoAssetId),
    );
    return Promise.all(
      routines.map(async (routine) => {
        const ruta = routine.videoAssetId === null ? undefined : rutas.get(routine.videoAssetId);
        if (ruta === undefined) return routine;
        return { ...routine, videoUrl: await this.storage.signPlayback(ruta) };
      }),
    );
  }

  private async conVideosFirmadosEnPasos(
    tx: Tx,
    items: readonly RoutineItem[],
  ): Promise<RoutineItem[]> {
    const rutas = await this.objectPaths(
      tx,
      items.map((i) => i.videoAssetId),
    );
    return Promise.all(
      items.map(async (item) => {
        const ruta = item.videoAssetId === null ? undefined : rutas.get(item.videoAssetId);
        if (ruta === undefined) return item;
        return { ...item, videoUrl: await this.storage.signPlayback(ruta) };
      }),
    );
  }

  /**
   * Ruta en el bucket de cada archivo, en UNA consulta.
   *
   * Solo los que estan `ready`: un video cuya subida se cayo a la mitad no tiene
   * objeto detras, y firmar su URL daria un reproductor en negro en vez de una
   * rutina sin video.
   */
  private async objectPaths(
    tx: Tx,
    assetIds: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(assetIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();

    const rows = await tx
      .select({ id: schema.routineVideos.id, objectPath: schema.routineVideos.objectPath })
      .from(schema.routineVideos)
      .where(
        and(
          inArray(schema.routineVideos.id, ids),
          eq(schema.routineVideos.status, 'ready'),
        ),
      );
    return new Map(rows.map((row) => [row.id, row.objectPath]));
  }

  private async findInTx(tx: Tx, routineId: string): Promise<Routine> {
    const [row] = await tx
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);
    if (row === undefined) throw new NotFoundException('Esa rutina no existe en este gimnasio.');
    return toRoutine(row);
  }

  /** Cuantos pasos tiene, sin traer ni un enlace de video. */
  private async countItems(tx: Tx, routineId: string): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.routineItems)
      .where(eq(schema.routineItems.routineId, routineId));
    return row?.total ?? 0;
  }

  private async itemsFor(tx: Tx, routineIds: readonly string[]): Promise<readonly RoutineItem[]> {
    if (routineIds.length === 0) return [];
    const rows = await tx
      .select()
      .from(schema.routineItems)
      .where(inArray(schema.routineItems.routineId, [...new Set(routineIds)]))
      .orderBy(asc(schema.routineItems.position));
    return rows.map(toRoutineItem);
  }

  /**
   * La portada y el numero de pasos de varias rutinas, en UNA consulta.
   *
   * La lista del dueno son diez rutinas, pero el N+1 se escribe igual de facil y
   * despues nadie lo quita.
   */
  private async withCovers(
    tx: Tx,
    routines: readonly Routine[],
    conocidos?: readonly RoutineItem[],
  ): Promise<RoutineCard[]> {
    if (routines.length === 0) return [];

    const items =
      conocidos ??
      (await this.itemsFor(
        tx,
        routines.map((r) => r.id),
      ));

    const porRutina = new Map<string, RoutineItem[]>();
    for (const item of items) {
      const lista = porRutina.get(item.routineId) ?? [];
      lista.push(item);
      porRutina.set(item.routineId, lista);
    }

    return routines.map((routine) => {
      const suyos = porRutina.get(routine.id) ?? [];
      return {
        routine,
        itemCount: suyos.length,
        // El de la rutina manda; si no tiene, el del primer paso que lleve uno.
        coverVideoUrl:
          routine.videoUrl ?? suyos.find((item) => item.videoUrl !== null)?.videoUrl ?? null,
        hasVideo:
          routine.videoUrl !== null ||
          routine.videoAssetId !== null ||
          suyos.some((item) => item.videoUrl !== null || item.videoAssetId !== null),
      };
    });
  }

  private async replaceItems(
    tx: Tx,
    tenantId: string,
    routineId: string,
    items: readonly RoutineItemInput[],
  ): Promise<void> {
    await tx.delete(schema.routineItems).where(eq(schema.routineItems.routineId, routineId));
    if (items.length === 0) return;

    await tx.insert(schema.routineItems).values(
      items.map((item, position) => ({
        tenantId,
        routineId,
        position,
        title: item.title.trim(),
        instructions: this.limpio(item.instructions),
        videoUrl: this.videoLimpio(item.videoUrl),
        videoAssetId: item.videoAssetId,
        prescription: this.limpio(item.prescription),
      })),
    );
  }

  /** La MISMA funcion que apaga el boton en la app. */
  private assertValid(input: RoutineInput): void {
    const denial = checkRoutineDraft({
      title: input.title,
      summary: input.summary,
      videoUrl: input.videoUrl,
      videoAssetId: input.videoAssetId,
      level: input.level,
      visibility: input.visibility,
      items: input.items.map((item) => ({
        title: item.title,
        instructions: item.instructions,
        videoUrl: item.videoUrl,
        videoAssetId: item.videoAssetId,
        prescription: item.prescription,
      })),
    });
    if (denial !== null) throw new BadRequestException(routineDenialMessage(denial));
  }

  private toColumns(input: RoutineInput) {
    return {
      title: input.title.trim(),
      summary: this.limpio(input.summary),
      videoUrl: this.videoLimpio(input.videoUrl),
      videoAssetId: input.videoAssetId,
      level: input.level,
      visibility: input.visibility,
      status: (input.published ? 'published' : 'draft') as RoutineStatus,
      updatedAt: new Date(),
    };
  }

  private limpio(texto: string | null): string | null {
    if (texto === null) return null;
    const limpio = texto.trim();
    return limpio.length === 0 ? null : limpio;
  }

  /**
   * Se guarda la direccion CANONICA, no la que pego el dueno.
   *
   * Dos duenos pegan el mismo video, uno desde el movil (`youtu.be/...`) y otro
   * desde el navegador con la lista de reproduccion y el minuto por el que iba
   * detras. Sin normalizar son dos cadenas distintas para el mismo video, y el
   * `?t=42` arranca la tecnica por la mitad. `checkRoutineDraft` ya rechazo lo
   * que no se entiende, asi que aqui no queda nada que decidir.
   */
  private videoLimpio(raw: string | null): string | null {
    const limpio = this.limpio(raw);
    return limpio === null ? null : canonicalVideoUrl(limpio);
  }
}
