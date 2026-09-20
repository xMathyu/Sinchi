/**
 * Tema de la app.
 *
 * Dos temas —claro y oscuro— y una sola decisión sobre cuál toca, tomada aquí:
 * la preferencia guardada manda, y si dice `system`, manda el teléfono. La
 * pantalla nunca pregunta ninguna de las dos cosas; pregunta `theme.colors.X` y
 * ya viene resuelto.
 *
 * Por qué contexto y no `useSyncExternalStore` como la sesión: aquí la
 * respuesta SÍ depende del árbol de React. `useColorScheme` es un hook de React
 * Native que se re-suscribe a `Appearance`, y el tema se recalcula con él; fuera
 * del árbol no hay a qué enganchar. Lo que sí vive fuera —la preferencia
 * guardada— está en `data/appearance.ts`, que es quien la lee el layout raíz
 * antes de montar nada.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { makeTheme, type ColorScheme, type Theme } from '@sinchi/ui';
import { setAppearance, type AppearancePreference } from '../data/appearance';
import { useAppearance } from '../data/session-hooks';

interface ThemeContextValue {
  readonly theme: Theme;
  /** Lo que eligió la persona, que no es lo mismo que lo que se ve. */
  readonly preference: AppearancePreference;
  readonly setPreference: (value: AppearancePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const preference = useAppearance();
  // `null` en web y en un simulador sin preferencia declarada. La app nació
  // oscura y esa sigue siendo su cara: es el desempate.
  const device: ColorScheme = useColorScheme() === 'light' ? 'light' : 'dark';

  /**
   * Mientras el llavero no conteste se sigue al teléfono.
   *
   * Es el mismo criterio que la bienvenida: de los dos errores posibles, seguir
   * al teléfono es el que no contradice a nadie. Y dura milisegundos porque la
   * portada del layout raíz tapa la app hasta que la preferencia llega, así que
   * el cambio de tema —si la guardada era la contraria— ocurre detrás de ella.
   */
  const scheme: ColorScheme =
    preference === null || preference === 'system' ? device : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: makeTheme({ scheme }),
      preference: preference ?? 'system',
      setPreference: (next) => void setAppearance(next),
    }),
    [scheme, preference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useThemeContext debe usarse dentro de <ThemeProvider>.');
  return value;
}

export const useTheme = (): Theme => useThemeContext().theme;
