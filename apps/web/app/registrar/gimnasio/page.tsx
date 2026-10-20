/**
 * Paso 2 del alta: el gimnasio.
 *
 * Sin credencial guardada no hay nada que firmar, así que se vuelve al paso 1.
 * Al formulario le llega solo lo que se puede enseñar de la cuenta —correo y
 * nombre—, nunca el token: ese se queda en la cookie y lo lee la acción.
 */
import { redirect } from 'next/navigation';
import { SignupFrame } from '@/components/signup/Frame';
import { GymForm } from '@/components/signup/GymForm';
import { Offer } from '@/components/signup/Offer';
import { asTier } from '@/src/signup/tiers';
import { readSignupIdentity } from '@/src/signup/session';

/** Lee la cookie del alta, así que no se prerenderiza. */
export const dynamic = 'force-dynamic';

export default async function GimnasioPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly plan?: string }>;
}) {
  const identity = await readSignupIdentity();
  if (identity === null) redirect('/registrar');

  const { plan } = await searchParams;

  return (
    <SignupFrame aside={<Offer compact />}>
      <GymForm
        identity={{ email: identity.email, displayName: identity.displayName }}
        defaultTier={asTier(plan) ?? 'free'}
      />
    </SignupFrame>
  );
}
