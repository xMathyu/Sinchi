# Enviar la app a testers

`.github/workflows/probar-app.yml`, a mano desde Actions → **Enviar a testers**.
Eliges plataforma (`ambas`, `ios` o `android`), compila en EAS con el perfil
`production` y sube:

- **iOS → TestFlight.** Los testers internos (hasta 100 usuarios de tu App Store
  Connect) lo ven sin revision de Apple, en cuanto Apple termina de procesar el
  binario. Los testers externos si pasan por Beta App Review.
- **Android → pista cerrada Alpha.** La misma que ya tiene la release 5.

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

Ojo con un detalle de Play: la API **no puede crear la primera release** de una
app. Ya esta cubierto —la release 5 se subio a mano— asi que el camino esta
abierto.

## Que NO hace

- No corre tests. Eso es `ci.yml`, en cada push y PR, y ahora exporta el bundle
  de iOS y de Android por separado.
- No publica en ninguna tienda. TestFlight y la pista cerrada son pruebas; la
  App Store se envia con `publicar-ios.yml` (tag `v*`) y Play production
  todavia no esta disponible hasta que se cumplan los 14 dias.
