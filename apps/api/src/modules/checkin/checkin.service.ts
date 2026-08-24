/**
 * Check-in.
 *
 * La autoridad final del acceso. La app del staff valida igual en su caché para
 * poder trabajar sin wifi, pero el servidor reconcilia y tiene la última palabra
 * (MD 4.6).
 *
 * Aquí sí se verifica la firma del QR, que es lo que el dispositivo no puede
 * hacer sin conexión: el secreto TOTP es del alumno, es global y vive cifrado en
 * la base.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  accessMessage,
  isoWeekOf,
  parseQrPayload,
  validateCheckIn,
  verifyTotp,
  type AccessMessage,
  type Attendance,
  type CheckInMethod,
  type CheckInResult,
  type HmacFn,
  type PlainDate,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, withoutTenantIsolation, type Database, type Tx } from '../../db/client';
import { dateToColumn, toAttendance, toClassSchedule } from '../../common/mappers';
import { Clock } from '../../common/clock';
import { SecretBox } from '../../common/secret-box';
import { MembershipViewService, type MembershipView } from '../memberships/membership-view.service';

/** La misma primitiva que usa la app, o los códigos no coincidirían. */
const hmacSha256: HmacFn = (key, message) => hmac(sha256, key, message);

export interface CheckInEvaluation {
  readonly view: MembershipView;
  readonly result: CheckInResult;
  readonly message: AccessMessage;
}

export interface RecordCheckInInput {
  readonly membershipId: string;
  readonly method: CheckInMethod;
  /** El staff deja pasar a pesar del rechazo. Queda auditado con su nombre. */
  readonly overrideDenial?: boolean | undefined;
  readonly staffId?: string | null | undefined;
  readonly deviceId?: string | null | undefined;
  /** Idempotencia de la cola offline: lo genera el dispositivo. */
  readonly clientId?: string | null | undefined;
  /** Momento real del marcado, que puede ser anterior si venía en cola. */
  readonly occurredAt?: Date | undefined;
}

/**
 * Resultado de intentar registrar.
 *
 * Union discriminada y no un `attendance` opcional: un rechazo NO es un error de
 * la api, es el resultado normal del negocio, y el llamador tiene que decidir
 * qué hacer con el motivo. Con un campo opcional, el `if` se olvida.
 */
export type RecordCheckInOutcome =
  | (CheckInEvaluation & {
      readonly registered: true;
      readonly attendance: Attendance;
      /** `true` si ya existía: la cola reintentó o alguien escaneó dos veces. */
      readonly alreadyRegistered: boolean;
    })
  | (CheckInEvaluation & { readonly registered: false });

@Injectable()
export class CheckInService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly secrets: SecretBox,
    private readonly views: MembershipViewService,
  ) {}

  // -------------------------------------------------------------------------
  // Evaluación
  // -------------------------------------------------------------------------

  /**
   * Qué pasaría si esta persona marcara ahora, sin registrar nada.
   *
   * Es lo que la app del alumno muestra en su pantalla de QR: el mismo veredicto
   * que verá el staff en la puerta, calculado con la misma función. Si el alumno
   * lee "puedes entrar" aquí, en la puerta va a pasar.
   */
  async evaluate(tenantId: string, membershipId: string): Promise<CheckInEvaluation> {
    return withTenant(this.db, tenantId, (tx) => this.evaluateInTx(tx, membershipId));
  }

  private async evaluateInTx(tx: Tx, membershipId: string): Promise<CheckInEvaluation> {
    const view = await this.views.viewInTx(tx, membershipId);
    const today = this.clock.today(view.tenant.timezone);

    const schedules = await tx
      .select()
      .from(schema.classSchedules)
      .where(eq(schema.classSchedules.active, true));

    const result = validateCheckIn({
      subscription: view.subscription,
      plan: view.plan,
      attendances: [],
      schedules: schedules.map(toClassSchedule),
      today,
      time: this.clock.timeOfDay(view.tenant.timezone),
      graceDays: view.tenant.graceDays,
      quotaOverflowPolicy: view.tenant.quotaOverflowPolicy,
      dropInPriceCents: view.tenant.dropInPriceCents,
      debtCents: view.receivable.amountCents,
      daysPastDue: view.delinquency.daysPastDue,
      // El cupo ya viene contado en SQL por la vista: recontarlo sobre una
      // lista vacía concluiría que nadie entrenó esta semana.
      quotaOverride: view.quota,
    });

    return { view, result, message: accessMessage(result) };
  }

  // -------------------------------------------------------------------------
  // QR
  // -------------------------------------------------------------------------

  /**
   * Resuelve y verifica un QR leído en la puerta.
   *
   * El payload trae el id del usuario GLOBAL: el mismo código lo identifica en
   * cualquier local de la red y cada local resuelve contra su propia membresía
   * (MD 5). Lo que autentica es el código, no el id.
   */
  async evaluateQr(tenantId: string, rawPayload: string): Promise<CheckInEvaluation> {
    const payload = parseQrPayload(rawPayload);
    if (payload === null || payload.subject !== 'user') {
      throw new BadRequestException('Ese código no es un QR de alumno de Sinchi.');
    }

    const secretEnvelope = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({ secret: schema.users.totpSecretEncrypted })
        .from(schema.users)
        .where(eq(schema.users.id, payload.id))
        .limit(1);
      return row?.secret ?? null;
    });

    if (secretEnvelope === null) {
      throw new BadRequestException(
        'Ese alumno todavía no vinculó su dispositivo. Márcalo manualmente por ahora.',
      );
    }

    const valid = verifyTotp({
      secret: this.secrets.decrypt(secretEnvelope),
      code: payload.code,
      instant: this.clock.now(),
      hmac: hmacSha256,
      // Una ventana de tolerancia: el reloj del celular del alumno no está
      // sincronizado, y el del equipo de la puerta menos todavía.
      skewWindows: 1,
    });

    if (!valid) {
      throw new BadRequestException(
        'El código ya venció. Pídele al alumno que vuelva a mostrar su QR.',
      );
    }

    const membershipId = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, payload.id),
            eq(schema.memberships.status, 'active'),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    });

    if (membershipId === null) {
      throw new NotFoundException('Este alumno no tiene membresía activa en este local.');
    }

    return this.evaluate(tenantId, membershipId);
  }

  // -------------------------------------------------------------------------
  // Registro
  // -------------------------------------------------------------------------

  /**
   * Registra una asistencia.
   *
   * Idempotente por dos vías: el `client_id` del dispositivo y el índice único
   * de un marcado por alumno y día. Un reintento de la cola offline no consume
   * una segunda sesión del cupo.
   */
  async record(tenantId: string, input: RecordCheckInInput): Promise<RecordCheckInOutcome> {
    return withTenant(this.db, tenantId, async (tx) => {
      const evaluation = await this.evaluateInTx(tx, input.membershipId);
      const override = input.overrideDenial === true;

      if (!evaluation.result.allowed && !override) {
        return { ...evaluation, registered: false };
      }

      if (input.method === 'manual' && (input.staffId ?? null) === null) {
        throw new BadRequestException('Un marcado manual necesita quedar a nombre de alguien.');
      }

      const timezone = evaluation.view.tenant.timezone;
      const occurredAt = input.occurredAt ?? this.clock.now();
      const localDate: PlainDate = this.clock.today(timezone);

      const denialReason =
        override && !evaluation.result.allowed ? evaluation.result.reason : null;

      const [inserted] = await tx
        .insert(schema.attendance)
        .values({
          tenantId,
          membershipId: input.membershipId,
          subscriptionId: evaluation.view.subscription.id,
          classScheduleId: evaluation.result.allowed
            ? evaluation.result.classScheduleId
            : null,
          checkedInAt: occurredAt,
          localDate: dateToColumn(localDate),
          isoWeek: isoWeekOf(localDate).key,
          method: input.method,
          deviceId: input.deviceId ?? null,
          recordedBy: input.staffId ?? null,
          overrodeDenial: denialReason !== null,
          denialReason,
          syncedAt: new Date(),
          clientId: input.clientId ?? null,
        })
        // Un doble escaneo en la puerta no puede comerle una sesión al alumno.
        .onConflictDoNothing()
        .returning();

      if (inserted !== undefined) {
        return {
          ...evaluation,
          registered: true,
          attendance: toAttendance(inserted),
          alreadyRegistered: false,
        };
      }

      // El insert choco con el indice: ya habia un marcado de hoy. Se devuelve
      // el que existe, para que la cola offline pueda dejar de reintentar.
      const [existing] = await tx
        .select()
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.membershipId, input.membershipId),
            eq(schema.attendance.localDate, dateToColumn(localDate)),
          ),
        )
        .limit(1);

      if (existing === undefined) {
        throw new BadRequestException('No se pudo registrar la asistencia. Intenta de nuevo.');
      }

      return {
        ...evaluation,
        registered: true,
        attendance: toAttendance(existing),
        alreadyRegistered: true,
      };
    });
  }

  /** Horarios del gimnasio, para que el dispositivo los cachee. */
  async schedules(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.classSchedules)
        .where(eq(schema.classSchedules.active, true))
        .orderBy(schema.classSchedules.weekday, schema.classSchedules.startTime);
      return rows.map(toClassSchedule);
    });
  }

  /** Marcados de hoy en el local. Alimenta "últimos marcados" en la puerta. */
  async recentToday(tenantId: string, limit = 20) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          attendance: schema.attendance,
          userName: schema.users.name,
        })
        .from(schema.attendance)
        .innerJoin(
          schema.memberships,
          eq(schema.memberships.id, schema.attendance.membershipId),
        )
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(sql`${schema.attendance.checkedInAt} > now() - interval '18 hours'`)
        .orderBy(sql`${schema.attendance.checkedInAt} desc`)
        .limit(limit);

      return rows.map((row) => ({
        ...toAttendance(row.attendance),
        userName: row.userName,
      }));
    });
  }
}
