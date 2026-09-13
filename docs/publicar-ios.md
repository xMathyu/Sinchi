# Publicar la app iOS

El build de tienda lo hace **EAS** en sus maquinas macOS; GitHub Actions solo lo
dispara y espera (`.github/workflows/publicar-ios.yml`). Xcode Cloud quedo
descartado porque exige versionar `apps/mobile/ios/`, y ese directorio lo genera
`expo prebuild` — la razon esta escrita al inicio del workflow.

## Preparacion (una sola vez)

### 1. Llave de la App Store Connect API

Es lo que le permite a EAS crear el certificado de distribucion y subir el
binario sin que nadie escriba una contraseña ni un codigo 2FA en un servidor.

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**.
2. Genera una llave con rol **App Manager** (o Admin).
3. Descarga el `.p8`. **Apple lo deja descargar una sola vez.** Guardalo fuera
   del repositorio — en tu gestor de contraseñas, no en Descargas.
4. Anota el **Key ID** y el **Issuer ID** que quedan en esa pantalla.

### 2. Credenciales de firma en EAS

Desde `apps/mobile`, con sesion iniciada (`eas login`):

    npx eas credentials

Elegir iOS → `production` → subir la llave de la App Store Connect API y dejar
que EAS genere el **Distribution Certificate** y el **Provisioning Profile**.
Quedan guardados en EAS; el repositorio no ve ninguno.

Sin este paso el workflow falla en el primer intento: `--non-interactive` no
puede crear credenciales, solo usarlas.

### 3. Token de Expo para el runner — hecho el 2026-09-13

No vive en GitHub. Es el token del robot **«GitHub Actions (Sinchi)»** de
`mathyus-team` —rol Developer: compila y envía, no administra la cuenta— y está
en Secret Manager como `sinchi-expo-token`, con lectura solo para
`sinchi-deployer`. El runner lo lee por federación de identidad, igual que la
api lee sus secretos.

Hasta esa fecha el workflow pedía `secrets.EXPO_TOKEN`, que nunca se creó, y
fallaba a los 37 segundos: todos los builds anteriores salieron de la Mac.

Para rotarlo, crea un token nuevo para ese robot en
https://expo.dev/accounts/mathyus-team/settings/robots y súbelo como versión
nueva:

    printf %s "$TOKEN" | gcloud secrets versions add sinchi-expo-token --data-file=- --project=sinchi-a95913

Para cortarlo del todo, revócalo en Expo: el runner falla al instante.

## Publicar una version

    # 1. La version en app.json es la que sale en la tienda.
    #    Tiene que coincidir con la de App Store Connect y con el tag.
    git tag v1.0.0
    git push origin v1.0.0

El workflow compara el tag con `apps/mobile/app.json` y aborta si no coinciden.
Despues compila y sube el binario a App Store Connect. Tarda entre 20 y 40
minutos; el check queda en amarillo mientras EAS trabaja.

Para un build fuera de un tag: Actions → **Publicar app iOS** → *Run workflow*.
La casilla `enviar` decide si sube a la tienda o solo deja el `.ipa` en EAS.

## Numeros de version

- **`version` en app.json** (`1.0.0`) es la version de mercado. Sale en la ficha
  de la tienda y tiene que ser identica en App Store Connect, o el binario no se
  puede seleccionar para esa version.
- **El build number** lo lleva EAS (`appVersionSource: "remote"` +
  `autoIncrement` en el perfil de produccion). No se toca a mano y no se
  versiona: por eso no hay que acordarse de subirlo antes de cada build.

## Lo que este pipeline NO hace

- No corre tests: de eso se encarga `ci.yml` en cada push y PR.
- No publica en la App Store. Sube el binario; la version se envia a revision
  desde App Store Connect y sale cuando tu la liberes (esta en modo manual).
- No toca Android. `eas build --platform android` es el mismo camino, pero la
  cuenta de Play todavia esta en revision.
