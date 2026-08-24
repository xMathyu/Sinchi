# Probar la app en un iPhone

**Expo Go no sirve para este proyecto.** La última versión en la App Store es
**54.0.2** (septiembre de 2025) y solo soporta SDK 54; el proyecto está en SDK 57.
Expo dejó de publicar Expo Go para SDK 55, 56 y 57 en la tienda, así que no es
cuestión de actualizar: no existe una versión compatible.

Comprobarlo cuesta un comando:

```bash
curl -s "https://itunes.apple.com/lookup?bundleId=host.exp.Exponent" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      const r=JSON.parse(d).results[0];
      console.log('Expo Go en la App Store:', r.version, '| iOS mínimo:', r.minimumOsVersion);
    })"
```

La web tampoco: en SDK 57 el bundle de `platform=web` falla por una
incompatibilidad entre `@expo/cli` y React Native 0.86 (`./rn-get-polyfills` no
está en el mapa de `exports` de react-native). Es un bug de arriba.

Queda el **development build**, que además es a donde hay que llegar de todas
formas: el MD 11 ya prevé el módulo nativo de Culqi, y eso Expo Go no lo puede
cargar nunca.

---

## Qué hace falta

- Cuenta de **Apple Developer** de pago. Sin ella no hay perfil de
  aprovisionamiento y el `.ipa` no se instala en un teléfono físico.
- Cuenta de **Expo** (gratis) para EAS.
- El iPhone registrado en el perfil ad-hoc.

Desde Windows todo esto lo hace EAS en servidores macOS. No hace falta Mac.

---

## Primera vez

```bash
cd apps/mobile

npx eas login          # cuenta de Expo
npx eas init           # crea el proyecto y escribe extra.eas.projectId en app.json

# Registra el iPhone en el perfil ad-hoc. Da un QR: se escanea con el teléfono
# y se instala un perfil de configuración. Una vez por dispositivo.
npx eas device:create

# Pide las credenciales de Apple y genera certificado y perfil.
npx eas build --platform ios --profile development
```

El build en la cola gratuita puede tardar entre 10 y 40 minutos. Al terminar, EAS
devuelve un enlace: abrirlo **en el iPhone** instala la app.

---

## Cada vez que quieras probar

El dev build **no** trae el código dentro: se conecta a un Metro local, igual que
Expo Go. Así que reconstruir solo hace falta al cambiar dependencias nativas o
`app.json`.

```bash
cd apps/mobile
npx expo start --dev-client --tunnel
```

Y abrir la app en el iPhone: se conecta sola, o se escanea el QR.

`--tunnel` porque la laptop está por cable y el teléfono por wifi: muchos routers
aíslan las dos redes, y el túnel sale a internet y vuelve. En una red donde el
teléfono sí ve la laptop, `--lan` es más rápido.

---

## Los tres perfiles de `eas.json`

| Perfil | Para qué | Trae dev client |
|---|---|---|
| `development` | El iPhone del equipo, día a día | sí |
| `preview` | Probar rendimiento real y comportamiento de app publicada | no |
| `production` | TestFlight y App Store | no |

`preview` existe porque **un dev build siempre engaña con el rendimiento**: el
bundle va en modo desarrollo, sin minificar y con comprobaciones extra. Lo que se
siente lento ahí puede ir bien publicado, y al revés.

---

## Lo que el monorepo obliga a hacer

EAS sube el contexto desde la **raíz del repositorio**, no desde `apps/mobile`,
porque la app depende de `@sinchi/shared` y `@sinchi/ui` — paquetes del workspace
que hay que compilar antes del bundle.

De eso se encarga un hook en `apps/mobile/package.json`:

```json
"eas-build-post-install": "cd ../.. && npm run build -w @sinchi/shared -w @sinchi/ui"
```

Va como hook de EAS y no como `postinstall` de la raíz a propósito: un
`postinstall` haría lo mismo en el servidor, pero también bloquearía cada
`npm install` local mientras `shared` tenga un error de tipos — justo cuando más
falta poder instalar. Sin el hook, el build falla con
`Cannot find module '@sinchi/shared'`, que es el error clásico de construir un
monorepo en un servicio remoto.

`metro.config.js` ya declara `packages/*` como código del proyecto; sin eso Metro
no recompila al tocar el dominio.

---

## Mientras no haya build: modo demostración

La app trae una puerta de desarrollo (`__DEV__` únicamente) que permite recorrer
las once pantallas sin api, sin sesión y sin Google configurado:

**login → "Probar sin Google (desarrollo)" → "Modo demostración"**

Los datos salen de `src/data/demo.ts` y pasan por las mismas funciones puras de
`@sinchi/shared` que usa la api. El rol se cambia desde Ajustes para ver modo
alumno y modo staff.

Sirve para revisar diseño y flujos. No sirve para probar la cámara, el llavero ni
la validación real del QR — eso necesita dispositivo y servidor.
