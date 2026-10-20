/**
 * Paso 1 del alta: la oferta y la cuenta.
 *
 * Server Component: decide si hay Google configurado y si ya hay una
 * credencial guardada —en cuyo caso el paso 1 ya está hecho y se salta al 2—.
 * El formulario es cliente porque necesita enseñar el motivo del rechazo sin
 * recargar.
 */
import { redirect } from 'next/navigation';
import { AccountStep } from '@/components/signup/AccountStep';
import { SignupFrame } from '@/components/signup/Frame';
import { Offer } from '@/components/signup/Offer';
import { googleReady } from '@/src/panel/firebase';
import { asTier } from '@/src/signup/tiers';
import { readSignupIdentity } from '@/src/signup/session';

/** Lee la cookie del alta, así que no se prerenderiza. */
export const dynamic = 'force-dynamic';

export default async function RegistrarPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly plan?: string; readonly motivo?: string }>;
}) {
  const { plan, motivo } = await searchParams;
  const tier = asTier(plan);

  if ((await readSignupIdentity()) !== null) {
    redirect(tier === null ? '/registrar/gimnasio' : `/registrar/gimnasio?plan=${tier}`);
  }

  const notice =
    motivo === 'vencida'
      ? 'Tu registro tardó más de lo que dura la credencial. Vuelve a entrar con tu cuenta y sigues donde estabas: no se creó nada.'
      : null;

  return (
    <SignupFrame aside={<Offer />}>
      <AccountStep
        googleClientId={googleReady() ? (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null) : null}
        plan={tier}
        notice={notice}
      />
    </SignupFrame>
  );
}
