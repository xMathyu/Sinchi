'use client';

/**
 * El editor de una rutina, con sus pasos.
 *
 * La api recibe la rutina COMPLETA y no un parche, así que este formulario manda
 * todo lo que tiene. Es lo correcto para un editor de una sola pantalla: un
 * parche por campo abriría la puerta a guardar media rutina.
 *
 * Los pasos son campos repetidos con el mismo `name`, y el orden del DOM ES la
 * `position`. Numerarlos aparte permitiría que la lista guardada no coincidiera
 * con la que la persona acaba de ordenar.
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Alert } from './Pieces';
import {
  borrarRutina,
  cambiarEstadoRutina,
  guardarRutina,
} from '../../src/panel/actions';
import { IDLE } from '../../src/panel/form-state';
import type { WireRoutineItem } from '../../src/panel/types';

interface Paso {
  readonly key: string;
  readonly title: string;
  readonly prescription: string;
  readonly instructions: string;
  readonly videoUrl: string;
}

const PASO_VACIO = (): Paso => ({
  key: crypto.randomUUID(),
  title: '',
  prescription: '',
  instructions: '',
  videoUrl: '',
});

export function RutinaEditor({
  routineId,
  inicial,
  publicada,
  pasosIniciales,
}: {
  readonly routineId: string | null;
  readonly inicial: {
    readonly title: string;
    readonly summary: string;
    readonly level: string;
    readonly visibility: string;
    readonly videoUrl: string;
    readonly videoAssetId: string;
  };
  readonly publicada: boolean;
  readonly pasosIniciales: readonly WireRoutineItem[];
}) {
  const [state, action] = useActionState(guardarRutina, IDLE);
  const router = useRouter();

  const [pasos, setPasos] = useState<readonly Paso[]>(() =>
    pasosIniciales.length === 0
      ? [PASO_VACIO()]
      : pasosIniciales.map((item) => ({
          key: item.id,
          title: item.title,
          prescription: item.prescription ?? '',
          instructions: item.instructions ?? '',
          videoUrl: item.videoUrl ?? '',
        })),
  );

  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const cambiarEstado = async () => {
    if (routineId === null) return;
    setTrabajando(true);
    const resultado = await cambiarEstadoRutina(routineId, publicada ? 'draft' : 'published');
    setTrabajando(false);
    setAviso(resultado.error ?? resultado.ok ?? null);
    router.refresh();
  };

  const borrar = async () => {
    if (routineId === null) return;
    setTrabajando(true);
    // La api solo deja borrar lo NO publicado: una rutina que los alumnos ya
    // abren no se va sin pasar antes por borrador. El 409 vuelve con su frase.
    const resultado = await borrarRutina(routineId);
    setTrabajando(false);
    if (resultado.error !== null) setAviso(resultado.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!aviso ? null : <Alert kind="ok">{aviso}</Alert>}

      <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {routineId === null ? null : <input type="hidden" name="routineId" value={routineId} />}
        {/* El estado se conserva al guardar: publicar y despublicar es una ruta
            propia con su botón. Un editor que despublica al guardar es la
            sorpresa que hace que nadie se atreva a corregir una falta. */}
        <input type="hidden" name="published" value={String(publicada)} />
        <input type="hidden" name="videoAssetId" value={inicial.videoAssetId} />

        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>La rutina</h2>

          <label className="panel-field">
            <span>Título</span>
            <input
              name="title"
              required
              minLength={2}
              maxLength={120}
              defaultValue={inicial.title}
              placeholder="Tomoe nage"
              className="panel-input"
            />
          </label>

          <label className="panel-field">
            <span>De qué va, en dos líneas</span>
            <textarea
              name="summary"
              maxLength={1000}
              defaultValue={inicial.summary}
              placeholder="La entrada completa, del agarre a la caída."
              className="panel-textarea"
            />
          </label>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="panel-field" style={{ flex: '1 1 170px' }}>
              <span>Nivel</span>
              <select name="level" className="panel-select" defaultValue={inicial.level}>
                <option value="">Sin nivel</option>
                <option value="beginner">Principiante</option>
                <option value="intermediate">Intermedio</option>
                <option value="advanced">Avanzado</option>
              </select>
            </label>

            <label className="panel-field" style={{ flex: '1 1 170px' }}>
              <span>Quién la ve</span>
              <select name="visibility" className="panel-select" defaultValue={inicial.visibility}>
                <option value="members">Solo mis alumnos</option>
                <option value="public">Pública — escaparate</option>
              </select>
            </label>
          </div>

          {inicial.videoAssetId.length > 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
              Esta rutina tiene un video subido. Para cambiarlo por un enlace, primero quita el
              archivo.
            </p>
          ) : (
            <label className="panel-field">
              <span>Enlace del video (YouTube o Vimeo)</span>
              <input
                name="videoUrl"
                type="url"
                maxLength={600}
                defaultValue={inicial.videoUrl}
                placeholder="https://youtu.be/…"
                className="panel-input"
              />
            </label>
          )}
        </section>

        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Los pasos</h2>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              el orden de aquí es el que ve el alumno
            </span>
          </div>

          {pasos.map((paso, i) => (
            <fieldset
              key={paso.key}
              style={{
                margin: 0,
                padding: 14,
                border: '1px solid var(--hairline)',
                borderRadius: 'var(--r-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              <legend style={{ padding: '0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)' }}>
                Paso {i + 1}
              </legend>

              <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
                <label className="panel-field" style={{ flex: '2 1 200px' }}>
                  <span>Qué es</span>
                  <input
                    name="itemTitle"
                    maxLength={120}
                    defaultValue={paso.title}
                    placeholder="Entrada y desequilibrio"
                    className="panel-input"
                  />
                </label>
                <label className="panel-field" style={{ flex: '1 1 150px' }}>
                  <span>Cuánto</span>
                  <input
                    name="itemPrescription"
                    maxLength={120}
                    defaultValue={paso.prescription}
                    placeholder="5 minutos de uchikomi"
                    className="panel-input"
                  />
                </label>
              </div>

              <label className="panel-field">
                <span>Instrucciones</span>
                <textarea
                  name="itemInstructions"
                  maxLength={4000}
                  defaultValue={paso.instructions}
                  className="panel-textarea"
                />
              </label>

              <label className="panel-field">
                <span>Video del paso (opcional)</span>
                <input
                  name="itemVideoUrl"
                  type="url"
                  maxLength={600}
                  defaultValue={paso.videoUrl}
                  className="panel-input"
                />
              </label>

              {pasos.length === 1 ? null : (
                <button
                  type="button"
                  className="panel-btn ghost"
                  onClick={() => setPasos((antes) => antes.filter((p) => p.key !== paso.key))}
                  style={{ alignSelf: 'flex-start', padding: '7px 12px', fontSize: 13 }}
                >
                  Quitar este paso
                </button>
              )}
            </fieldset>
          ))}

          <button
            type="button"
            className="panel-btn ghost"
            onClick={() => setPasos((antes) => [...antes, PASO_VACIO()])}
            style={{ alignSelf: 'flex-start' }}
          >
            + Añadir paso
          </button>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Un paso sin título no se guarda: es la fila en blanco que queda al final para escribir
            el siguiente.
          </p>
        </section>

        {!state.error ? null : <Alert kind="bad">{state.error}</Alert>}
        {!state.ok ? null : <Alert kind="ok">{state.ok}</Alert>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Guardar />

          {routineId === null ? null : (
            <>
              <button
                type="button"
                className="panel-btn ghost"
                onClick={() => void cambiarEstado()}
                disabled={trabajando}
              >
                {publicada ? 'Volver a borrador' : 'Publicar'}
              </button>

              {/* Apagado y no escondido cuando está publicada: quien busca el
                  botón tiene que encontrarlo y entender por qué no responde. */}
              <button
                type="button"
                className="panel-btn danger"
                onClick={() => void borrar()}
                disabled={trabajando || publicada}
                title={
                  publicada
                    ? 'Primero vuélvela a borrador: tus alumnos la están viendo.'
                    : undefined
                }
              >
                Borrar
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

function Guardar() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar'}
    </button>
  );
}
