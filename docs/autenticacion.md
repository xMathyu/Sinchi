# Autenticación

Google Sign-In vía Firebase, o correo y contraseña. Una sola puerta para los
tres: alumno, recepción y dueño. Lo que distingue a cada uno es su fila en
`staff`, no la forma de entrar.

---

## Dos preguntas distintas, dos respuestas

Firebase certifica **quién es el humano**. El token de Sinchi dice **qué puede
hacer y en qué gimnasio** (`tenantId`, `staffId`, `role`).

```
Firebase ID token ──POST /v1/auth/google──> sesión de Sinchi (JWT propio)
```

El token de Firebase **no se usa en el resto de la api**. Eso no es ceremonia:
gracias a esa separación, el guard, los roles y `assertStaffSession` siguen
funcionando sin cambios, y cambiar de proveedor de identidad —o añadir Apple,
que el App Store puede exigir si se ofrece Google— no toca la autorización.

---

## El problema que Firebase no resuelve

**El padrón se crea antes de que el alumno abra la app.** La recepcionista
escribe nombre, DNI y celular en el mostrador. Es deliberado: el sistema tiene
que atender al alumno sin celular.

Google Sign-In devuelve `{ uid, email, name }`. Nada de eso está en esa ficha —
el celular no viaja en el token, el email es opcional y probablemente nadie lo
pidió, y el nombre no es único ni verificable. Así que en el primer login hay una
cuenta verificada y **ninguna forma de saber a qué ficha corresponde**.

Los atajos que parecen obvios son agujeros:

| Atajo | Por qué no |
|---|---|
| Que el alumno escriba su DNI | El DNI peruano son 8 dígitos semipúblicos. Quien lo sepa reclama la membresía de otro, con su historial de pagos y su QR. |
| Emparejar por email | Exige que recepción lo pida y lo escriba sin error. Un typo vincula a la persona equivocada; sin email, no vincula a nadie. |
| Crear un usuario nuevo | Rompe la tesis del producto: la persona existiría dos veces, y el QR, el cupo y la deuda cuelgan de la ficha del padrón. |

### La solución: lo acepta la persona

Hasta la migración 0023 lo confirmaba recepción. La app mostraba un código de 6
dígitos, la persona lo dictaba y recepción lo escribía junto a su ficha: la
verificación más fuerte disponible, porque la confirma quien tiene a la persona
enfrente. Tenía dos costes. Era una pared para quien todavía no entrena en ningún
sitio, y dejaba abierto un agujero: inscribir por DNI a alguien que ya tenía
cuenta metía el gimnasio en su app sin preguntarle.

Ahora el gimnasio deja una **solicitud** y la persona la acepta en su app
(decisiones §14):

```
1. Recepción inscribe: escanea el QR de la cuenta, o escribe su celular o correo
2. Queda una solicitud en link_requests
3. La persona la ve en su app —arriba del directorio, de Mi QR o de su billetera
4. Acepta: firebase_uid queda atado a esa ficha y el gimnasio aparece en su billetera
```

**Detalles que importan:**

- La solicitud va a la cuenta del QR si se escaneó; si no, a quien entre con el
  celular o el correo de la ficha. El celular del registro no se verifica, y por
  eso queda qué cuenta aceptó y el dueño puede desvincular.
- Aceptar comprueba, antes de marcar nada, que ni la cuenta abra ya otra ficha ni
  la ficha abra con otra cuenta. Sin eso, alguien podría desplazar la cuenta de un
  alumno y quedarse con su historial.
- Desde el staff la solicitud se lee con contexto de tenant, así que RLS
  garantiza que recepción solo vea las de su padrón. Desde la persona, con su
  identidad o con la cuenta de Firebase que presentó.
- El dueño puede **desvincular**. El vínculo lo acepta una persona sobre datos que
  no se verifican; tiene que haber forma de deshacerlo sin entrar a la base a mano.

### La única excepción: el dueño en el arranque

El dueño **sí** se vincula automáticamente por email verificado. Parece
contradecir lo de arriba, y no lo es: las dos objeciones al email desaparecen en
este caso.

- *"la recepcionista lo escribe con prisa"* — el email del dueño lo registramos
  nosotros al dar de alta el gimnasio, en la reunión de venta.
- *"el alumno no tiene email"* — el dueño sí, y es con el que va a administrar su
  negocio.

Y el vínculo es fuerte: Google certifica que quien entra controla ese buzón
(`email_verified`), y el buzón lo pusimos nosotros.

Existe porque sin ella el arranque es circular: el dueño tendría que aceptar la
solicitud de un gimnasio que todavía no tiene a nadie que la mande. Está limitada
a `owner`; recepción acepta su solicitud, como todos.

---

## Recepción entra como todos (y antes no)

Hubo una puerta aparte para el mostrador: el dueño registraba el equipo
(`POST /v1/staff/devices` → un token de portador que se mostraba una vez) y cada
persona abría su turno con un PIN de 4-6 dígitos (`POST /v1/auth/shift` → sesión
de 12 h). El razonamiento era bueno: la tablet es compartida y los turnos rotan,
así que cerrar y abrir sesión de Google en cada cambio termina en *"dejemos la
de Ana abierta"* — y ahí `attendance.recorded_by` y `charges.recorded_by` dejan
de decir la verdad sobre quién marcó y quién cobró.

**Se retiró en `0019_fuera_el_turno_del_mostrador`.** El gimnasio que lo
necesitaba no existe en esta red: el profesor ES la recepción y entra con su
propia cuenta desde su teléfono. Sostenerlo costaba dos rutas públicas, un
registro de equipos, hasheo scrypt con bloqueo por intentos, una excepción de RLS
y la tabla `checkin_devices` entera.

No dejó a nadie fuera, y eso es lo que lo hizo seguro de borrar: **el turno era
una CUARTA puerta, no la única de recepción**. Quien tiene fila en `staff` entra
con Google o con su correo como cualquiera, y `issueForUser` le da sesión de
`front_desk` leyendo esa fila.

Lo que se pierde, dicho en voz alta: en una tablet compartida ya no hay nada que
obligue a cada persona a identificarse, y la sesión dura **7 días** en vez de 12
horas. Si algún día entra un gimnasio con recepción rotando de verdad, esto
vuelve — y el razonamiento de por qué un PIN pedía scrypt y un token de 32 bytes
no, está en el historial (busca `hashPin`), no hay que volver a deducirlo.

---

## El dueño de un dojo también entrena en él

El rol no lo elige la persona: lo decide la api al mirar si tiene fila en
`staff`. Es lo correcto —una preferencia del usuario no puede conceder permisos—
pero tenía un efecto que nadie quiso: **quien tiene esa fila no veía nunca su
propia billetera**. El dueño que entrena en su propio local, o la recepcionista
inscrita donde trabaja, existían en el padrón y no podían mirar su plan, su QR ni
lo que deben.

`switchToStudent` estaba escrito desde el principio, con este mismo comentario en
el código. Faltaban dos cosas, y la segunda es la que importaba:

1. **Nadie lo llamaba.** El selector de rol de ajustes es de demostración y está
   escondido cuando hay sesión real, así que la ruta no tenía botón.
2. **No había vuelta.** No existía `switch-to-staff`, así que cambiar a alumno
   era un viaje de ida: para volver había que cerrar sesión y entrar de nuevo.

```
POST /auth/switch-to-student   staff  -> sesión de alumno
POST /auth/switch-to-staff     quien tenga fila en `staff` -> vuelve a su puesto
POST /auth/switch-to-staff     { tenantId } -> salta a ESE local suyo
GET  /auth/modes               cualquiera -> { student, staff: [...] }
```

### No concede nada

`switch-to-staff` vuelve a leer `staff` y devuelve exactamente lo que
`issueForUser` le habría dado al entrar con Google. No es una escalada: si la
fila ya no está —lo sacaron del equipo mientras miraba su billetera— no hay
vuelta. Y la sesión de alumno tampoco puede tocar el padrón aunque la persona sea
la dueña: manda el rol del token, no quién es.

### El agujero que abría, y que costó una prueba

Reemitir el token **regalaba vida nueva**. `switch-to-student` y su vuelta
firmaban con el TTL del login normal, así que cada viaje de ida y vuelta devolvía
una sesión nueva y completa: bastaba pasar por alumno y volver para tener una
sesión eterna en el aparato de quien fuera. Lo destapó el turno del mostrador,
que duraba 12 horas y se convertía en 7 días con dos toques; el turno ya no
existe, pero el agujero era del cambio de modo, no del turno.

Se cierra atando la reemisión al `exp` del token que pide el cambio: lo que queda
de vida, nunca más. Así el cambio es lo que dice ser —la misma sesión con otra
etiqueta— y tampoco se renueva indefinidamente yendo y viniendo. La app lo dice
en voz alta debajo del botón, porque un cambio de sesión que parece gratis
invita a usarlo como si lo fuera.

### Por qué `/auth/modes` y no un campo en el token

Qué **más** es una persona no se puede deducir del token: un dueño con ficha en
su propio dojo y uno sin ella llevan sesiones idénticas. Meterlo en el JWT lo
congelaría hasta que caducara: el dueño que se inscribe hoy vería el botón la
semana que viene, y el recepcionista al que sacaron del equipo seguiría viendo
una vuelta que la api ya rechaza. Son dos consultas por índice, y la pantalla de
ajustes se visita poco.

La app **solo enseña el otro modo si existe de verdad**. Ofrecerle «ver como
alumno» a un recepcionista sin ficha lleva a una billetera vacía, que es la forma
más común de este defecto en el producto: una acción que invita a algo que la api
va a rechazar.

---

## Una persona, varios locales

`staff` siempre pudo tener varias filas de la misma persona —el índice único es
`(tenant_id, user_id)`— pero la sesión no sabía leerlas. `staffRowOf` hacía
`limit(1)` **sin orden**, así que un dueño con dos locales entraba a uno de los
dos al azar, y no había forma de ir al otro: el `tenantId` va firmado dentro del
JWT.

El caso que lo pide es corriente: el profesor que lleva la escuela de una
universidad —alumnos becados, nadie paga— y aparte cobra sus clases por su
cuenta. Son dos padrones, dos tarifarios y dos cajas.

Tres cambios, y ninguno toca el esquema:

1. **`staffRowsOf` devuelve todas**, ordenadas por `created_at` y desempatadas
   por `id`. El orden tiene que ser TOTAL: dos filas sembradas en la misma
   transacción comparten fecha, y sin el desempate el login vuelve a ser una
   lotería.
2. **`/auth/modes` devuelve una lista** con el nombre de cada local puesto —
   «cambiar a `b3f1-…`» no lo elige nadie. Vacía, no nula, cuando no trabaja en
   ninguno.
3. **`switch-to-staff` acepta `tenantId`.** Es la misma operación de siempre
   mirada de cerca: «emíteme una sesión de staff, en este gimnasio».

### Dónde está el control de acceso

En un `find` sobre la lista que devuelve `staffRowsOf`, y se sostiene en que esa
lista se lee bajo contexto de IDENTIDAD: la política de `staff` es
`tenant_id = app_current_tenant() OR user_id = app_current_user()`, así que con
solo el usuario puesto devuelve **sus** filas y ninguna más. Preguntarle a la
base «¿existe un staff en ese tenant?» sí sería un agujero — existe, y puede no
ser el suyo.

Una sola ruta y no dos a propósito: dos sitios que firman tokens de staff son
dos sitios donde comprobar que el puesto es suyo, y el segundo es el que un día
se olvida.

Cambiar de local **no alarga la sesión**, por lo mismo que no la alarga cambiar
de modo: saltar de un local al otro y volver la renovaría indefinidamente.

### El alta del segundo local

`assertNotStaffYet` rechazaba con 409 y «para abrir un segundo local,
escríbenos». Ahora es `assertLocalesDisponibles`, con tope de **cinco**.

No se pierde plata al abrirlo: `tierFor` calcula el escalón **por local** contra
su padrón real, así que dos locales pagan dos escalones y una selección de diez
becados cae en el plan gratis — que es lo correcto, no es un cliente que se
escapa sino un local que no factura. Lo único que cada local nuevo regala es su
mes gratis, y para eso está el tope.

---

## Rutas

| Método | Ruta | Quién |
|---|---|---|
| `POST` | `/auth/google` | público — devuelve sesión **o** la cuenta sin ficha, con su QR |
| `POST` | `/staff/accounts/lookup` | staff — canjea el QR de una cuenta `{ token }` por nombre y contacto |
| `GET` · `POST` | `/staff/members/:id/link-request` | staff — cómo está la solicitud, o reenviarla |
| `DELETE` | `/staff/link-requests/:id` | staff — la retira sin contestar |
| `POST` | `/link-requests/mine` | público, con ID token — las pendientes de una cuenta sin ficha |
| `POST` | `/link-requests/:id/accept` · `/reject` | público, con ID token — aceptar devuelve la sesión |
| `GET` · `POST` | `/me/link-requests` · `/:id/accept` · `/:id/reject` | sesión — las de quien ya es alumno |
| `GET` | `/auth/modes` | cualquier sesión — qué otros modos tiene |
| `POST` | `/auth/switch-to-student` | staff con ficha — mira su billetera |
| `POST` | `/auth/switch-to-staff` | quien tenga fila en `staff` — vuelve a su puesto, o salta al local que pida en `{ tenantId }` |
| `DELETE` | `/staff/members/:id/account` | dueño — desvincula |

La respuesta de `/auth/google` tiene dos formas y el cliente **debe** mirar
`linked`:

```json
{ "linked": false, "claim": { "qrToken": "Zq3_x-9fK2mB7wLpQ0rT1sUv", "expiresAt": "..." } }
{ "linked": true,  "accessToken": "...", "role": "student", "tenantId": null }
```

---

## Dos proveedores, una sola puerta

La api verifica un **ID token de Firebase** y no exige que venga de un proveedor
concreto: `firebase.ts` captura `sign_in_provider` para auditoría, pero no lo
comprueba. Así que correo y Google entran por `/auth/google`, emiten el mismo
código de vinculación y los confirma la misma recepcionista.

| Proveedor | Estado | Qué necesitó |
|---|---|---|
| **Correo + contraseña** | activo | una llamada a la api de Identity Platform |
| **Google** | pendiente | tres clics en la consola de Firebase |

### Por qué el correo y no Google, de momento

Google necesita un **cliente OAuth**, y no hay forma de crearlo por API:

- No existe endpoint público para crear clientes OAuth estándar en Google Cloud.
- El rodeo que existía —`gcloud alpha iap oauth-brands`— **Google lo apagó el 19
  de marzo de 2026**, y además exige que el proyecto pertenezca a una
  organización; este cuelga de una cuenta personal.
- Registrar la app iOS en Firebase por API tampoco lo provisiona: el
  `GoogleService-Info.plist` que devuelve no trae `CLIENT_ID`.

El proveedor de correo no necesita ninguno, y se activa por api:

```bash
curl -X POST "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config?updateMask=signIn.email.enabled"   -H "Authorization: Bearer $(gcloud auth print-access-token)"   -d '{"signIn":{"email":{"enabled":true}}}'
```

### Cuando se quiera Google

1. https://console.firebase.google.com/project/sinchi-a95913/authentication/providers
2. **Google** → activar → elegir correo de soporte → guardar
3. Copiar los client ID a `EXPO_PUBLIC_GOOGLE_CLIENT_ID_{WEB,IOS,ANDROID}`

La app lo detecta sola: `googleAuthReady()` mira si hay algún client ID y solo
entonces muestra el botón. No hay que tocar código.

### La `apiKey` de Firebase no es un secreto (y GitHub la marca igual)

El escáner de secretos de GitHub la detecta como "Google API Key filtrada". Es un
falso positivo, y conviene entender por qué antes de rotar nada:

- En Firebase la `apiKey` **identifica el proyecto**, como un id de cliente OAuth.
  No autoriza nada por sí sola.
- Viaja dentro de `google-services.json`, de `GoogleService-Info.plist` y del
  binario publicado. Cualquiera la extrae de un APK descargado de la tienda.
- **Rotarla no cambia nada de eso**: la nueva sería igual de pública.

Lo que sí protege es **restringirla**. Firebase la creó habilitada para 27 APIs
—incluidas Firestore, Storage, Vertex AI y `sqladmin`—, y eso sí era superficie
innecesaria. Quedó reducida a las dos que la app usa:

```bash
gcloud services api-keys update <UID> --project=sinchi-a95913   --api-target=service=identitytoolkit.googleapis.com   --api-target=service=securetoken.googleapis.com
```

Y no va escrita en el repositorio, por dos razones prácticas —ninguna de
seguridad—: el escáner la marcaría en cada commit, y un aviso que siempre es
falso entrena a ignorar los avisos de verdad; y desarrollo y producción deberían
apuntar a proyectos distintos, cosa que un valor por defecto en el código vuelve
fácil de equivocar.

Se obtiene del proyecto cuando hace falta:

```bash
gcloud --project sinchi-a95913 services api-keys list   --format="value(uid,displayName)"
gcloud --project sinchi-a95913 services api-keys get-key-string <UID>   --format="value(keyString)"
```

**La alerta de GitHub se cierra como falso positivo.** No se reescribe la
historia: sería un force-push que rompe los clones de todo el mundo a cambio de
ocultar un identificador público.

**Nota para iOS:** si la app ofrece Google Sign-In, la guía 4.8 del App Store
puede exigir también Sign in with Apple. Firebase soporta ese proveedor, así que
es configuración más una cuenta de Apple Developer — pero conviene verificarlo
contra las guías vigentes antes de mandar a revisión, no después.

---

## Qué está probado, y con qué

`src/auth.e2e.test.ts` — 21 pruebas contra Postgres real con RLS activo.

El `FirebaseVerifier` se sustituye por uno falso, y eso no es una concesión:
verificar la firma es responsabilidad de `firebase-admin` y probarlo aquí solo
probaría que su librería funciona. Lo que sí hace falta probar, y es donde está
el riesgo, es qué pasa **después** de saber quién es la persona: ¿se vincula a la
ficha correcta? ¿se puede robar la de otro? ¿aísla RLS al recepcionista de otro
gimnasio?

Ese test encontró dos bugs que no se veían leyendo el código. Los dos aparecieron
en el turno del mostrador, que ya no existe, y se dejan escritos porque **ninguna
de las dos lecciones era del turno**:

1. **`SECURITY DEFINER` dependía de un privilegio del rol.** La primera versión
   buscaba una fila con una función `SECURITY DEFINER`, que corre con los
   privilegios del *dueño* de la función. En Neon el dueño es `neondb_owner`, que
   tiene `BYPASSRLS`, así que funcionaba — pero solo por esa propiedad, que es
   justo la que este diseño intenta no necesitar. En el Postgres local de
   pruebas, donde el dueño no la tiene, fallaba. Se comportaba distinto en
   producción y en pruebas. Se reemplazó por una excepción en la política RLS
   (migración 0003), con el mismo patrón que `memberships` y `staff` — que es el
   patrón que hoy usan la invitación y la clase de prueba.

2. **Un contador de intentos dentro de la transacción que falla no cuenta nada.**
   El bloqueo por intentos fallidos se incrementaba en la misma transacción que
   lanzaba la excepción, así que el rollback lo deshacía: se podían probar las
   diez mil combinaciones sin que nada lo notara. Registrar el fallo tiene que ir
   en su propia transacción, que sí se confirma. Vale para cualquier límite de
   intentos que se escriba mañana.

---

## Dos fallos que costaron el despliegue

**La imagen no arrancaba y la culpa parecía del token.** `npm ci` no siempre
hoistea todo a la raíz del monorepo: cuando dos workspaces piden versiones
incompatibles del mismo paquete, npm deja la del workspace anidada en
`apps/api/node_modules`. El Dockerfile copiaba solo `/repo/node_modules`, así que
la imagen salía sin `dotenv` ni `zod` y moría con `Cannot find module
'dotenv/config'`. Lo delicado es que **aparece al regenerar el lockfile, no al
tocar el código**: el reparto entre raíz y workspace cambia solo.

**El error de configuración se disfrazaba de token inválido.** `getApp()` se
llamaba dentro del `try` de `verify()`, así que su excepción —"falta
FIREBASE_PROJECT_ID"— la capturaba el `catch` y salía como *"Sesión de Google
inválida o expirada"*. El mensaje acusaba al token de un fallo del despliegue, que
es exactamente lo que la inicialización perezosa pretendía evitar. Y el detalle
iba a `logger.debug`, que Cloud Run no muestra: los logs salían vacíos. Ahora
`getApp()` va fuera del `try` y el rechazo se registra como `warn`.

---

## Dónde aterriza quien entra sin ficha

En **sus pestañas**: Gimnasios, Mi QR y Mensajes (`app/visitor`).

Fue primero el código de 6 dígitos, que para quien instalaba la app sin entrenar
en ningún sitio —justo a quien el producto quiere llegar— era una pared: un
número que solo servía si un gimnasio ya tenía su ficha hecha y alguien iba a
confirmarlo. Después fue el directorio a secas, sin barra, con el código, los
mensajes y cerrar sesión escondidos dentro. Son tres las cosas que hace alguien
sin gimnasio —buscar dónde, preguntarle a un gimnasio y dejarse inscribir— y cada
una es ahora una pestaña.

Crear la cuenta pide además **nombre y celular**, y esa es la única vez que se
piden. No autentican nada —eso lo hace el token de Firebase— y no tocan `users`:
viven en `account_claims` hasta que haya una ficha a la que atarlos. Sirven para
dos cosas: que reservar una clase no vuelva a preguntar lo que la persona acaba de
escribir, y encontrar las solicitudes que un gimnasio le dejó por su celular.

**Mi QR** es con lo que recepción la inscribe (`SINCHI1:a:<token>`). No abre la
puerta. Vence a los diez minutos y la app lo renueva sola, y mientras la pantalla
está abierta pide las solicitudes cada pocos segundos: la del gimnasio llega
mientras recepción termina el alta, con la persona todavía en el mostrador.

---

## Invitación por enlace

El código de 6 dígitos funciona, pero tiene un coste real: alguien tiene que
pedirlo, dictarlo y confirmarlo. La invitación adelanta esa decisión al momento
de invitar — el staff elige ficha y plan, manda el enlace por WhatsApp, y quien
lo abre **entra ya inscrito**.

```
POST /staff/invites          staff   -> devuelve el token UNA vez
GET  /invites/:token         público -> qué gimnasio, qué plan, cuánto
POST /invites/:token/claim   público -> { idToken } -> sesión ya inscrita
```

### Lo que cambia, y conviene decirlo

**Quien autoriza pasa a ser la posesión del enlace.** Es el mismo trato que hace
GitHub o Slack al invitar a una organización, y el riesgo concreto es que el
enlace se reenvíe por WhatsApp y lo abra otra persona. Se acota:

| Cota | Por qué |
|---|---|
| Token de 32 bytes | No se adivina. Los 6 dígitos podían permitírselo solo porque los confirmaba una persona. |
| Un solo uso | El segundo intento, aunque venga con otra cuenta, encuentra la puerta cerrada. |
| Caduca (7 días) | Un enlace olvidado en un chat deja de valer solo. |
| Revocable | Corta al instante sin tocar la base. |
| Auditable | Queda quién invitó y quién lo reclamó. |

Y una asimetría deliberada: invitar a una ficha **nueva** solo puede crear una
cuenta; invitar a una **existente**, con su historial de pagos, es lo único que
un enlace filtrado podría robar. Por eso `membership_id` es opcional y el caso
normal es `null`.

### Detalles que no son obvios

- **La vista previa no consume.** Quien recibe el enlace tiene derecho a ver a
  qué le invitan antes de decidir. Si mirar lo quemara, abrirlo por curiosidad
  dejaría a la persona fuera.
- **Primero se verifica Firebase, después se consume.** Al revés, mandar basura
  al endpoint inutilizaría invitaciones ajenas.
- **El precio se congela al invitar.** Si el gimnasio sube tarifas entre el envío
  y la apertura, se respeta lo que el staff prometió.
- **El DNI viaja en la invitación.** `users.document_id` es NOT NULL y el staff
  está creando la ficha igual; pedírselo después a la persona sería volver al
  problema que el código evitaba — que cualquiera escriba un DNI ajeno.
- **Los cargos nacen pendientes.** El enlace inscribe, no cobra: quien cobra es
  el mostrador. Marcarlos pagados inventaría un ingreso que nadie recibió.
- **Un mismo mensaje** para caducada, consumida, revocada e inexistente.
  Distinguirlas le diría a quien prueba enlaces al azar si acertó con uno que
  existió.

### El RLS que costó encontrar

La consulta de la vista previa empezó siendo un `JOIN` con `tenants` y `plans`, y
devolvía **siempre vacío**. La invitación sí se ve —el token abre esa fila por
excepción de política, igual que la reserva de una clase de prueba—, pero las tablas vecinas
tienen su propio aislamiento por gimnasio y sin contexto no devuelven nada.

Se resolvió en dos pasos: el token abre la invitación, la invitación dice a qué
gimnasio apunta, y entonces se adopta ese contexto a mitad de transacción
(`adoptTenant`). Lo mismo hacía falta en `claim`, donde si no los `INSERT`
fallaban su `WITH CHECK`.

### Probado

`src/invites.e2e.test.ts` — 11 pruebas contra Postgres real con un rol **sin**
`BYPASSRLS`; con él, las pruebas de aislamiento pasarían sin probar nada.

Dos fallos que encontraron esas pruebas y que no se veían leyendo el código:

1. **El `set_config` del token nunca se escribió.** El campo del tipo y la
   función `withInviteToken` sí entraron, pero la línea que fija el GUC no. Todo
   compilaba; simplemente ninguna invitación era visible.
2. **La suite se contaminaba a sí misma.** Las cuentas que crea un `claim`
   sobreviven al `reset` de la siembra —solo se borra lo que ella sembró—, así
   que un contador de DNI que empieza en cero cada vez chocaba con la corrida
   anterior. Pasaba una vez y fallaba la siguiente sin que nada hubiera cambiado.
