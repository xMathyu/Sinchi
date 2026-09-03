/**
 * Quien reserva algo sin ser todavia alumno del local.
 *
 * Vive aparte porque lo necesitan DOS superficies —la clase gratis y los
 * eventos— y las dos tienen que resolver a la misma persona igual. Duplicarlo
 * era garantizar que una acabara normalizando el celular y la otra no, y
 * entonces la misma persona ocuparia dos plazas del mismo seminario.
 *
 * La regla que sostiene todo: la identidad es GLOBAL (MD 5). Quien ya entrena en
 * otro gimnasio es la MISMA fila de `users`, y por eso lo primero que se hace es
 * buscarla en vez de crear una nueva.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb } from '../../db/db.module';
import { schema, withoutTenantIsolation, type Database } from '../../db/client';
import { AccountLinkService } from '../../auth/account-link.service';

/** Se guarda solo con digitos y el `+`: es la llave con la que se reconoce a alguien. */
const normalizePhone = (raw: string): string => raw.replace(/[^\d+]/g, '');

/** Quien reserva, ya identificado por el controlador. */
export type VisitorAccount =
  | { readonly kind: 'user'; readonly userId: string }
  | {
      readonly kind: 'firebase';
      readonly uid: string;
      readonly email: string | null;
      readonly displayName: string | null;
    };

export interface Visitor {
  readonly userId: string | null;
  readonly firebaseUid: string | null;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string | null;
}

@Injectable()
export class VisitorService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly accountLink: AccountLinkService,
  ) {}

  /**
   * Solo QUIEN es, sin exigirle nada.
   *
   * `resolve` pide nombre y celular porque va a ESCRIBIR una reserva, y sin
   * ellos el gimnasio no puede reconocer ni llamar a quien dijo que vendria.
   * Para LEER lo que alguien ya reservo, pedirselos es absurdo: devolvia una
   * lista vacia a quien si tenia plazas, y sin fallar nada.
   */
  async identify(
    account: VisitorAccount,
  ): Promise<{ readonly userId: string | null; readonly firebaseUid: string | null }> {
    const userId = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          account.kind === 'user'
            ? eq(schema.users.id, account.userId)
            : eq(schema.users.firebaseUid, account.uid),
        )
        .limit(1);
      return row?.id ?? null;
    });

    return { userId, firebaseUid: account.kind === 'firebase' ? account.uid : null };
  }

  async resolve(
    account: VisitorAccount,
    overrides: { readonly fullName?: string | undefined; readonly phone?: string | undefined } = {},
  ): Promise<Visitor> {
    const known = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          phone: schema.users.phone,
          email: schema.users.email,
        })
        .from(schema.users)
        .where(
          account.kind === 'user'
            ? eq(schema.users.id, account.userId)
            : eq(schema.users.firebaseUid, account.uid),
        )
        .limit(1);
      return row ?? null;
    });

    if (known !== null) {
      return {
        userId: known.id,
        firebaseUid: account.kind === 'firebase' ? account.uid : null,
        fullName: known.name,
        phone: normalizePhone(known.phone),
        // A minusculas porque la tabla lo exige y `users.email` no lo garantiza:
        // lo escribe recepcion a mano al dar de alta. Sin esto, reservar con una
        // ficha cuyo correo lleva mayusculas revienta contra el CHECK.
        email: known.email === null ? null : known.email.toLowerCase(),
      };
    }

    if (account.kind === 'user') {
      // El token de sesion apunta a una identidad que ya no existe.
      throw new NotFoundException('No encontramos tu cuenta.');
    }

    /**
     * De donde salen el nombre y el celular, en orden.
     *
     * Lo primero que se mira es lo que la persona ESCRIBIO AL REGISTRARSE, que
     * es lo que evita la pregunta absurda: pedirle otra vez, al reservar, lo que
     * acaba de dar al crear su cuenta. El cuerpo de la peticion manda por si
     * quiere corregirlo, y el nombre de Google queda de ultimo recurso.
     */
    const registro = await this.accountLink.datosDeRegistro(account.uid);

    const fullName = (
      overrides.fullName ??
      registro?.fullName ??
      account.displayName ??
      ''
    ).trim();
    const phone = normalizePhone(overrides.phone ?? registro?.phone ?? '');

    if (fullName.length < 2 || phone.length < 6) {
      // Nombre y celular no son burocracia: son lo unico con lo que el gimnasio
      // puede reconocer y llamar a quien dijo que vendria.
      throw new BadRequestException('Faltan tu nombre y tu celular para avisarle al gimnasio.');
    }

    return {
      userId: null,
      firebaseUid: account.uid,
      fullName,
      phone,
      email: account.email === null ? null : account.email.toLowerCase(),
    };
  }
}
