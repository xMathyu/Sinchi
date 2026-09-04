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

---

## 8. El mes gratis del gimnasio, y qué pasa cuando termina

El esquema traía `saas_tier` y `charge_type = 'saas'` desde el primer commit,
pero nada leía `tenants.status` y ningún gimnasio tenía fecha de vencimiento:
**Sinchi era gratis para siempre sin quererlo**. Lo que faltaba no era la oferta
—esa se puede anunciar mañana— sino la mitad que la convierte en un negocio.

**Un mes gratis contado desde el alta.** La fecha sale de `advanceBillingDate`,
la misma función que mueve el cobro del alumno, así que el alta del 31 de enero
vence el 28 de febrero sin ningún caso especial. Es el dogfooding del MD 3: si el
motor de cobro recurrente falla, nos falla a nosotros primero.

**A los gimnasios que ya estaban, su mes empieza el día que esto se enciende**,
no desde su `created_at`. Kaizen y Fa Meng Chuen llevaban meses dentro:
arrancarlos ya vencidos por una fecha que nadie les comunicó es una conversación
fea por un backfill.

### Solo lectura, y la puerta nunca se cierra

Es la decisión que ordena todo lo demás. Vencido el mes y pasados 7 días de
gracia, el gimnasio impago pierde la capacidad de **crear futuro** —alumnos
nuevos, cobros nuevos, interesados nuevos— y conserva todo lo que ya tiene: el
check-in valida igual, el QR del alumno funciona igual, el padrón y el historial
siguen ahí y siguen siendo suyos.

Cortar la puerta era la opción con más palanca y es la que no se tomó. El
castigo caería sobre el alumno que **sí** le pagó a su gimnasio, en la puerta y
delante de todos, por una deuda que no es suya; y la reacción del dueño ante eso
no es pagar, es volver al cuaderno esa misma tarde. Lo que sí duele sin dañar a
nadie es no poder registrar el cobro del día: es la operación que el mostrador
hace todas las tardes.

Tres consecuencias que no son obvias y están en el código por escrito:

- **`POST /staff/sync` sigue abierta.** No crea nada: repite marcados y pagos que
  ya ocurrieron en el mostrador mientras no había wifi. Rechazarla borraría
  dinero ya cobrado en efectivo.
- **El PIN de turno y el alta de equipos siguen abiertos.** Sin PIN nadie abre
  turno y sin equipo no hay puerta: cortarlos convertiría el modo solo lectura en
  el cierre del local, que es justo lo que se prometió no hacer.
- **Sale del directorio público.** Un local que no paga deja de recibir gente que
  le llega *por* Sinchi. Es la parte del corte que le cuesta algo al dueño sin
  costarle nada al alumno que ya entrena ahí. Las reservas ya hechas se respetan,
  mismo criterio que apagar la clase gratis.

El corte lo aplica un guard global **cerrado por defecto**: una ruta de escritura
nueva nace cortada y abrirla exige `@AllowedWhenReadOnly()`. Al revés, cada ruta
nueva regalaría el producto y el olvido no se notaría nunca, porque nada falla.

### Tablas propias, no `charges`

Dos razones que no se arreglan con un `ALTER`:

1. `charges.membership_id` es `NOT NULL`. Un cobro a Sinchi no tiene alumno
   detrás. Meterlo ahí exigiría inventar un tenant ficticio del que cada gimnasio
   fuera «alumno» — el tipo de modelo que se paga tres meses después. Por eso el
   `charge_type = 'saas'` que existía desde el principio nunca se pudo usar.
2. `charges` está bajo RLS por tenant. Esta relación no es del gimnasio: es de
   Sinchi **con** el gimnasio. Que el cliente lea su propia fila está bien; que el
   aislamiento la trate como dato suyo, no.

`saas_subscriptions` va fuera de `TENANT_SCOPED_TABLES`, igual que `tenants`: el
mismo modelo de confianza que la tabla a la que apunta, y el job diario tiene que
recorrerlas todas.

### La idempotencia es el número de operación, no el periodo

Registrar un pago **adelanta** la fecha de cobro. Así que anotar dos veces la
misma transferencia —lo que pasa cuando dos personas atienden el mismo correo del
banco— no chocaría contra el índice por periodo: apuntaría al mes siguiente y
pasaría, cobrándole dos meses por un solo depósito. Lo para
`saas_charges_reference_once`, que juega el mismo papel que `client_id` en la
cola offline del mostrador.

### Lo que no se construyó

**Pantalla para cobrarle al gimnasio.** Con tres gimnasios, quien cobra es una
persona mirando el correo del banco una vez al mes: `npm run saas:pay`. Una
pantalla es trabajo que se tira el día que entre Culqi.

**Cobro automático con tarjeta.** Misma decisión que con el alumno (§1): el
gimnasio paga por transferencia o Yape y alguien lo registra. El corte por impago
—que es lo que sostiene el negocio— funciona completo sin pasarela.

**Aviso al dueño por correo o push antes de vencer.** Falta el mismo canal que
falta para la morosidad del alumno. Lo que sí existe desde el primer día es la
cuenta atrás visible en el modo staff: un mes gratis del que el dueño se entera
el día que se corta es un cliente que se va enojado, no uno que paga.

---

## 9. El plan gratis, el alta desde la app y los códigos

### Hasta 10 alumnos no se paga nada

No es una promoción ni una prueba: es el precio de un local pequeño, para
siempre. Un dojo que empieza con seis alumnos no tiene con qué pagar S/ 149 —y
tampoco tiene con qué llevar un cuaderno bien—, así que cobrarle desde el primer
día lo deja fuera cuando lo que queremos es que crezca **dentro**.

La consecuencia ordena todo el motor: **un gimnasio del plan gratis no se puede
cortar**. No debe nada, así que no hay fecha que se le pase, y `evaluateSaas` lo
resuelve antes que cualquier otra regla. Por eso el escalón es un campo
obligatorio de su entrada y no un opcional con valor por defecto: si faltara, un
local de seis alumnos acabaría en solo lectura por una deuda de cero soles.

**Cruzar los 10 no corta a nadie de golpe.** Un gimnasio con un año gratis a la
espalda tiene su fecha de cobro un año atrás; mirarla tal cual lo dejaría cortado
el mismo día que creció, que es la peor forma posible de cobrarle a alguien por
primera vez. El trabajo diario le da un mes por delante — el mismo que tuvo al
darse de alta — y respeta cualquier código que hubiera canjeado siendo pequeño.

Se acepta a sabiendas que alguien podría bajar de 10 y volver a subir para
repetirlo. Con estos números eso es dar de baja alumnos de verdad en su propio
padrón para ahorrar S/ 149, y se ve en la lista.

**El escalón se deriva del padrón**, no de lo que el dueño declaró al
registrarse: esa columna se fija una vez y nadie la vuelve a tocar, así que un
dojo que creció de 40 a 200 alumnos seguiría pagando el escalón más barato para
siempre. Se cachea en `saas_subscriptions.tier` y lo refresca el trabajo diario:
así el guard no cuenta alumnos en cada escritura, y —más importante— la franja
que ve el dueño y el corte que aplica el guard cuentan siempre lo mismo.

### El alta de un gimnasio vive en la app, no en un script

Hasta aquí un gimnasio solo podía nacer de `db:seed:kaizen`. Eso servía para los
tres primeros clientes y no sirve para una oferta: quien escucha «el primer mes
es gratis» en un dojo el martes tiene que poder empezar el martes.

Es la única ruta pública que crea un tenant, así que la fricción no es
burocracia: es lo único que separa un padrón real de una tabla de pruebas.

- **Cuenta de Google verificada**, igual que para reservar una clase gratis.
- **RUC con dígito verificador**, comprobado de verdad y no solo por longitud: un
  tipeo cambia un dígito y la longitud sigue siendo once. La columna es `NOT
  NULL` y lo que entre ahí sale después en las boletas del gimnasio.
- **Un gimnasio por persona.** Multi-sede es el escalón de S/ 499 y una
  conversación, no un botón.

Esa última comprobación se escribió mal la primera vez: preguntaba por `staff` en
SQL crudo creyendo que eso esquivaba las políticas. No las esquiva —RLS aplica al
rol, no al estilo de la consulta— así que devolvía cero filas y **no se disparaba
nunca**. La misma persona podía crear gimnasios sin límite y nada fallaba. Lo
encontró la prueba de punta a punta, no el typecheck.

El código de promoción va **al final y fuera de la transacción**: si está mal
escrito, el gimnasio queda creado igual y la app dice por qué no se aplicó.
Perder un alta por un tipeo en un campo opcional sería cambiar un cliente por una
promoción.

### Los códigos mueven la fecha, no el precio

Un código no descuenta el importe: adelanta `free_until`. Así el motor de cobro
sigue sin saber que las promociones existen, y lo único que cambia es una fecha.
Un descuento sobre el importe habría obligado a tocar el prorrateo, que es
justamente lo que no conviene tocar por una campaña.

**El tope de usos no se comprueba en el código.** Vive en un `CHECK` y en un
`UPDATE ... WHERE redeemed_count < max_redemptions`: dos gimnasios canjeando el
último uso en el mismo segundo leen los dos «9 de 10» y los dos entrarían con un
`if`. La otra mitad es el índice único por `(código, gimnasio)`, sin el cual un
solo gimnasio podría gastar los diez usos.

El canje **cuenta desde lo último que el gimnasio ya tiene cubierto**, no desde
`free_until` a secas: quien ya pagó un mes no puede recibir de regalo un periodo
que ya compró. Y si esa fecha ya pasó, cuenta desde hoy — si no, un gimnasio
cortado canjearía un código y seguiría cortado, que es justo lo que el código
venía a arreglar. Por eso `POST /staff/promo` sigue abierta en solo lectura: que
el corte bloqueara la forma de levantarlo sería una trampa.

### Lo que falta para que el alta sirva de verdad

**Un gimnasio recién creado no tiene planes ni horarios**, y sin planes no puede
inscribir a un solo alumno: `POST /staff/members` exige `planId` y no hay ninguna
ruta que cree planes — hasta ahora los ponía el script de siembra. El alta deja
al dueño dentro, con su mes gratis corriendo y su padrón vacío, pero el local no
es operable hasta que alguien le cree los planes. Es lo siguiente.

### Y lo que no se puede hacer con Apple Pay

Cobrar la suscripción **dentro de la app** cae en la regla 3.1.1 de la App Store
y exige In-App Purchase, no Apple Pay — que es para bienes y servicios que se
consumen fuera. El IAP se lleva 15–30%, que es volver a tener un porcentaje justo
después de haber decidido en el MD 2 no tenerlo, y encima uno que no se negocia.

El camino es el que ya sigue Sinchi: **el cobro ocurre fuera de la app**. El dueño
paga por transferencia hoy, y mañana en una página de Culqi donde Apple Pay y
Google Pay sí funcionan como billeteras de tarjeta. La app solo refleja el estado.

---

## 10. La biblioteca: lo que el gimnasio enseña sin abrir la puerta

Hasta aquí, todo lo que un gimnasio vendía en Sinchi exigía que la persona
ESTUVIERA ahí: la mensualidad, la clase suelta, el seminario. Las rutinas son lo
primero que vale sin cruzar el umbral — el «día de pecho» con sus videos, el
uchimata explicado paso a paso, el calentamiento de hombro.

### La visibilidad va por rutina, no por gimnasio

Es la decisión que se pidió y es la correcta: **la misma escuela necesita las
dos**. Una rutina pública es un anuncio —la abre cualquiera desde el directorio,
sin cuenta, y es lo que hace que alguien elija ESTE dojo entre cinco— y una de
alumnos es media razón para seguir pagando la mensualidad. Un gimnasio que solo
pudiera publicar hacia fuera regala su trabajo; uno que solo pudiera guardarlo no
lo usa nunca para traer gente.

Por eso el interruptor está en la lista, a un toque, y no enterrado en el editor:
el dueño publica el uchimata para atraer, ve que funciona y decide guardarse la
serie entera. Cambiar de opinión es el caso normal, no la excepción.

El valor por defecto es `members`. De los dos errores posibles, publicar sin
querer hacia todo internet es el que no se deshace.

### El muro está en la api, no en la pantalla

Filtrar en la app sería decorativo: el JSON viaja igual y basta un proxy para
leerlo. Así que la api **nunca entrega la dirección de un video ni las
instrucciones a quien no tiene acceso**. Lo que sí entrega es un anzuelo —título,
de qué va, cuántos pasos— con `unlocked: false` y 200, no 403: es la única
pantalla del producto donde alguien de fuera está mirando algo que quiere, y ahí
el motivo del rechazo ES el argumento de venta. En la ficha del gimnasio pasa lo
mismo un nivel más arriba: se enseñan las públicas y se CUENTAN las de alumnos
—«hay 2 rutinas más solo para sus alumnos»— sin dar los títulos.

Un borrador es distinto: fuera del local responde 404. No hay nada que vender de
algo que el gimnasio todavía no escribió.

### La deuda no cierra la biblioteca; la baja sí

Al moroso ya se le cierra la puerta, y esa es la palanca que cobra. Quitarle
además el video no recupera un sol —servirlo no le cuesta nada al gimnasio— y le
quita justo lo único que lo mantiene atado a la escuela mientras junta la plata.
Un alumno suspendido por mora sigue viendo todo.

Lo que sí la cierra es darse de baja: quien se fue dejó de ser alumno. Y «ser
alumno» se mide por la SUSCRIPCIÓN, no por `memberships.status` — esa columna
existe y engaña, porque nada en el producto la pone en `inactive`. Mirarla habría
dejado la biblioteca abierta para siempre a quien se dio de baja, y el fallo
habría sido mudo.

### Se sube el archivo, y también se acepta un enlace

Las dos formas conviven porque los dos gimnasios existen. El dojo con canal de
YouTube ya tiene su material subido, y obligarlo a repetirlo sería trabajo por
nada; el profesor que graba en el tatami con el celular no tiene canal ni ganas
de abrirlo, y sin subida no tenía forma de publicar nada. Lo que se ofrece
primero es subir, porque es lo que más gente puede hacer.

Nunca los dos a la vez, y lo fuerza un `CHECK` en la base: con los dos puestos
hay dos videos para el mismo sitio y quien lee decide cuál gana, que es como el
alumno y el dueño acaban mirando cosas distintas.

**El archivo no pasa por la api.** Se firma una URL y el teléfono sube directo al
bucket. Meter 300 MB por un proceso de Cloud Run con 512 MiB y 30s de timeout es
la forma conocida de tumbar la api con una sola subida, y encima se pagaría el
tráfico dos veces. El tope de tamaño va firmado en las cabeceras, así que lo
aplica el almacenamiento y no una comprobación del cliente — que no es ninguna. Y
«ya subí» no se cree: se le pregunta al almacenamiento cuánto pesa el objeto.

**Subir es lo que hace exclusivo el contenido de alumnos.** Un video «solo para
alumnos» en YouTube oculto lo ve cualquiera que tenga la dirección: eso no es un
muro, es una puerta sin cartel. Un objeto privado del bucket solo se sirve con una
URL firmada que caduca en dos horas, y la api solo la firma después de pasar
`checkRoutineAccess`. Con un enlace, la exclusividad era una promesa; con archivo
propio, es una propiedad del sistema.

Lo que hay que seguir diciendo en voz alta: quien pega un enlace de YouTube sigue
teniendo la limitación de siempre, y por eso el editor lo dice donde se decide
—«un enlace de YouTube lo ve cualquiera que lo tenga; un video subido solo lo ve
quien tú decidas»— en vez de esconderlo en la documentación.

**Y lo que cuesta es servirlo, no guardarlo.** Guardar un GB son centavos al mes;
que cien alumnos miren tres veces un video de 100 MB son 30 GB de salida a
$0,12/GB. Las dos palancas —el tope por video, hoy 300 MB, y cuántos videos
publica un gimnasio— están juntas y en el dominio, para que el día que apriete no
haya que ir a buscarlas. Sin `VIDEO_BUCKET` la subida queda apagada y la
biblioteca funciona entera con enlaces: un despliegue sin bucket degrada, no
rompe.

### El video se ve dentro de la app

Un enlace que echa a la persona a YouTube rompe justo lo que hace útil una rutina:
mirar diez segundos, leer la explicación del paso y volver a mirar. Así que el
reproductor aparece EN SU SITIO, con la instrucción debajo.

Hay dos reproductores porque hay dos clases de video, y cuál toca lo decide el
dominio (`VideoLink.playback`), no la pantalla:

- **el archivo** —lo subido, y cualquier `.mp4`— va con el reproductor nativo:
  pantalla completa de verdad y control de velocidad, que para una técnica de
  judo a 0.5x vale más que cualquier otra cosa;
- **YouTube y Vimeo** no sirven el archivo, así que se embebe su reproductor en
  un `WebView`. Cargarlo a pelo no funciona: YouTube lo trata como una petición
  sin origen y contesta «Error 153» en vez del video. Hay que servirlo dentro de
  una página con `baseUrl`.

Sobre el embebido hay que ser honesto: depende de permisos que no controlamos —el
dueño del video puede prohibirlo— y **el simulador de iOS no lo reproduce nunca**.
Por eso el reproductor lleva encima nuestro propio botón para abrirlo fuera, y no
se intenta detectar el fallo para caer solo: la tarjeta de error se pinta dentro
del iframe, en otro origen, y no se puede leer. Ofrecer la salida siempre es más
honesto que fingir que sabemos si falló.

Los enlaces se guardan **canónicos**: dos dueños pegan el mismo video, uno desde
el móvil y otro desde el navegador con la lista de reproducción y el segundo por
el que iba detrás, y sin normalizar son dos cadenas distintas para el mismo video
y el `?t=42` arranca la técnica por la mitad. Una dirección de un sitio conocido
de la que no se saca un id —un canal, una lista, un tipeo— se rechaza en vez de
guardarse como enlace genérico: aceptarla escondería el error hasta el día en que
un alumno toca la técnica y YouTube le contesta que el video no existe.

### Las series van en texto libre

«4 series de 12» y «5 minutos de uchikomi con el compañero» son la misma casilla
para quien la escribe. Modelarla con campos `sets` y `reps` sirve al gimnasio de
pesas y deja al judoca rellenando repeticiones que no significan nada en su
deporte. Sinchi no cuenta series; las dice.
