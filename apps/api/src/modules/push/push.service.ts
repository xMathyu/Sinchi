/**
 * Avisos al teléfono (push), por el servicio de Expo.
 *
 * Existe porque un gimnasio lo pidió: «que llegue notificación y correo cuando
 * un alumno se inscriba». El correo ya salía; sin push, la reserva de quien viene
 * a pagar un mes dependía de que el dueño abriera el correo o la app a tiempo.
 *
 * Por Expo y no por FCM directo, aunque la api ya tiene `firebase-admin`: con
 * FCM habría que mantener dos canales —APNs para iOS, FCM para Android— y dos
 * formatos de token. Expo es una sola petición HTTP para los dos, y las llaves
 * de Apple y de Google viven en EAS, donde ya están las de firma.
 *
 * **Nada aquí puede tumbar lo que lo llama**, igual que el correo: el aviso es un
 * canal de ENTREGA. La reserva existe y sale en la app del mostrador aunque Expo
 * esté caído o el teléfono haya desinstalado la app.
 */
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, withoutTenantIsolation, type Database } from '../../db/client';
import { loadEnv } from '../../config/env';

export type PushPlatform = 'ios' | 'android';

/** Lo que dice el aviso. `data.url` es la pantalla que abre al tocarlo. */
export interface PushNotice {
  readonly title: string;
  readonly body: string;
  readonly data?: Readonly<Record<string, string>>;
  /**
   * El canal de Android. Uno por tipo de aviso, para que quien no quiera los de
   * reservas pueda callarlos sin callar los demás desde los ajustes del teléfono.
   */
  readonly channelId?: string;
}

/** La forma que da `getExpoPushTokenAsync`; la misma que exige el CHECK de la 0029. */
export const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

/** Lo que Expo contesta por cada mensaje, en el mismo orden en que se mandaron. */
export type PushTicket =
  | { readonly status: 'ok'; readonly id: string }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly details?: { readonly error?: string };
    };

/**
 * La petición HTTP a Expo, sola.
 *
 * Aparte del servicio para que las pruebas la sustituyan: el resto —a quién se
 * avisa, qué token se borra— es lo que hay que probar, y probarlo no puede
 * mandar avisos de verdad al teléfono de nadie.
 */
@Injectable()
export class ExpoPushClient {
  async send(
    messages: readonly (PushNotice & { readonly to: string })[],
  ): Promise<readonly PushTicket[]> {
    const token = loadEnv().EXPO_ACCESS_TOKEN;
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(messages.map((message) => ({ sound: 'default', ...message }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Expo respondió ${response.status}.`);
    const body = (await response.json()) as { readonly data?: readonly PushTicket[] };
    return body.data ?? [];
  }
}

/** Expo acepta hasta cien mensajes por petición. */
const BATCH = 100;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly client: ExpoPushClient,
  ) {}

  /**
   * Deja el teléfono a nombre de quien tiene la sesión.
   *
   * Si el token ya era de otra persona, pasa a esta: el token es del APARATO, y
   * en el mostrador se cierra la sesión de Ana y se abre la de Luis en el mismo
   * teléfono. Quedarse con los dos haría que Ana siguiera recibiendo en su casa
   * los avisos de un turno que ya no es suyo.
   *
   * Sin contexto de tenant porque la tabla no es de ningún gimnasio (0029), y el
   * `user_id` sale del `sub` de la sesión: el cliente solo elige el token.
   */
  async register(userId: string, token: string, platform: PushPlatform): Promise<void> {
    await withoutTenantIsolation(this.db, (tx) =>
      tx
        .insert(schema.pushDevices)
        .values({ token, userId, platform })
        .onConflictDoUpdate({
          target: schema.pushDevices.token,
          set: { userId, platform, updatedAt: new Date() },
        }),
    );
  }

  /**
   * Lo quita, al cerrar sesión.
   *
   * Solo si es de quien lo pide: el token no es un secreto —viaja en cada
   * aviso—, y sin esa condición cualquiera con una sesión podría dejar mudo el
   * teléfono de otro.
   */
  async unregister(userId: string, token: string): Promise<void> {
    await withoutTenantIsolation(this.db, (tx) =>
      tx
        .delete(schema.pushDevices)
        .where(and(eq(schema.pushDevices.token, token), eq(schema.pushDevices.userId, userId))),
    );
  }

  /**
   * Avisa a todo el staff de un local: al dueño y a recepción.
   *
   * A todos y no solo al dueño, al revés que el correo: el correo es un resumen
   * que se lee después, pero el aviso es para que alguien actúe —escribirle a
   * quien reservó, prepararle sitio—, y eso lo hace quien está en el mostrador.
   */
  async notifyTenantStaff(tenantId: string, notice: PushNotice): Promise<void> {
    try {
      const staff = await withTenant(this.db, tenantId, (tx) =>
        tx.select({ userId: schema.staff.userId }).from(schema.staff),
      );
      await this.notifyUsers(
        staff.map((row) => row.userId),
        notice,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar al staff de ${tenantId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Avisa a cada teléfono de esas personas. No lanza. */
  async notifyUsers(userIds: readonly string[], notice: PushNotice): Promise<void> {
    try {
      if (userIds.length === 0) return;
      // Sin contexto de tenant: los teléfonos son de la persona, no del local
      // (0029). Lo que decide a quién se avisa ya lo resolvió quien llama, con el
      // contexto que su tabla exige.
      const devices = await withoutTenantIsolation(this.db, (tx) =>
        tx
          .select({ token: schema.pushDevices.token })
          .from(schema.pushDevices)
          .where(inArray(schema.pushDevices.userId, [...new Set(userIds)])),
      );
      if (devices.length === 0) return;

      const tokens = devices.map((device) => device.token);
      const gone: string[] = [];
      for (let i = 0; i < tokens.length; i += BATCH) {
        const batch = tokens.slice(i, i + BATCH);
        const tickets = await this.client.send(batch.map((to) => ({ to, ...notice })));
        tickets.forEach((ticket, index) => {
          if (ticket.status !== 'error') return;
          // La app se desinstaló o el sistema revocó el permiso: ese teléfono no
          // va a volver a recibir nada, y seguir mandándole solo ensucia el log.
          if (ticket.details?.error === 'DeviceNotRegistered') gone.push(batch[index]!);
          else this.logger.warn(`Expo rechazó un aviso: ${ticket.message}`);
        });
      }

      if (gone.length > 0) {
        await withoutTenantIsolation(this.db, (tx) =>
          tx.delete(schema.pushDevices).where(inArray(schema.pushDevices.token, gone)),
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo mandar el aviso: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
