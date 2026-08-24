# ¿Un repo o varios?

**Un solo repositorio.** El backend se queda aquí.

La pregunta venía con una premisa razonable —"¿no debería tener su propio repo
para tener CI y CD?"— y la premisa es lo que hay que separar de la conclusión:
**CI/CD no necesita un repo por cosa desplegable.** Los filtros por ruta de
GitHub Actions dan pipelines independientes dentro del monorepo, y eso es lo que
está montado en `.github/workflows/`.

---

## Por qué separarlo saldría caro aquí

`packages/shared` no es una carpeta de utilidades. Es el diseño del sistema:
`validateCheckIn`, `computeReceivable`, `prorateUpgrade`, `evaluateDelinquency`,
`applyPayment`, `accessMessage`. La api y la app consumen las mismas funciones, y
eso es deliberado — la especificación lo pide explícito:

> Escribirla dos veces es el bug que se descubre en el estado de cuenta de un
> cliente tres meses después.

Si el backend se va a otro repositorio, `@sinchi/shared` tiene que convertirse en
un paquete publicado. Y ahí empieza el costo real:

**1. Cada cambio de dominio pasa a ser tres pasos y dos repos.** Hoy, corregir el
prorrateo es un commit: se toca la función, se corrige el test, y la api y la app
quedan corregidas a la vez. Separado: cambiar en el repo del dominio → publicar
una versión → actualizar la dependencia en el repo del backend → actualizarla en
el de la app. Con una versión mal sincronizada de por medio.

**2. La api y la app podrían correr versiones distintas del dominio.** Y eso no es
un riesgo abstracto: `accessMessage()` existe justamente para que el alumno y el
staff digan lo mismo del mismo hecho. Con deriva de versiones, el alumno lee *"te
queda 1 sesión"* y el recepcionista lee *"cupo agotado"* — la discusión en la
puerta que el diseño intenta evitar.

**3. Los tests de punta a punta dejan de valer lo mismo.** Hoy verifican el
dominio y la api juntos contra Postgres real, y en esta sesión encontraron cuatro
bugs que el typecheck no veía. Con el dominio publicado, esos tests corren contra
la versión publicada: un bug de dominio descubierto desde la api ya no se arregla
en un commit.

Nada de eso es imposible de manejar. Simplemente no compra nada a cambio.

---

## Cuándo sí convendría partirlo

Vale escribirlo para reconocer el momento si llega:

- **Equipos distintos con permisos distintos.** Si alguien debe poder tocar la app
  sin acceso al código de cobro, la frontera de repositorio es la herramienta.
- **Cadencias de release incompatibles.** La app pasa por revisión de tienda; la
  api se despliega cuando se quiera. Hoy no choca porque la app todavía no está
  publicada.
- **CI genuinamente lento.** Con 40 mil líneas y pipelines filtrados por ruta,
  esto está lejos.
- **Abrir el backend o compartirlo con un tercero** manteniendo la app privada.

Ninguna aplica con un producto y una persona desarrollando.

---

## Lo que está montado

Tres workflows, y **ningún secreto en GitHub**.

### `ci.yml` — en cada push y PR

Tres jobs independientes, cada uno condicionado a las rutas que cambiaron:

| Job | Corre cuando cambia | Qué hace |
|---|---|---|
| `shared` | `packages/**` | build, typecheck, 165 tests |
| `api` | `apps/api/**` o `packages/**` | migra y corre 117 tests contra **Postgres real**, construye la imagen |
| `mobile` | `apps/mobile/**` o `packages/**` | typecheck y genera el bundle |

Dos detalles que hacen que el job de `api` valga:

- **El rol de Postgres no es superusuario.** El `postgres` por defecto tiene
  `BYPASSRLS`, así que probar con él no probaría el aislamiento por tenant. El CI
  crea un rol `sinchi_app` `nobypassrls`, igual que en Neon.
- **Construye la imagen.** Es barato y atrapa lo que el typecheck no ve: una ruta
  de import que solo falla en ejecución (pasó con `@noble/hashes`), o un paquete
  del workspace que no se copió al contenedor.

### `deploy-api.yml` — al hacer push a `main`

Construye, sube, despliega, **comprueba que responde y revierte si no**. Cloud Run
no revierte solo: una revisión que arranca se considera buena aunque no llegue a
la base.

Se dispara con cambios en `apps/api/**` **y** en `packages/shared/**` — la api
lleva el dominio compilado dentro de la imagen, así que un cambio en las reglas de
cobro tiene que llegar.

### `migrate.yml` — a mano, nunca automático

Encadenar migraciones al despliegue suena cómodo hasta la primera migración mala:
se aplica sola, sin nadie mirando, sobre el ledger de pagos de gimnasios reales. Y
un `ALTER TABLE` no se deshace con un `git revert`.

Así que se lanza a mano y en dos tiempos: por defecto **solo muestra el SQL
pendiente**; hay que volver a lanzarlo escribiendo `aplicar`. Antes de tocar
producción lo ensaya contra un Postgres desechable.

---

## Autenticación sin llaves

El despliegue usa **Workload Identity Federation**: GitHub emite un token OIDC
firmado que dice *"soy el repo `xMathyu/Sinchi`"*, y GCP lo cambia por
credenciales temporales.

```
GitHub Actions ──OIDC──> GCP STS ──> sinchi-deployer (credenciales de 1 hora)
```

La alternativa habitual es guardar la llave JSON de una cuenta de servicio en un
secreto de GitHub. Es una credencial de larga vida, con permiso de despliegue, que
hay que rotar a mano y que queda comprometida ante cualquier fuga del repositorio.
Esto no tiene nada que rotar.

El control que lo sostiene está en el proveedor:

```
--attribute-condition="assertion.repository == 'xMathyu/Sinchi'"
```

Sin esa condición, **cualquier** repositorio de GitHub podría pedir un token y
suplantar la cuenta. Con ella, solo este.

`sinchi-deployer` tiene tres roles y nada más: `run.admin`,
`artifactregistry.writer`, `iam.serviceAccountUser`. No puede leer la base, ni los
secretos de la aplicación, ni crear roles. La cadena del rol dueño para migrar
vive en Secret Manager, y solo ese secreto le está concedido.

### Los dos identificadores del workflow no son secretos

```yaml
workload_identity_provider: projects/961173851857/.../providers/github
service_account: sinchi-deployer@sinchi-a95913.iam.gserviceaccount.com
```

Van en claro a propósito: son nombres de recurso, y sin un token OIDC emitido para
este repositorio no sirven para nada. Guardarlos como secretos daría una falsa
sensación de protección y complicaría leer el workflow.
