import type { Metadata } from 'next';
import { LegalPage, Section } from '@/components/Legal';

export const metadata: Metadata = {
  title: 'Eliminar mi cuenta · Sinchi',
  description: 'Cómo pedir que se borre tu cuenta de Sinchi y qué pasa con tus datos.',
  robots: { index: false, follow: true },
};

/**
 * La URL de borrado de cuenta que Google Play exige.
 *
 * La pide para toda app que permita registrarse, tiene que funcionar sin iniciar
 * sesion —quien ya no puede entrar es justo el que necesita esta pagina— y tiene
 * que decir que se borra y que se queda. Va enlazada desde el formulario de
 * Seguridad de los Datos de la ficha.
 */
export default function EliminarCuenta() {
  return (
    <LegalPage
      title="Eliminar tu cuenta"
      updated="4 de septiembre de 2026"
      intro={
        <>
          Puedes pedir que borremos tu cuenta de Sinchi cuando quieras. Es gratis, no tienes que decir
          por qué, y no hace falta que puedas entrar a la app para pedirlo.
        </>
      }
    >
      <Section id="como" title="Cómo se pide">
        <p>
          Escribe a <a href="mailto:soporte@sinchi.fit?subject=Eliminar%20mi%20cuenta">soporte@sinchi.fit</a>{' '}
          con el asunto <strong style={{ color: 'var(--ink)' }}>«Eliminar mi cuenta»</strong>, desde el correo
          con el que estás registrado, y dinos el teléfono con el que te inscribieron en el gimnasio.
        </p>
        <p>
          Pedimos esas dos cosas por una razón: son las que nos dejan comprobar que la cuenta es tuya.
          Borrar la ficha de un alumno porque alguien más lo pidió sería el peor error posible, así que
          si el correo no coincide te vamos a pedir algo más antes de tocar nada.
        </p>
        <p>
          Si sigues siendo alumno activo de un gimnasio, también puedes pedírselo directamente a él en
          el mostrador: tu gimnasio puede dar de baja tu acceso sin esperar a que nosotros respondamos.
        </p>
      </Section>

      <Section id="cuanto-tarda" title="Cuánto tarda">
        <p>
          Confirmamos que recibimos la solicitud en un máximo de 48 horas y completamos el borrado
          dentro de los 30 días siguientes. Las copias de respaldo se sobrescriben en su propio ciclo,
          así que un dato puede sobrevivir ahí hasta 90 días antes de desaparecer del todo.
        </p>
      </Section>

      <Section id="que-se-borra" title="Qué se borra">
        <p>Todo lo que te identifica:</p>
        <ul className="body" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <li>Tu nombre, documento, teléfono, correo y foto.</li>
          <li>Tu acceso a la app y la cuenta con la que entras.</li>
          <li>Tus reservas de clase de prueba y tus inscripciones a eventos.</li>
          <li>El historial de qué días marcaste asistencia y a qué clases.</li>
        </ul>
      </Section>

      <Section id="que-se-queda" title="Qué se queda, y por qué">
        <p>
          Los pagos que te registró el gimnasio. No la ficha con tu nombre — eso se va — sino el
          asiento: que tal día entraron tantos soles por una mensualidad, sin decir de quién.
        </p>
        <p>
          Es la única excepción y no es un capricho nuestro: un gimnasio tiene que poder cuadrar su caja
          y responder ante la SUNAT por lo que facturó, y no puede hacerlo si borrar una cuenta le
          arranca ingresos de meses cerrados. Lo que desaparece es el vínculo contigo.
        </p>
      </Section>

      <Section id="ojo" title="Una cosa que conviene saber antes">
        <p>
          Borrar la cuenta no cancela tu membresía ni te devuelve lo pagado. Son cosas distintas: la
          membresía la das de baja con tu gimnasio. Si borras la cuenta y sigues yendo a entrenar, el
          gimnasio va a tener que inscribirte otra vez desde cero, y tu historial de asistencias ya no
          va a estar.
        </p>
      </Section>
    </LegalPage>
  );
}
