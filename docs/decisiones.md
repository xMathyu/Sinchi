# Decisiones tomadas al implementar

Lo que el documento de especificación dejaba abierto y hubo que resolver para
poder escribir código, más las desviaciones respecto del diseño. Cada una dice
por qué, para poder revertirla con criterio.

## 1. La versión 1 no cobra con tarjeta

**Decisión del producto:** el único camino por el que entra dinero es un pago
manual que registra el staff del gimnasio (efectivo, Yape o transferencia).
Culqi entra después.

Consecuencias en el código:

- `nextBillingDate` **no avanza con el calendario**: avanza cuando entra un
  pago. Es siempre el inicio del primer periodo no pagado.
- La deuda se **deriva** del ledger con `computeReceivable`, nunca se guarda en
  una columna de saldo. Un saldo guardado se desincroniza del ledger y después
  nadie sabe cuál de los dos miente.
- El motor de reintentos (`planRetry`, tabla de códigos de Culqi) está escrito y
  con tests, pero **no está conectado a nada**: es la pieza que se enchufa
  cuando llegue el cobro con tarjeta. Lo que sí está activo hoy es el corte de
  acceso: `evaluateDelinquency` decide activa / en gracia / suspendida, y el
  check-in lo respeta.
- El diferencial prorrateado de un upgrade se crea como cargo `pending` para
  cobrar en mostrador, en vez de debitarse.

## 2. Preguntas abiertas del MD 8: configuración, no constantes

Ninguna se respondió por cuenta propia. Las dos que afectan el cálculo quedaron
como configuración del gimnasio, con las dos ramas implementadas y probadas:

| Pregunta | Cómo quedó |
|---|---|
| 8.1 Fecha de cobro: ¿aniversario o día fijo del mes? | `Tenant.billingDatePolicy`: `anniversary` o `fixed_day`. Con día fijo, el primer periodo se prorratea. Tope en día 28, para que el cobro no se corra en febrero. |
| 8.2 Exceso de cupo: ¿bloquear o cobrar clase suelta? | `Tenant.quotaOverflowPolicy`: `block` u `offer_drop_in`. El motor informa (`DenialReason.offerDropIn`); la decisión comercial es del gimnasio. |
| 8.3 Reserva de clases con aforo | No implementado. Cambia el alcance y sigue abierto. Los horarios sí se validan (`outside_schedule`), el aforo no. |
| 8.4 Matrícula inicial | El concepto existe como `ChargeType = 'enrollment'` y se cobra con monto libre en mostrador. No hay tarifa configurada por gimnasio porque todavía no se decidió si existe. |
| 8.5 Boleta electrónica SUNAT | Fuera de alcance. |
| 8.6 Multi-sede | La identidad global (`User` fuera del tenant) ya lo permite desde la primera línea. Un `Tenant` = un local. |

Además, deuda acumulada topada en `MAX_PERIODS_OWED = 3`: un alumno que
desapareció ocho meses no debe ocho mensualidades, dejó de ser alumno. Sin el
tope, el primer moroso antiguo genera una cifra absurda en pantalla y el dueño
deja de confiar en el número.

## 3. Zona horaria sin `Intl`

`Intl` no está garantizado en Hermes en todas las versiones de Android, y este
paquete corre en la app. `America/Lima` se resuelve con una tabla de offset fijo
(−300 minutos: Perú no aplica horario de verano desde 1994) y cualquier otra
zona cae a `Intl` si el runtime lo trae. La aritmética de fechas es entera y
pura, sin `Date`.

Por la misma razón el formateo de moneda y de fechas es propio: la moneda es
siempre PEN y el idioma siempre español, así que la tabla de locales no aporta
nada.

## 4. TOTP con HMAC inyectado

`@sinchi/shared` no trae criptografía: recibe la función HMAC como parámetro.
Así la misma función pura vale en Node (api), en el navegador (panel) y en
Hermes (app), donde se usa `@noble/hashes` porque es JS puro y no necesita
módulo nativo.

Se usa **HMAC-SHA256**, no SHA-1. El RFC 6238 permite las tres familias y aquí
el generador y el verificador son ambos nuestros, así que no hay
compatibilidad heredada que respetar. Los tests incluyen los vectores oficiales
del RFC con SHA-1 para comprobar el truncamiento dinámico.

**Pendiente de seguridad:** la validación offline en el dispositivo del staff
comprueba suscripción, día, cupo y horario, pero no la firma del código. Para
verificarla sin conexión el dispositivo tendría que cachear las claves de
verificación del padrón. Es viable, pero guardar N secretos en un equipo de
mostrador es una decisión aparte y no se tomó.

## 5. Desviaciones respecto del diseño

El diseño (`Sinchi App.dc.html`) trae 12 pantallas. Se implementaron 11 y se
agregó una:

| Pantalla | Estado |
|---|---|
| A1 Billetera | Implementada |
| A2 Mi QR | Implementada, con TOTP real rotando cada 30 s |
| A3 Plan y cupo | Implementada. La fila «Tarjeta · Visa ••••» se reemplazó por «Cómo pagas · En mostrador» |
| A4 Estado de pago | Implementada, **adaptada**: el cronograma de «intentos de cobro» con tarjeta se reemplazó por el que sí existe hoy (cobro → gracia → suspensión), y el botón de pago por «Mostrar mi QR en mostrador» |
| A5 Registrar tarjeta | **No implementada.** Es la pantalla de Culqi y la versión 1 no cobra con tarjeta |
| A6 Historial | Implementada |
| S1 Escáner | Implementada, con cámara real y escaneo simulado |
| S2 Validación OK | Implementada |
| S3 Rechazo con motivo | Implementada |
| S4 Marcado manual | Implementada |
| S5 Cobro en mostrador | Implementada. En la versión 1 es la pantalla que sostiene el negocio |
| S6 Offline y cola | Implementada |
| Ajustes | **Agregada.** Hacen falta dos interruptores reales: la paleta segura para daltonismo (que el diseño trae como propiedad del lienzo) y el cambio de rol, que es el único camino para llegar al modo staff mientras no hay sesión |

Otras diferencias menores:

- **La marca de agua «SINCHI» no se anima.** El diseño la hace derivar de forma
  continua. Una animación infinita detrás de la pantalla que más se usa en la
  puerta gasta batería todo el turno.
- **Cambio de plan es pantalla propia**, no un salto directo. El diseño tiene el
  botón; la regla de prorrateo merece verse antes de confirmar.
- Los números de la maqueta (S/ 14 de diferencial, «2 de 3» en la semana 34) son
  ilustrativos. En la app salen del dominio y cambian con la fecha real.

## 6. Cosas que el diseño resolvió mejor que la especificación

Dos ideas del diseño que se subieron al dominio porque son producto, no
decoración:

- **El semáforo de cuatro niveles** (`ok` / `warn` / `alert` / `blocked`). La
  especificación pedía un motivo estructurado; el diseño mostró que además hace
  falta separar «pasa con aviso» de «hoy no» de «bloqueado». Ahora el nivel lo
  decide `@sinchi/shared`, no la pantalla, para que la app del alumno y la del
  staff no puedan discrepar de color sobre el mismo hecho.
- **Los textos del semáforo viven en `shared`** (`accessMessage`). Si el alumno
  lee «te queda 1 sesión» y el staff lee «cupo agotado», el que discute en la
  puerta es el recepcionista.
