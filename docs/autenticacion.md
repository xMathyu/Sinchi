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

## Rutas

| Método | Ruta | Quién |
|---|---|---|
| `POST` | `/auth/google` | público — devuelve sesión **o** código de vinculación |
| `GET` | `/auth/shift/staff` | equipo (`X-Device-Token`) — quiénes pueden abrir turno |
| `POST` | `/auth/shift` | equipo + PIN — abre turno |
| `GET` | `/staff/claims` | staff — códigos vigentes |
| `POST` | `/staff/claims/confirm` | staff — vincula `{ code, membershipId }` |
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

## Falta un paso en la consola de Firebase

El proveedor de Google necesita un cliente OAuth. Por API habría que armarlo a
mano y sale peor configurado; la consola lo provisiona sola. Son tres clics:

1. https://console.firebase.google.com/project/sinchi-a95913/authentication/providers
2. **Google** → activar
3. Elegir el correo de soporte y guardar

Sin eso, `/auth/google` responde 401 a cualquier token: Firebase no emite ninguno
para ese proyecto. El resto de la cadena ya está desplegada y verificada.

Después hay que registrar las apps (iOS/Android/Web) en el proyecto para obtener
los client ID que consume `expo-auth-session`.

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
