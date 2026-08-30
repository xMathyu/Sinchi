/**
 * Pantalla vacia.
 *
 * Existe porque los vacios eran una linea de texto suelta en la esquina superior
 * —«Todavia no tienes membresias.» sobre un degradado ambar, medio kilo de aire
 * debajo— y eso no se lee como un estado, se lee como una pantalla rota.
 *
 * Un vacio bien hecho dice tres cosas: que no hay nada, POR QUE no hay nada, y
 * que hacer al respecto. La tercera es la que faltaba: en este producto el alumno
 * no se une a un gimnasio por su cuenta —lo agrega el local a su padron
 * (`docs/autenticacion.md`)— y sin decirlo, la pantalla parecia estar
 * esperando un boton que no existe.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { withAlpha } from '@sinchi/ui';
import { Logo, Stack, Text } from './primitives';
import { useTheme } from './theme';

/**
 * Vacio porque no se pudo cargar, no porque no haya nada.
 *
 * Los dos se veian igual —"todavia no tienes un plan"— y eso le dice a alguien
 * que SI tiene plan que sus datos desaparecieron. Cuando la carga falla, la
 * pantalla tiene que decir que fallo y ofrecer reintentar, no inventar un vacio.
 *
 * El texto por defecto habla de LO SUYO —"tus datos", "tu informacion"— porque
 * nacio en la billetera, y ahi tranquilizar es justo lo que hace falta. En el
 * directorio no vale: lo que no cargo es la pagina de un gimnasio ajeno, y
 * decirle a alguien que su informacion sigue ahi cuando lo que falta es un
 * horario que nunca fue suyo suena a que se perdio algo. Por eso las dos lineas
 * se pueden cambiar.
 */
export function EstadoSinConexion({
  error,
  onReintentar,
  titulo = 'No se pudieron traer tus datos',
  cuerpo = 'Tu información sigue ahí: es la conexión con el servidor la que falló.',
}: {
  readonly error: string;
  readonly onReintentar: () => void;
  readonly titulo?: string;
  readonly cuerpo?: string;
}) {
  const theme = useTheme();
  return (
    <EstadoVacio
      titulo={titulo}
      cuerpo={cuerpo}
      pie={error}
      accion={
        <Pressable accessibilityRole="button" onPress={onReintentar}>
          <View
            style={{
              borderRadius: theme.radii.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.actionSecondary,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text variant="heading" weight="semibold">
              Reintentar
            </Text>
          </View>
        </Pressable>
      }
    />
  );
}

export function EstadoVacio({
  titulo,
  cuerpo,
  pie,
  accion,
}: {
  readonly titulo: string;
  readonly cuerpo: string;
  /** Una linea mas pequena debajo del cuerpo. Para la letra pequena. */
  readonly pie?: string;
  readonly accion?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
        gap: 20,
      }}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: withAlpha(theme.colors.ink, 0.08),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Logo size={38} barColor={theme.colors.surface} />
      </View>

      <Stack gap={8} style={{ alignItems: 'center' }}>
        <Text variant="titleSmall" weight="bold" align="center">
          {titulo}
        </Text>
        <Text
          variant="bodySmall"
          color={theme.colors.textSecondary}
          align="center"
          style={{ maxWidth: 290 }}
        >
          {cuerpo}
        </Text>
        {pie === undefined ? null : (
          <Text
            variant="captionSmall"
            color={theme.colors.textTertiary}
            align="center"
            style={{ maxWidth: 290 }}
          >
            {pie}
          </Text>
        )}
      </Stack>

      {accion === undefined ? null : <View style={{ width: '100%' }}>{accion}</View>}
    </View>
  );
}
