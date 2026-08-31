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

## 7. La clase gratis: la única puerta que abre desde afuera

Hasta aquí, todos los caminos de alta empezaban **dentro** del gimnasio: el
mostrador crea la ficha, o manda una invitación. Los dos nacen en el mostrador.
Quien instalaba la app por su cuenta llegaba a la pantalla del código de seis
dígitos y ahí se acababa el producto: un número que nadie iba a confirmar.

Ahora hay un directorio público (`GET /gyms`) y una reserva de clase gratis. Las
decisiones que lo sostienen:

- **Reservar NO exige ficha en ningún padrón.** Quien reserva es exactamente la
  persona que todavía no es de nadie. Pedirle el DNI para mirar un horario mata
  el alta antes de empezar, así que la reserva viaja con nombre y celular, que
  es lo único que el gimnasio necesita para atender a alguien el martes. Lo que
  sí exige es una cuenta —Google o correo, verificada por Firebase— porque sin
  ella la lista del mostrador se llena de reservas inventadas y deja de servir.
- **Nombre y celular se piden UNA vez, al crear la cuenta.** Viven en
  `account_claims` —no en `users`: todavía no hay ficha a la que atarlos— y la
  reserva los lee de ahí. Preguntarlos otra vez al reservar era la queja
  evidente: «si acabo de registrarme, ¿por qué me lo preguntas de nuevo?». Solo
  vuelven a aparecer si de verdad faltan, que es el caso de quien entró con
  Google sin llegar a escribir su celular.
- **La credencial es el ID token de Firebase**, igual que al aceptar una
  invitación. En la app se conserva en memoria mientras la cuenta está sin
  vincular: es lo único que tiene esa persona, y sin ello `/link` seguiría sin
  salida. No se persiste en el llavero — dura una hora y volver a entrar lo
  renueva.
- **Una clase gratis por persona y por gimnasio, contada por celular.** Por
  celular y no por cuenta porque volver a entrar con otra cuenta de Google es
  cuestión de un minuto, y el celular ya es la llave con la que el alumno se
  reconoce en el resto del sistema. La regla vive en un índice único parcial: el
  `select` previo del servicio no ve la reserva que otra petición está
  insertando en ese mismo instante.
- **Cancelar libera el cupo.** El índice solo mira las vigentes. Quien avisa que
  no puede el martes merece poder venir el jueves, y la fila cancelada se
  conserva para poder ver qué pasó.
- **El aviso al gimnasio va por correo**, al dueño. No hay canal de push
  todavía (sigue pendiente, igual que para la morosidad), y una reserva de la
  que el dueño se entera cuando ya pasó no sirve de nada. El fallo del correo no
  deshace la reserva: `notified_at` deja ver cuál sí salió, y la lista está en
  la app del mostrador de todas formas.
- **La clase de prueba puede tener PRECIO** (`tenants.trial_class_price_cents`,
  0 = gratis). Nació gratis porque el primer gimnasio la regalaba; el segundo la
  vende —Fa Meng Chuen cobra S/40 y esa clase suelta *es* su prueba—, así que la
  elección no es «la ofrezco o no» sino «cuánto cuesta». Con solo el interruptor,
  un local así tenía que quedarse fuera del directorio para no regalar su
  producto, que es lo contrario de lo que el directorio busca. Es columna propia
  y no `drop_in_price_cents` aunque a veces coincidan: uno lo paga el alumno que
  agota su cupo y otro quien viene a conocer el local, y regalar la primera y
  cobrar las siguientes es el caso más común de los dos. El precio se **congela**
  en la reserva, como el de la invitación.
- **El gimnasio puede no ofrecerla** (`tenants.trial_class_enabled`, por defecto
  sí). Un local que sale en el directorio y no deja probar desperdicia la visita,
  pero la decisión es comercial y es suya, así que se enciende y se apaga desde
  la app —pestaña «Clases gratis» del modo staff— y solo el dueño puede hacerlo:
  es del mismo orden que el precio de los planes. Una columna que solo se puede
  cambiar con un `UPDATE` a mano es lo mismo que no poder cambiarla.
- **Apagarla no cancela lo ya reservado.** Quien eligió venir el martes lo hizo
  con una promesa delante; borrarla por un cambio de política lo deja
  presentándose en un local que no lo espera. Lo que corta es lo de adelante: el
  gimnasio deja de ofrecer horas y una reserva nueva vuelve con `not_offered`.

Y lo que el gimnasio recibe con la reserva es **el nombre, el celular y un
enlace de WhatsApp**: es por donde se coordina de verdad en este mercado —
confirmar, mover la hora, explicar cómo llegar— y el dueño lee el aviso en el
móvil. Un chat propio dentro de la app resolvería lo mismo peor: exige presencia,
notificaciones push (que todavía no existen), moderación y que las dos partes lo
abran, mientras que WhatsApp ya está abierto en los dos teléfonos.

Lo que **no** hace, a propósito: no controla aforo. Una reserva de clase gratis
no ocupa plaza, así que MD 8.3 sigue abierto igual que antes. Con los números de
un dojo —una o dos pruebas por semana— cobrar el aforo aquí sería construir el
sistema de reservas entero para el caso menos frecuente.
