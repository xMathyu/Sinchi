# Despliegue — Cloud Run

La api corre en Cloud Run, en `us-east4` (Virginia), contra la base de Neon que
está en AWS `us-east-1` (también Virginia).

```
Lima ──70ms──> Cloud Run (Virginia) ──8ms──> Neon (Virginia)
```

**Por qué Virginia y no Santiago**, que está más cerca de Lima: una petición
típica de la api hace 3 consultas. Desde Santiago el primer salto ahorra 30 ms
pero cada consulta cruza el continente (~150 ms), así que se pierden 425. El
viaje largo conviene pagarlo una vez, no tres. Mover la api a Sudamérica solo
tendría sentido moviendo también la base.

| | |
|---|---|
| Proyecto | `sinchi-a95913` |
| Región | `us-east4` |
| Servicio | `sinchi-api` |
| Imagen | `us-east4-docker.pkg.dev/sinchi-a95913/sinchi/api` |
| Cuenta de servicio | `sinchi-api@sinchi-a95913.iam.gserviceaccount.com` |

---

## El cron no funciona en Cloud Run, y falla en silencio

Es el detalle que rompe el despliegue si no se ve antes.

Con `min-instances=0` el contenedor **se apaga** cuando no hay tráfico. El
refresco de morosidad está programado a las 06:00 de Lima, que es exactamente
cuando nadie está usando la app: no hay contenedor, y el `@Cron` de
`@nestjs/schedule` no corre.

Lo peor es que no falla ruidosamente. Nadie ve un error. Se nota semanas después,
cuando el panel lista morosos que ya pagaron y el dueño deja de confiar en el
número.

**La solución es invertir quién llama.** En vez de que la api se despierte sola,
Cloud Scheduler la despierta con una petición HTTP:

```
Cloud Scheduler (06:00 Lima) ──POST /v1/jobs/refresh-delinquency──> Cloud Run
```

Eso implica tres cosas en el código:

- `SCHEDULER_MODE=external` apaga el cron interno. El decorador `@Cron` se
  registra igual —no se puede condicionar— así que la comprobación va dentro del
  handler.
- `JOBS_TOKEN` es el secreto compartido con el planificador. Sin él, las rutas de
  `/jobs` quedan **apagadas**: preferible un trabajo que no corre a un endpoint
  que cualquiera dispara. La api se niega a arrancar con `SCHEDULER_MODE=external`
  y sin token.
- El endpoint es idempotente: recalcula desde `evaluateDelinquency` y escribe
  solo lo que cambió. Cloud Scheduler puede reintentar sin cuidado.

En un servidor que siempre está encendido, `SCHEDULER_MODE=in_process` y el cron
interno basta. La configuración existe porque las dos formas son legítimas.

---

## Costo

Para un dojo de 150 alumnos esto entra en la capa gratuita, pero conviene saber
dónde están los bordes.

| Servicio | Gratis al mes | Qué lo rompería |
|---|---|---|
| Cloud Run | 2 M peticiones, 180 k vCPU-s, 360 k GiB-s | `min-instances > 0`: se paga CPU inactiva 24/7 |
| Cloud Scheduler | 3 trabajos | Nada, hay 1 |
| Secret Manager | 6 versiones activas, 10 k accesos | Hay 4 versiones. Cada arranque en frío lee los 4 |
| Artifact Registry | 0,5 GB | Cada imagen pesa ~340 MB: **a la segunda versión se pasa** |
| Egress | 1 GB a internet | Respuestas JSON; muy lejos |

**La única partida que se va a pasar es Artifact Registry.** Son unos centavos
($0,10/GB/mes), pero conviene borrar imágenes viejas:

```bash
gcloud artifacts docker images list us-east4-docker.pkg.dev/sinchi-a95913/sinchi/api \
  --include-tags --sort-by=~CREATE_TIME
gcloud artifacts docker images delete <IMAGEN>@<DIGEST> --delete-tags
```

Cloud Run necesita una cuenta de facturación vinculada **incluso para usar la
capa gratuita**. Está vinculada; el gasto esperado es de centavos.

Ver el gasto real:

```bash
gcloud billing accounts list
# y en la consola: Billing > Reports, filtrando por proyecto sinchi-a95913
```

---

## Nadie puede iniciar sesión todavía

El servicio está arriba y llega a la base, pero **la app no puede autenticarse
contra él**. No es un olvido:

- La autenticación real es por SMS y no está implementada (falta decidir
  proveedor y presupuesto de mensajes).
- `ALLOW_DEV_LOGIN=false` en producción, a propósito. Ese login **no verifica
  nada**: quien conozca un número de celular obtiene una sesión válida. En una
  URL pública equivale a dejar la puerta abierta.

Para una demo temporal, con el riesgo entendido:

```bash
gcloud run services update sinchi-api --region=us-east4 \
  --update-env-vars=ALLOW_DEV_LOGIN=true
# y para cerrarla:
gcloud run services update sinchi-api --region=us-east4 \
  --update-env-vars=ALLOW_DEV_LOGIN=false
```

Mientras esté en `true`, cualquiera que sepa un celular del padrón puede entrar.

---

## Volver a desplegar

```bash
PROJECT=sinchi-a95913
REGION=us-east4
IMG=$REGION-docker.pkg.dev/$PROJECT/sinchi/api
TAG=v2

# Desde la RAÍZ del monorepo: la api depende de @sinchi/shared, que hay que compilar.
docker build --platform linux/amd64 -f apps/api/Dockerfile -t "$IMG:$TAG" .
docker push "$IMG:$TAG"

gcloud run deploy sinchi-api --project=$PROJECT --region=$REGION --image="$IMG:$TAG"
```

`--platform linux/amd64` no es opcional: construir en una máquina ARM sin ese
flag produce una imagen que Cloud Run no puede ejecutar, y el error aparece al
desplegar, no al construir.

### Migraciones

Van con el rol dueño del esquema, no con el de la api (que no tiene DDL a
propósito). Se corren desde tu máquina con el `.env` local:

```bash
cd apps/api && npm run db:migrate
```

Las migraciones también viajan dentro de la imagen (`apps/api/drizzle`), así que
se pueden aplicar desde el mismo artefacto desplegado si algún día hace falta.

---

## Configuración y por qué

```
--min-instances=0        Se apaga sin tráfico. Es lo que mantiene el costo en cero
                         y lo que obliga a usar Cloud Scheduler para el cron.
--max-instances=4        Tope de seguridad. Cada instancia abre hasta 5 conexiones
                         a Neon: 4 x 5 = 20, dentro del límite del pooler.
--concurrency=40         Peticiones por instancia. Más alto agotaría el pool.
--memory=512Mi           El proceso usa ~120 MB; el resto es margen.
--cpu-throttling         Sin CPU asignada entre peticiones. Es lo correcto para
                         una api que solo trabaja cuando le hablan.
--timeout=30s            Ninguna petición legítima tarda tanto.
--allow-unauthenticated  La app y el panel son clientes públicos; la autenticación
                         la hace la api con JWT, no la capa de IAM.
```

Los cuatro secretos van **por referencia** a Secret Manager, no como variables
literales. Así rotarlos no exige reconstruir la imagen, y no aparecen en
`gcloud run services describe`. La cuenta de servicio tiene
`secretmanager.secretAccessor` **solo sobre esos cuatro secretos**, no a nivel de
proyecto.

---

## Diagnóstico

```bash
# Salud
curl https://sinchi-api-961173851857.us-east4.run.app/v1/health/ready

# Logs de la api
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=sinchi-api' \
  --project=sinchi-a95913 --limit=50

# ¿Está llegando Cloud Scheduler?
gcloud logging read \
  'resource.type=cloud_run_revision AND httpRequest.userAgent:"Google-Cloud-Scheduler"' \
  --project=sinchi-a95913 --limit=10

# Disparar el trabajo a mano
gcloud scheduler jobs run sinchi-refresh-delinquency \
  --project=sinchi-a95913 --location=us-east4
```

La primera petición tras un rato de inactividad tarda más: se suman el arranque
en frío de Cloud Run (~400 ms) y el despertar del compute de Neon, que también
duerme (~700 ms la primera consulta). Con tráfico, ambas bajan a decenas de
milisegundos.

---

## Bajar todo

```bash
gcloud projects delete sinchi-a95913
```

Se lleva el servicio, las imágenes, los secretos y el trabajo programado. La base
de Neon **no** se toca: vive fuera de GCP.
