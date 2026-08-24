/**
 * Tema de la app.
 *
 * El interruptor de paleta segura para daltonismo no es un extra: en este
 * producto el color ES la informacion. Un recepcionista que no distingue verde
 * de rojo no puede operar la puerta.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { makeTheme, type Theme } from '@sinchi/ui';

interface ThemeContextValue {
  readonly theme: Theme;
  readonly colorBlindSafe: boolean;
  readonly setColorBlindSafe: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [colorBlindSafe, setColorBlindSafe] = useState(false);
  const value = useMemo<ThemeContextValue>(
    () => ({ theme: makeTheme({ colorBlindSafe }), colorBlindSafe, setColorBlindSafe }),
    [colorBlindSafe],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useThemeContext debe usarse dentro de <ThemeProvider>.');
  return value;
}

export const useTheme = (): Theme => useThemeContext().theme;
