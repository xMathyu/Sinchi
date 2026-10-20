'use server';

/**
 * Lo que el alta de un gimnasio ESCRIBE.
 *
 * El alta vivía en la app y Apple la rechazó cuatro veces por la 3.1.1:
 * registrar una empresa desde la app es, para App Review, abrirle la puerta a
 * una compra hecha fuera de ella. Así que vive aquí, en la web, para todo el
 * mundo —también para Android, que no lo objetaba—: un solo sitio donde nace un
 * gimnasio es un solo sitio donde revisar que nazca bien (decisiones, «El alta
 * de gimnasios se muda a la web»).
 *
 * Son dos pasos, como en la app, y por la misma razón: primero se vende y
 * después se pide. La cuenta se crea al tocar «Continuar», porque
 * `POST /gyms/signup` necesita un ID token de Firebase que firme el alta, y ese
 * token espera entre los dos pasos en una cookie `httpOnly`
 * (`src/signup/session.ts`). Todo pasa en el servidor, como en el panel: al
 * navegador nunca vuelve ni el token de Firebase ni el de Sinchi.
 *
 * Las reglas del dominio —el RUC, el celular, los enlaces— se corren AQUÍ con
 * las mismas funciones de `@sinchi/shared` que corre la api, y antes de viajar.
 * No es desconfianza de la api: es que así el motivo sale con la misma frase
 * que daría el 400, sin pagar el viaje a Cloud Run para enterarse.
 */
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import {
  GYM_LINK_KINDS,
  checkGymLink,
  checkPhoneNumber,
  checkRuc,
  gymLinkDenialMessage,
  phoneDenialMessage,
  rucDenialMessage,
  type GymLinkKind,
} from '@sinchi/shared';
import { ApiError, postPublic } from '../panel/api';
import {
  FirebaseAuthError,
  exchangeGoogleIdentity,
  signInWithEmailIdentity,
  signUpWithEmail,
  type FirebaseIdentity,
} from '../panel/firebase';
import type { FormState } from '../panel/form-state';
import { writeSession } from '../panel/session';
import { clearSignupIdentity, readSignupIdentity, writeSignupIdentity } from './session';
import { asTier } from './tiers';
import type { WireSignUpGym } from './types';

/** El mismo mínimo que `OnboardingService`, con su misma frase. */
const ADDRESS_MIN = 10;

/**
 * A dónde sigue el alta una vez hay cuenta.
 *
 * El plan que eligió en la portada viaja por la URL para llegar ya marcado al
 * formulario. Solo si es uno de verdad: un `plan=` cualquiera no se pega en
 * una redirección.
 */
function nextStep(plan: unknown): Route {
  const tier = asTier(plan);
  return tier === null ? '/registrar/gimnasio' : `/registrar/gimnasio?plan=${tier}`;
}

/**
 * Paso 1 con Google.
 *
 * Recibe la credencial que Google Identity Services le dio al navegador y la
 * canjea aquí, igual que el login del panel. La diferencia es qué se hace con
 * el ID token de Firebase: en vez de cambiarlo ya por una sesión de Sinchi
 * —esta persona todavía no es de ningún gimnasio— se guarda para firmar el
 * alta en el paso siguiente.
 */
export async function startWithGoogle(credential: string, plan: unknown): Promise<FormState> {
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 4096) {
    return { error: 'La respuesta de Google no se pudo leer. Intenta de nuevo.' };
  }

  let identity: FirebaseIdentity;
  try {
    identity = await exchangeGoogleIdentity(credential);
  } catch (error) {
    return {
      error:
        error instanceof FirebaseAuthError
          ? error.message
          : 'No se pudo entrar con Google. Intenta de nuevo.',
    };
  }

  await writeSignupIdentity({ ...identity, provider: 'google' });
  redirect(nextStep(plan));
}

/**
 * Paso 1 con correo y contraseña.
 *
 * Un solo botón para crear la cuenta Y para entrar con una que ya existe, a
 * propósito. El caso es real: quien empezó el alta ayer y no la terminó, o el
 * alumno de otro local que ahora abre el suyo, teclea su correo de siempre y
 * «ese correo ya existe» lo manda a buscar otra pantalla que no hay. Así que si
 * la cuenta ya existe se intenta ENTRAR con la contraseña que acaba de
 * escribir, y solo si no es la suya se le dice.
 */
export async function startWithEmail(_previous: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const plan = form.get('plan');

  if (email.length === 0 || password.length === 0) {
    return { error: 'Escribe tu correo y una contraseña.' };
  }
  if (password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' };

  let identity: FirebaseIdentity;
  try {
    identity = await signUpWithEmail(email, password);
  } catch (error) {
    if (!(error instanceof FirebaseAuthError)) {
      return { error: 'No se pudo crear la cuenta. Intenta de nuevo.' };
    }
    if (error.code !== 'EMAIL_EXISTS') return { error: error.message };

    try {
      identity = await signInWithEmailIdentity(email, password);
    } catch {
      return {
        error:
          'Ese correo ya tiene cuenta en Sinchi y la contraseña no coincide. ' +
          'Escribe la de esa cuenta para seguir con ella.',
      };
    }
  }

  await writeSignupIdentity({ ...identity, provider: 'email' });
  redirect(nextStep(plan));
}

/** Vuelve al primer paso con otra cuenta. La credencial guardada se borra. */
export async function switchAccount(): Promise<void> {
  await clearSignupIdentity();
  redirect('/registrar');
}

/**
 * Un celular tecleado como se teclea en Perú, en la forma que guarda la red.
 *
 * `checkPhoneNumber` exige el código de país porque en la base conviven
 * celulares de varios, pero quien llena este formulario está en Lima y escribe
 * «987 654 321». La app resuelve esto con un selector de país que arranca en
 * Perú; aquí se asume lo mismo: sin `+`, es peruano.
 */
function asStoredPhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 0 ? '' : `+51${digits}`;
}

/**
 * Paso 2: el gimnasio.
 *
 * Firma con la credencial que dejó el paso 1 y, si la api acepta, deja al
 * dueño DENTRO del panel con la sesión que el alta devuelve, igual que la app
 * lo dejaba en modo staff. Lo que no puede hacer la web es lo que sigue —crear
 * sus planes y su horario—, así que la página de llegada lo manda a la app con
 * las instrucciones.
 */
export async function createGym(_previous: FormState, form: FormData): Promise<FormState> {
  const identity = await readSignupIdentity();
  // La cookie venció mientras llenaba el formulario. Se le dice al volver.
  if (identity === null) redirect('/registrar?motivo=vencida');

  const text = (name: string): string => String(form.get(name) ?? '').trim();

  const ownerName = text('ownerName');
  const documentId = text('documentId');
  const phone = asStoredPhone(text('phone'));
  const gymName = text('gymName');
  const taxId = text('taxId');
  const address = text('address');
  const tier = asTier(text('saasTier'));
  const promoCode = text('promoCode');

  if (ownerName.length < 2) return { error: 'Escribe tu nombre.' };
  if (documentId.length < 6) {
    return { error: 'Falta tu documento: es lo que te identifica en la red.' };
  }
  const phoneDenial = checkPhoneNumber(phone);
  if (phoneDenial !== null) return { error: phoneDenialMessage(phoneDenial) };

  if (gymName.length < 3) return { error: 'El nombre del gimnasio es demasiado corto.' };
  if (taxId.length > 0) {
    const rucDenial = checkRuc(taxId);
    if (rucDenial !== null) return { error: rucDenialMessage(rucDenial) };
  }
  if (address.length < ADDRESS_MIN) {
    return {
      error:
        'Escribe dónde queda tu gimnasio: calle, número y distrito. Es lo primero que mira quien busca dónde entrenar.',
    };
  }
  if (tier === null) return { error: 'Elige un plan.' };

  // Solo las que llenó: vacías no viajan, y la api entiende ausente como «no
  // tiene», que es lo que son.
  const links: Partial<Record<GymLinkKind, string>> = {};
  for (const kind of GYM_LINK_KINDS) {
    const value = text(`link_${kind}`);
    if (value.length === 0) continue;
    const denial = checkGymLink(kind, value);
    if (denial !== null) return { error: gymLinkDenialMessage(denial) };
    links[kind] = value;
  }

  let signUp: WireSignUpGym;
  try {
    signUp = await postPublic<WireSignUpGym>('/gyms/signup', {
      idToken: identity.idToken,
      gymName,
      // Vacío se manda como ausente y no como '': la columna guarda NULL, que
      // es «no tiene». Una cadena vacía sería «tiene uno que es nada».
      taxId: taxId.length > 0 ? taxId : undefined,
      saasTier: tier,
      address,
      ownerName,
      documentId,
      phone,
      promoCode: promoCode.length > 0 ? promoCode : undefined,
      links,
    });
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      // El token de Firebase venció antes que la cookie. Se vuelve a empezar.
      await clearSignupIdentity();
      redirect('/registrar?motivo=vencida');
    }
    if (error instanceof ApiError) return { error: error.message };
    return { error: 'No se pudo crear el gimnasio. Intenta de nuevo.' };
  }

  await clearSignupIdentity();
  await writeSession(
    {
      accessToken: signUp.session.accessToken,
      role: signUp.session.role,
      tenantId: signUp.session.tenantId,
      userId: signUp.session.userId,
      tenantName: signUp.name,
    },
    signUp.session.expiresInSeconds,
  );

  // Lo que la página de llegada necesita decir, y nada más: hasta cuándo es
  // gratis y qué pasó con el código. Van por la URL porque la sesión no los
  // guarda y no vale la pena una cookie para una sola pantalla.
  const params = new URLSearchParams({ hasta: signUp.freeUntil });
  if (signUp.promo !== null) {
    params.set('codigo', signUp.promo.applied ? 'aplicado' : signUp.promo.reason);
  }
  redirect(`/registrar/listo?${params.toString()}`);
}
