import { describe, expect, it } from 'vitest';
import {
  checkRoutineDraft,
  isValidRoutineDraft,
  routineDenialMessage,
  ROUTINE_MAX_ITEMS,
  ROUTINE_TITLE_MAX,
  type RoutineDraft,
  type RoutineItemDraft,
} from './draft.js';

function step(overrides: Partial<RoutineItemDraft> = {}): RoutineItemDraft {
  return {
    title: 'Uchimata',
    instructions: 'Entra con el kuzushi al frente y levanta con la pierna.',
    videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
    videoAssetId: null,
    prescription: '5 minutos de uchikomi',
    ...overrides,
  };
}

function draft(overrides: Partial<RoutineDraft> = {}): RoutineDraft {
  return {
    title: 'Día de pecho',
    summary: 'Empuje horizontal, cuatro ejercicios.',
    videoUrl: null,
    videoAssetId: null,
    level: 'beginner',
    visibility: 'public',
    items: [step()],
    ...overrides,
  };
}

describe('el título', () => {
  it('acepta uno normal', () => {
    expect(checkRoutineDraft(draft())).toBeNull();
  });

  it('exige que diga algo', () => {
    expect(checkRoutineDraft(draft({ title: 'x' }))?.code).toBe('title_too_short');
    expect(checkRoutineDraft(draft({ title: '   ' }))?.code).toBe('title_too_short');
  });

  it('acota lo que cabe en la columna', () => {
    expect(checkRoutineDraft(draft({ title: 'x'.repeat(ROUTINE_TITLE_MAX + 1) }))?.code).toBe(
      'title_too_long',
    );
    expect(checkRoutineDraft(draft({ summary: 'x'.repeat(401) }))?.code).toBe(
      'summary_too_long',
    );
  });
});

/**
 * Las dos formas de publicar, y las dos tienen que pasar: el "día de pecho" son
 * varios pasos; el "uchimata" es un video y una explicación, sin pasos.
 */
describe('rutina con pasos y técnica suelta', () => {
  it('acepta la rutina de varios ejercicios', () => {
    expect(isValidRoutineDraft(draft({ items: [step(), step({ title: 'Fondos' })] }))).toBe(true);
  });

  it('acepta la técnica suelta: su video y nada más', () => {
    expect(
      isValidRoutineDraft(
        draft({
          title: 'Tomoe nage',
          summary: null,
          videoUrl: 'https://vimeo.com/123456789',
          items: [],
        }),
      ),
    ).toBe(true);
  });

  it('acepta la que solo explica, sin video', () => {
    expect(
      isValidRoutineDraft(draft({ videoUrl: null, summary: 'Cómo calentar el hombro.', items: [] })),
    ).toBe(true);
  });

  /**
   * Un título suelto en la lista del directorio le dice a quien busca dojo que
   * este está vacío — lo contrario de para lo que existe la biblioteca.
   */
  it('rechaza el título suelto: sin video, sin explicación y sin pasos', () => {
    expect(checkRoutineDraft(draft({ videoUrl: null, summary: null, items: [] }))?.code).toBe(
      'nothing_to_show',
    );
    expect(checkRoutineDraft(draft({ videoUrl: '  ', summary: '   ', items: [] }))?.code).toBe(
      'nothing_to_show',
    );
  });

  it('corta el temario de cuarenta y un ejercicios', () => {
    const muchos = Array.from({ length: ROUTINE_MAX_ITEMS + 1 }, () => step());
    expect(checkRoutineDraft(draft({ items: muchos }))?.code).toBe('too_many_items');
  });
});

describe('los enlaces de video', () => {
  it('rechaza el de la rutina cuando no se entiende', () => {
    expect(checkRoutineDraft(draft({ videoUrl: 'mi video' }))?.code).toBe('bad_video_link');
  });

  /**
   * Sin el número del paso, «ese enlace no se entiende» en una rutina de ocho
   * ejercicios manda al dueño a revisarlos todos.
   */
  it('dice EN QUÉ paso está el enlace roto', () => {
    const denial = checkRoutineDraft(
      draft({ items: [step(), step({ videoUrl: 'http://inseguro.pe/v.mp4' })] }),
    );
    expect(denial).toEqual({ code: 'item_bad_video_link', itemIndex: 1 });
    expect(routineDenialMessage(denial!)).toContain('Paso 2');
  });

  it('un paso sin video es legítimo: no todo ejercicio tiene grabación', () => {
    expect(isValidRoutineDraft(draft({ items: [step({ videoUrl: null })] }))).toBe(true);
  });
});

/**
 * Subir el video es la otra mitad de la biblioteca: el profesor graba en el
 * tatami y eso sale en la app sin abrir cuenta en ningún sitio.
 */
describe('el video subido', () => {
  it('cuenta como contenido: una técnica con su archivo y nada más vale', () => {
    expect(
      isValidRoutineDraft(
        draft({ summary: null, videoUrl: null, videoAssetId: 'asset-1', items: [] }),
      ),
    ).toBe(true);
  });

  /**
   * Con los dos puestos hay dos videos para un mismo paso y quien lee decide
   * cuál gana; el día que la app y el panel decidan distinto, el alumno y el
   * dueño están mirando cosas distintas.
   */
  it('rechaza tener archivo y enlace a la vez', () => {
    expect(
      checkRoutineDraft(
        draft({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ', videoAssetId: 'asset-1' }),
      )?.code,
    ).toBe('both_video_sources');
  });

  it('y lo dice con el número del paso cuando pasa en uno', () => {
    expect(
      checkRoutineDraft(
        draft({
          items: [step(), step({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ', videoAssetId: 'a' })],
        }),
      ),
    ).toEqual({ code: 'both_video_sources', itemIndex: 1 });
  });
});

describe('los pasos', () => {
  it('exigen nombre', () => {
    expect(checkRoutineDraft(draft({ items: [step({ title: ' ' })] }))).toEqual({
      code: 'item_title_too_short',
      itemIndex: 0,
    });
  });

  it('acotan instrucciones y series', () => {
    expect(
      checkRoutineDraft(draft({ items: [step({ instructions: 'x'.repeat(2001) })] }))?.code,
    ).toBe('item_instructions_too_long');
    expect(
      checkRoutineDraft(draft({ items: [step({ prescription: 'x'.repeat(61) })] }))?.code,
    ).toBe('item_prescription_too_long');
  });

  it('todo lo demás puede faltar', () => {
    expect(
      isValidRoutineDraft(
        draft({
          items: [
            { title: 'Fondos', instructions: null, videoUrl: null, videoAssetId: null, prescription: null },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('los mensajes', () => {
  it('cada motivo tiene el suyo, y ninguno se queda vacío', () => {
    const denials = [
      { code: 'title_too_short' },
      { code: 'title_too_long' },
      { code: 'summary_too_long' },
      { code: 'bad_video_link' },
      { code: 'both_video_sources' },
      { code: 'nothing_to_show' },
      { code: 'too_many_items' },
      { code: 'item_title_too_short', itemIndex: 0 },
      { code: 'item_title_too_long', itemIndex: 0 },
      { code: 'item_instructions_too_long', itemIndex: 0 },
      { code: 'item_prescription_too_long', itemIndex: 0 },
      { code: 'item_bad_video_link', itemIndex: 0 },
    ] as const;

    for (const denialOf of denials) {
      expect(routineDenialMessage(denialOf).length).toBeGreaterThan(10);
    }
  });
});
