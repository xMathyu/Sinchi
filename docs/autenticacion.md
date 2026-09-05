# Autenticación

Google Sign-In vía Firebase para alumnos y dueños; token de equipo más PIN para
el staff del mostrador.

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

### La solución: lo confirma quien tiene al alumno enfrente

Es la verificación de identidad más fuerte disponible, y es gratis.

```
1. El alumno entra con Google
2. La api responde { linked: false, claim: { code: "482917", expiresAt } }
3. Su app muestra los 6 dígitos
4. Recepción los escribe junto a su nombre en el padrón
5. firebase_uid queda atado a esa ficha — una sola vez, para siempre
```

Se pliega al alta: el alumno ya está en el mostrador cuando se inscribe, así que
para alguien nuevo es un solo paso.

**Detalles que importan:**

- El código dura 10 minutos y **se reutiliza** mientras esté vivo. Si el alumno
  cierra y abre la app en la cola, el número que tiene en la mano sigue sirviendo.
- La membresía se resuelve **con contexto de tenant**, así que RLS garantiza que
  recepción solo pueda vincular contra su propio padrón, aunque el código sea de
  alguien de otro local.
- Si la ficha ya tiene otra cuenta vinculada, se **rechaza**. Sin eso, alguien
  podría desplazar la cuenta de un alumno y quedarse con su historial.
- El dueño puede **desvincular**. El vínculo lo hace una persona y las personas
  se equivocan; si recepción asocia la cuenta de Diego a la ficha de Julio, tiene
  que haber forma de deshacerlo sin entrar a la base a mano.

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

Existe porque sin ella el arranque es circular: el dueño necesitaría que alguien
con autoridad confirmara su código, y todavía no hay nadie. Está limitada a
`owner`; recepción se vincula con código, como todos.

---

## Staff: token del equipo + PIN

El equipo del mostrador es compartido y los turnos rotan. Cerrar y abrir sesión
de Google en cada cambio termina en *"dejemos la de Ana abierta"* — que es
exactamente el agujero que la auditoría intenta cerrar: `attendance.recorded_by`
y `charges.recorded_by` dejarían de decir la verdad sobre quién marcó y quién
cobró.

```
El dueño registra el equipo    POST /v1/staff/devices  -> deviceToken (una vez)
Cada persona abre su turno     POST /v1/auth/shift     -> sesión de 12 h
```

- El **token del equipo** es un secreto de portador de 32 bytes, guardado como
  `sha256`. Secreto de portador y no JWT porque revocar tiene que ser inmediato:
  una tablet que se pierde en el gimnasio. Se muestra **una vez**.
- El **PIN** son 4 a 6 dígitos, guardado con **scrypt**. Se rechazan los obvios
  (`1111`, `1234`).
- Tras **5 intentos** fallidos se bloquea **15 minutos**. Sin ese bloqueo, probar
  las diez mil combinaciones de un PIN de cuatro dígitos es cuestión de minutos.
- La sesión dura **12 horas**: cubre el turno más largo y muere antes del
  siguiente, así que quien entra a las seis no hereda la sesión de mediodía.

### Por qué scrypt para el PIN y sha256 para el token

Confundirlo es el error clásico, y va en las dos direcciones:

- El **PIN** tiene como máximo un millón de combinaciones. Con un hash rápido se
  rompe en segundos, así que va con un KDF deliberadamente lento.
- El **token** tiene 32 bytes de entropía: no hay nada que romper por fuerza
  bruta. Y hace falta **buscar** el equipo por su hash, lo que un KDF con sal
  aleatoria hace imposible. Con scrypt habría que recorrer todos los equipos
  probando uno por uno.

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
2. **No había vuelta.** No existía `switch-to-staff`. La otra entrada al modo
   staff es `POST /auth/shift`, que pide el token del equipo del mostrador — y el
   teléfono del dueño no es esa tablet. Cambiar a alumno era un viaje de ida:
   para volver había que cerrar sesión y entrar de nuevo.

```
POST /auth/switch-to-student   staff  -> sesión de alumno
POST /auth/switch-to-staff     quien tenga fila en `staff` -> vuelve a su puesto
GET  /auth/modes               cualquiera -> { student, staff }
```

### No concede nada

`switch-to-staff` vuelve a leer `staff` y devuelve exactamente lo que
`issueForUser` le habría dado al entrar con Google. No es una escalada: si la
fila ya no está —lo sacaron del equipo mientras miraba su billetera— no hay
vuelta. Y la sesión de alumno tampoco puede tocar el padrón aunque la persona sea
la dueña: manda el rol del token, no quién es.

### El agujero que abría, y que costó una prueba

Reemitir el token **regalaba vida nueva**. El turno del mostrador dura 12 horas a
propósito: «quien entra a las seis no hereda la sesión de mediodía». Pero
`switch-to-student` y su vuelta firmaban con el TTL del login normal, así que en
una tablet compartida bastaba pasar por alumno y volver para convertir un turno
de 12 horas en una sesión de **7 días**.

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

## Rutas

| Método | Ruta | Quién |
|---|---|---|
| `POST` | `/auth/google` | público — devuelve sesión **o** código de vinculación |
| `GET` | `/auth/shift/staff` | equipo (`X-Device-Token`) — quiénes pueden abrir turno |
| `POST` | `/auth/shift` | equipo + PIN — abre turno |
| `GET` | `/staff/claims` | staff — códigos vigentes |
| `POST` | `/staff/claims/confirm` | staff — vincula `{ code, membershipId }` |
| `GET` | `/auth/modes` | cualquier sesión — qué otros modos tiene |
| `POST` | `/auth/switch-to-student` | staff con ficha — mira su billetera |
| `POST` | `/auth/switch-to-staff` | quien tenga fila en `staff` — vuelve a su puesto |
| `DELETE` | `/staff/members/:id/account` | dueño — desvincula |
| `POST` | `/staff/pin` | staff (el propio) / dueño (de cualquiera) |
| `GET` `POST` | `/staff/devices` | dueño |
| `DELETE` | `/staff/devices/:id` | dueño — revoca |

La respuesta de `/auth/google` tiene dos formas y el cliente **debe** mirar
`linked`:

```json
{ "linked": false, "claim": { "code": "482917", "expiresAt": "..." } }
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

Ese test encontró dos bugs que no se veían leyendo el código:

1. **`SECURITY DEFINER` dependía de un privilegio del rol.** La primera versión
   buscaba el equipo con una función `SECURITY DEFINER`, que corre con los
   privilegios del *dueño* de la función. En Neon el dueño es `neondb_owner`, que
   tiene `BYPASSRLS`, así que funcionaba — pero solo por esa propiedad, que es
   justo la que este diseño intenta no necesitar. En el Postgres local de
   pruebas, donde el dueño no la tiene, abrir turno fallaba con "este equipo no
   está registrado". Se comportaba distinto en producción y en pruebas.
   Reemplazado por una excepción en la política RLS (migración 0003), con el mismo
   patrón que `memberships` y `staff`.

2. **El bloqueo del PIN no existía.** El contador de intentos se incrementaba
   dentro de la misma transacción que lanzaba la excepción, así que el rollback lo
   deshacía. El contador nunca subía: se podían probar las diez mil combinaciones
   de un PIN de cuatro dígitos sin que nada lo notara. Ahora el registro del fallo
   va en su propia transacción, que sí se confirma.

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

El código de 6 dígitos **ya no es la primera pantalla**. Lo era, y para quien
instalaba la app sin entrenar en ningún sitio —justo a quien el producto quiere
llegar— era una pared: un número que solo sirve si un gimnasio ya tiene su ficha
hecha y alguien va a confirmarlo.

Ahora una cuenta sin ficha aterriza en el **directorio de gimnasios**, que es lo
único que esa persona puede hacer hoy: mirar horarios y precios, y reservar su
primera clase gratis.

Crear la cuenta pide además **nombre y celular**, y esa es la única vez que se
piden. No autentican nada —eso lo hace el token de Firebase— y no tocan `users`:
viven con el código pendiente (`account_claims.display_name` y `phone`) hasta que
haya una ficha a la que atarlos. Existen por una razón concreta: sin ellos,
reservar una clase gratis volvía a preguntar lo que la persona acababa de
escribir, y eso se lee como que la app no guarda nada.

El código no desaparece, y no puede: es el único camino para el alumno al que su
gimnasio dio de alta **por DNI y sin invitarlo**. El auto-vínculo por correo
verificado existe solo para el dueño (`tryLinkOwnerByEmail`), a propósito — el
correo de un alumno lo escribe otra persona con prisa en un mostrador, y un typo
entregaría una membresía ajena. Así que el código vive a un toque, en el
directorio: «¿Tu gimnasio ya te registró? Muéstrale tu código a recepción».

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
excepción de política, igual que el token de equipo—, pero las tablas vecinas
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
