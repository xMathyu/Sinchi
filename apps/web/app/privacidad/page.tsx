import type { Metadata } from 'next';
import { DataList, LegalPage, Section } from '@/components/Legal';

export const metadata: Metadata = {
  title: 'Privacidad · Sinchi',
  description: 'Qué datos guarda Sinchi, para qué, con quién se comparten y cómo pedir que se borren.',
  // La politica se enlaza desde las fichas de las tiendas, no se busca en
  // Google, y una politica indexada compite con la portada por la marca.
  robots: { index: false, follow: true },
};

export default function Privacidad() {
  return (
    <LegalPage
      title="Qué hacemos con tus datos"
      updated="4 de septiembre de 2026"
      intro={
        <>
          Sinchi es la app con la que un gimnasio lleva su padrón, marca la asistencia y registra los
          pagos. Para eso guarda datos de personas, y esta página dice exactamente cuáles, para qué, y
          qué puedes hacer al respecto. Está escrita para que se entienda leyéndola una vez.
        </>
      }
    >
      <Section id="quien-responde" title="Quién responde por tus datos">
        <p>
          Depende de quién seas, y la diferencia es real, no un tecnicismo.
        </p>
        <p>
          <strong style={{ color: 'var(--ink)' }}>Si eres alumno de un gimnasio</strong>, quien decide qué
          datos tuyos se guardan es <em>el gimnasio</em>. Él te inscribió, él fija su plan y él te cobra.
          Sinchi es la herramienta que usa para hacerlo, y trata tus datos por encargo suyo y siguiendo
          sus instrucciones. Si quieres que corrijan tu nombre o tu plan, el camino más rápido es tu
          gimnasio.
        </p>
        <p>
          <strong style={{ color: 'var(--ink)' }}>Si eres el gimnasio</strong>, nosotros respondemos por los
          datos de tu cuenta: quién eres, cómo te contactamos y qué nos pagas por usar Sinchi.
        </p>
        <p>
          En los dos casos nos escribes al mismo sitio:{' '}
          <a href="mailto:soporte@sinchi.fit">soporte@sinchi.fit</a>.
        </p>
      </Section>

      <Section id="que-guardamos" title="Qué guardamos, y para qué">
        <p>De un alumno:</p>
        <DataList
          items={[
            ['Nombre', 'Para que el gimnasio sepa a quién está cobrando y a quién deja pasar.'],
            ['Documento', 'Identifica a la persona cuando hay dos alumnos con el mismo nombre.'],
            ['Teléfono', 'Es la llave del alumno en el padrón, y por donde el gimnasio le avisa.'],
            ['Correo', 'Opcional. Sirve para la invitación a la app y para recuperar el acceso.'],
            ['Foto', 'Opcional. La sube el gimnasio para reconocer a quien llega al mostrador.'],
            ['Asistencias', 'Fecha, hora y clase de cada vez que marcas, y si fue por QR o a mano.'],
            ['Plan y pagos', 'Qué plan tienes, cuánto se cobró, por qué medio y quién lo registró.'],
          ]}
        />
        <p style={{ marginTop: 8 }}>Del personal del gimnasio: nombre, correo, el rol que tiene y —
          si activó la verificación en dos pasos — su clave de segundo factor, que se guarda cifrada.</p>
        <p>
          También queda registro de quién reserva una clase de prueba o se inscribe a un evento: nombre,
          teléfono y correo. Eso lo puede dejar alguien que todavía no es alumno.
        </p>
      </Section>

      <Section id="tarjetas" title="Las tarjetas">
        <p>
          <strong style={{ color: 'var(--ink)' }}>El número de tu tarjeta no pasa por Sinchi ni se guarda en
          ninguna base nuestra.</strong> Cuando el cobro con tarjeta esté activo, lo procesa Culqi, una
          pasarela de pagos peruana, y cada gimnasio lo hace con su propia cuenta. De vuelta sólo
          guardamos un identificador que da Culqi, la marca de la tarjeta, los últimos cuatro dígitos y
          el mes de vencimiento — lo justo para que reconozcas cuál es en una lista.
        </p>
        <p>
          En esta versión de la app el cobro con tarjeta todavía no está encendido. Los pagos se
          registran como lo que son: efectivo, Yape o transferencia, anotados por quien los recibió en
          el mostrador.
        </p>
      </Section>

      <Section id="permisos" title="Los permisos que te pide el teléfono">
        <p>
          <strong style={{ color: 'var(--ink)' }}>Cámara.</strong> Sólo para leer el código QR en la puerta.
          La cámara lee el código y nada más: no se toma ninguna foto, no se guarda ninguna imagen y no
          sale nada de tu teléfono.
        </p>
        <p>
          <strong style={{ color: 'var(--ink)' }}>Fotos y videos.</strong> Sólo cuando el gimnasio sube un
          video a sus rutinas, y sólo el archivo que elija en ese momento. La app no recorre tu galería
          ni mira nada que no hayas seleccionado.
        </p>
        <p>
          Sinchi <strong style={{ color: 'var(--ink)' }}>no pide tu ubicación</strong> y{' '}
          <strong style={{ color: 'var(--ink)' }}>no graba audio</strong>. No hay publicidad dentro de la app
          y no vendemos datos a nadie. Tampoco hay rastreadores de terceros siguiéndote entre apps.
        </p>
      </Section>

      <Section id="terceros" title="Con quién se comparten">
        <p>Con nadie más que con quien hace falta para que la app funcione:</p>
        <DataList
          items={[
            ['Tu gimnasio', 'Ve tu ficha, tus pagos y tus asistencias. Es de quien eres alumno.'],
            ['Google Firebase', 'Verifica quién eres al entrar, con tu correo o tu cuenta de Google.'],
            ['Google Cloud', 'Los servidores y el almacenamiento de los videos de rutinas.'],
            ['Neon', 'La base de datos donde vive el padrón.'],
            ['Resend', 'Envía los correos de invitación y de aviso.'],
            ['Culqi', 'Procesa el pago con tarjeta, cuando el gimnasio lo tenga activo.'],
          ]}
        />
        <p style={{ marginTop: 8 }}>
          Un gimnasio ve a sus alumnos y sólo a los suyos. La separación no depende de que el código se
          acuerde de filtrar: está impuesta en la base de datos misma.
        </p>
        <p>
          Estos proveedores están fuera del Perú, así que tus datos se procesan en el extranjero.
          También entregaríamos datos si nos los exige una autoridad competente por un mandato válido.
        </p>
      </Section>

      <Section id="cuanto" title="Cuánto tiempo los guardamos">
        <p>
          Mientras seas alumno del gimnasio, y después mientras el gimnasio siga usando Sinchi — una
          matrícula vieja es lo que le permite saber quién ya estuvo y volvió.
        </p>
        <p>
          Los cobros son la excepción, y conviene decirlo claro: un pago registrado es un asiento
          contable del gimnasio, así que aunque borres tu cuenta el monto y la fecha se quedan, ya sin
          tu nombre pegado. Lo que se va es quién eras; lo que queda es que ese día entró ese dinero.
        </p>
      </Section>

      <Section id="derechos" title="Lo que puedes pedir">
        <p>
          La Ley 29733 de Protección de Datos Personales te da derecho a saber qué tenemos tuyo, a que
          lo corrijamos si está mal, a que lo borremos y a oponerte a que lo usemos. Ejercerlos es
          gratis y no tienes que explicar por qué.
        </p>
        <p>
          Escríbenos a <a href="mailto:soporte@sinchi.fit">soporte@sinchi.fit</a> desde el correo con el
          que estás registrado y te respondemos en un máximo de 30 días. Para borrar tu cuenta hay una
          página que explica el paso a paso:{' '}
          <a href="/eliminar-cuenta">cómo eliminar tu cuenta</a>.
        </p>
      </Section>

      <Section id="menores" title="Menores de edad">
        <p>
          Un gimnasio puede tener alumnos menores de edad, y Sinchi guarda su ficha igual que la de
          cualquier otro. Cuando eso pasa, es el gimnasio quien tiene que haber recogido el permiso del
          padre, la madre o el tutor antes de inscribirlo — igual que hace para la matrícula en papel.
          La app no está dirigida a menores ni se les ofrece directamente.
        </p>
      </Section>

      <Section id="seguridad" title="Cómo lo cuidamos">
        <p>
          Todo viaja cifrado. Las claves de segundo factor y las credenciales de pasarela de cada
          gimnasio se guardan cifradas también, nunca en texto plano y nunca en un registro de errores.
          El acceso a los datos de un gimnasio está limitado en la propia base de datos, no sólo en la
          aplicación.
        </p>
        <p>
          Ningún sistema es infalible. Si alguna vez hubiera una brecha que te afecte, te lo diríamos a
          ti y a la autoridad, sin adornos.
        </p>
      </Section>

      <Section id="cambios" title="Si esto cambia">
        <p>
          Cuando cambiemos algo importante actualizamos la fecha de arriba y te avisamos dentro de la
          app antes de que aplique. Seguir usando Sinchi después de eso es aceptar la versión nueva; si
          no te parece, puedes pedir que borremos tu cuenta.
        </p>
      </Section>

      <Section id="contacto" title="Contacto">
        <p>
          Sinchi · Lima, Perú ·{' '}
          <a href="mailto:soporte@sinchi.fit">soporte@sinchi.fit</a>
        </p>
        <p className="tertiary" style={{ fontSize: 13 }}>
          Si escribiste y no te respondimos, puedes reclamar ante la Autoridad Nacional de Protección de
          Datos Personales del Ministerio de Justicia.
        </p>
      </Section>
    </LegalPage>
  );
}
