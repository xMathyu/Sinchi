/**
 * Solicitudes de vínculo, del lado de la persona.
 *
 * Un gimnasio la inscribió y espera que acepte: hasta entonces no aparece en su
 * billetera (decisiones §14). Mismo criterio de credencial que las reservas —con
 * sesión va por `/me`, con solo la cuenta de Firebase por la ruta pública—, y por
 * la misma razón: quien más solicitudes recibe es justo quien todavía no tiene
 * ficha en ningún sitio.
 */
import {
  acceptGuestLinkRequest,
  acceptMyLinkRequest,
  fetchGuestLinkRequests,
  fetchMyLinkRequests,
  rejectGuestLinkRequest,
  rejectMyLinkRequest,
  type LinkRequestDto,
} from './api';
import { hydrate } from './hydrate';
import { saveSession } from './session';
import { bookingCredential } from './trials';

export async function myLinkRequests(): Promise<readonly LinkRequestDto[]> {
  const credential = bookingCredential();
  if (credential.kind === 'session') return fetchMyLinkRequests();
  if (credential.kind === 'none') return [];
  return fetchGuestLinkRequests(credential.idToken);
}

/**
 * Acepta.
 *
 * Sin ficha, aceptar ES entrar: la api responde con la sesión, y guardarla basta
 * para que `SessionRouter` la lleve a su billetera. Con ficha, el gimnasio nuevo
 * se suma a la billetera que ya tenía, y hay que volver a traerla o seguiría sin
 * aparecer hasta la próxima carga.
 */
export async function acceptLinkRequest(requestId: string): Promise<void> {
  const credential = bookingCredential();
  if (credential.kind === 'session') {
    await acceptMyLinkRequest(requestId);
    await hydrate();
    return;
  }
  if (credential.kind === 'none') throw new Error('Entra con tu cuenta para aceptar.');

  const session = await acceptGuestLinkRequest(requestId, credential.idToken);
  await saveSession({
    accessToken: session.accessToken,
    expiresInSeconds: session.expiresInSeconds,
    role: session.role,
    userId: session.userId,
    tenantId: session.tenantId,
  });
}

export async function rejectLinkRequest(requestId: string): Promise<void> {
  const credential = bookingCredential();
  if (credential.kind === 'session') {
    await rejectMyLinkRequest(requestId);
    return;
  }
  if (credential.kind === 'none') throw new Error('Entra con tu cuenta para contestar.');
  await rejectGuestLinkRequest(requestId, credential.idToken);
}
