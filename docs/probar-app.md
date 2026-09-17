# Enviar la app a testers

`.github/workflows/probar-app.yml`, a mano desde Actions → **Enviar a testers**,
o desde la terminal:

    gh workflow run probar-app.yml -f plataforma=ios

Eliges plataforma (`ambas`, `ios` o `android`), compila en EAS con el perfil
`production` y sube:

- **iOS → TestFlight, internos y externos.** Los internos (usuarios de tu App
  Store Connect) lo ven en cuanto Apple procesa el binario. Con `externos`
  marcado —por defecto sí— el workflow espera ese procesado, le pone las notas
  de `store/appstore/testflight-whats-new.txt`, lo agrega al grupo externo
  **«Testers abiertos»** (el del enlace público
  https://testflight.apple.com/join/kJydEX5K) y lo envía a Beta App Review. Los
  externos lo reciben cuando Apple lo aprueba.
- **Android → pista cerrada Alpha.** El build entra con `eas submit` y después
  `.github/scripts/play-release-notes.mjs` le escribe las notas de «Novedades»
  desde `store/play/release-notes.txt`. Sin ese paso la release sale muda —la
  versionCode 6 lleva así desde el 2026-09-08— porque la config de Android de
  `eas submit` solo sabe de pista, estado y rollout.

**Antes de disparar, actualiza las notas**, en el mismo commit que la función
nueva:

- `store/appstore/testflight-whats-new.txt` — lo que los testers de iOS leen en
  «Qué probar». Beta App Review lo exige para externos, y no tiene límite de
  largo.
- `store/play/release-notes.txt` — lo que los de Android leen en «Novedades».
  **Máximo 500 caracteres**, que es lo que acepta Play por idioma; el script
  corta el envío antes de llamar a la API si te pasas. Son dos archivos por eso,
  y porque Play no tiene un apartado de «qué probar» separado del «qué cambió».

**Reenviar un build que ya compiló** —porque falló la subida, o para llevarlo a
externos después— sin gastar otro crédito: `build_id` con el ID del build de EAS
y la plataforma de ese build (`ios` o `android`, no `ambas`).

    gh workflow run probar-app.yml -f plataforma=ios -f build_id=<id de EAS>

Los pasos de después del envío son idempotentes: el de externos no agrega el
build dos veces al grupo ni pide dos revisiones, y el de las notas de Play no
abre ninguna edición si la release ya dice exactamente eso.

## Por que Alpha y no el canal interno de Play

El canal interno llega en segundos y no espera nada. Pero el requisito que te
separa de produccion —12 testers durante 14 dias seguidos, por ser cuenta
personal— **solo cuenta pruebas cerradas**. Un build que va al canal interno no
mueve ese reloj. Por eso el workflow apunta a Alpha; la pista se cambia en
`eas.json` (`submit.production.android.track`), no en el workflow.

Si algun dia necesitas el canal interno para una prueba rapida:

    cd apps/mobile && npx eas submit -p android --latest --track internal

## Por que se dispara a mano

No hay expo-updates en el proyecto, asi que no hay actualizaciones OTA: cada
envio es un binario completo. Entre 20 y 40 minutos y un credito de EAS por
plataforma. Automatizarlo en cada merge a main significaria gastar dos builds
por cambio de una linea.

Si mas adelante quieres que cada merge llegue a los testers, lo barato es
agregar `expo-updates` y publicar un update de JavaScript — segundos, sin
credito — y dejar los builds completos solo para cuando cambie algo nativo.

## Preparacion (una sola vez)

### iOS
Lo mismo que para publicar: llave de la App Store Connect API y credenciales de
firma en EAS. Esta en `docs/publicar-ios.md`.

El runner no tiene secretos de GitHub: entra a Google Cloud por federación de
identidad como `sinchi-deployer` y lee de Secret Manager `sinchi-expo-token` (el
robot de Expo) y `sinchi-asc-api-key` (la llave `.p8` de la App Store Connect
API, Key ID `Z5299M485J`). La segunda es la que usa
`.github/scripts/testflight-external.mjs`: `eas submit --groups` no sirve para
externos, solo conoce grupos internos.

Ademas, en App Store Connect → **TestFlight** → **Internal Testing**, crea un
grupo y agrega a la gente. Tienen que ser usuarios de tu cuenta de App Store
Connect (Users and Access); no basta el correo.

### Android
`eas submit` habla con la Play Developer API, y para eso necesita una cuenta de
servicio de Google:

1. Play Console → **Setup** → **API access** → crea o enlaza un proyecto de
   Google Cloud y genera una **cuenta de servicio**.
2. Dale el permiso de **Release manager** (o al menos "Release to testing
   tracks") sobre la app.
3. Descarga el JSON de la cuenta de servicio. **No va al repositorio.**
4. Subelo a EAS:

       cd apps/mobile && npx eas credentials

   Android → `production` → Google Service Account. Queda guardado en EAS y el
   runner no ve nada.

Las notas de la release **no** pasan por EAS: las escribe el script contra la
Play Developer API, y necesita un token para ella. No hay un segundo JSON ni un
secreto en GitHub — el runner, que ya entra a Google Cloud como
`sinchi-deployer`, se hace pasar por la cuenta de servicio:

    gcloud iam service-accounts add-iam-policy-binding \
      play-publisher@sinchi-a95913.iam.gserviceaccount.com \
      --member="serviceAccount:sinchi-deployer@sinchi-a95913.iam.gserviceaccount.com" \
      --role="roles/iam.serviceAccountTokenCreator"

Ya está hecho. Es la **misma** `play-publisher@` cuyo JSON subiste a EAS, así que
ese archivo sigue existiendo en un solo lugar y los permisos de Play Console se
conceden una vez. Si algún día el script responde 401, es que el permiso se cayó
o que a esa cuenta le quitaron el rol en Play Console.

Ojo con un detalle de Play: la API **no puede crear la primera release** de una
app. Ya esta cubierto —la release 5 se subio a mano— asi que el camino esta
abierto.

## Que NO hace

- No corre tests. Eso es `ci.yml`, en cada push y PR, y ahora exporta el bundle
  de iOS y de Android por separado.
- No publica en ninguna tienda. TestFlight y la pista cerrada son pruebas; la
  App Store se envia con `publicar-ios.yml` (tag `v*`) y Play production
  todavia no esta disponible hasta que se cumplan los 14 dias.
