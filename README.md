# QuestionsApp — Backend

API REST de **QuestionsApp**, una app móvil (Flutter) para aprender respondiendo preguntas de opción múltiple con estilo de videojuego retro. Los usuarios se registran, juegan retos con tiempo límite, suman puntos y compiten en una clasificación.

Construida con **Node.js 24**, **Express 5** y **PostgreSQL 17**.

## Qué hace la app

- **Cuentas**: registro e inicio de sesión. Las contraseñas se guardan con hash `scrypt`.
- **Sesión persistente**: al entrar, el servidor da un token que la app guarda cifrado. La sesión dura 30 días desde el último uso y se renueva sola.
- **Reto diario**: 5 preguntas al día, elegidas al azar y fijas durante ese día. Se responden una a una desde la lista de retos.
- **Reto semanal**: 10 preguntas por semana (de lunes a domingo) que se juegan seguidas. Se puede salir y retomar por la primera pregunta pendiente.
- **Tiempo**: cada pregunta tiene 15 s en el cliente. Si no se responde, cuenta como fallo.
- **Puntos y clasificación**: cada acierto suma los `puntos` de la pregunta. El ranking y el perfil se calculan a partir de las respuestas guardadas.
- **Perfil**: cambiar nombre de usuario o correo, confirmando con la contraseña actual.

La respuesta correcta nunca se envía al cliente antes de que responda.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/auth/register` | Crea un usuario y abre sesión. `201` con `token`; `409` si el correo o el nombre de usuario ya existen |
| POST | `/api/auth/login` | Devuelve el usuario y un `token`; `401` si las credenciales fallan |
| GET | `/api/auth/me` 🔒 | Usuario de la sesión con puntos y retos (la app lo usa al arrancar) |
| POST | `/api/auth/logout` 🔒 | Cierra la sesión actual (`204`) |
| GET | `/api/preguntas/diarias` 🔒 | Las 5 preguntas del día, con `realizada` para el usuario de la sesión |
| POST | `/api/preguntas/diarias/:idPregunta/responder` 🔒 | Guarda la respuesta (`opcionId: null` = tiempo agotado); `409 QUESTION_LOCKED` si hay retos anteriores sin responder |
| GET | `/api/preguntas/semanales` 🔒 | Las 10 preguntas de la semana |
| POST | `/api/preguntas/semanales/:idPregunta/responder` 🔒 | Igual que la diaria; `409` si ya se respondió esa semana |
| PATCH | `/api/usuarios/:id` 🔒 | Cambia `username` y/o `email` de tu propia cuenta (`403` si es otra); exige la `password` actual |
| GET | `/api/usuarios/ranking?limit=` 🔒 | Clasificación por puntos |
| GET | `/api/usuarios/ranking/me` 🔒 | Puesto del usuario de la sesión en la clasificación completa |
| GET | `/api/profesor/preguntas?pagina=` 🔒👩‍🏫 | Banco de preguntas de 5 en 5 (nuevas primero), con la opción correcta |
| POST | `/api/profesor/preguntas` 🔒👩‍🏫 | Crea una pregunta: `{"enunciado", "opciones": [4 textos], "correcta": 0-3}`; entra en los retos diario y semanal activos |
| GET | `/api/profesor/retos` 🔒👩‍🏫 | Retos personalizados del profesor con su código y nº de estudiantes |
| POST | `/api/profesor/retos` 🔒👩‍🏫 | Crea un reto: `{"titulo", "preguntas": [ids], "segundosPregunta", "daPuntos", "duracionHoras"}`; genera el código |
| GET | `/api/profesor/retos/:id/estadisticas` 🔒👩‍🏫 | Cuántos estudiantes eligieron cada opción de cada pregunta |
| GET | `/api/retos-personalizados/:codigo` 🔒 | El estudiante entra a un reto con el código (`404` código no válido, `410` terminado) |
| POST | `/api/retos-personalizados/:codigo/preguntas/:idPregunta/responder` 🔒 | Igual que la diaria; si el reto no da puntos, no suma nada |
| GET | `/health` | Estado del proceso y de PostgreSQL |

🔒 = exige la cabecera `Authorization: Bearer <token>`. Sin ella, o con una sesión caducada o cerrada, la respuesta es `401 UNAUTHORIZED`. 👩‍🏫 = además exige rol `PROFESOR` o `ADMIN` (`403 FORBIDDEN` si no).

El usuario lleva `rol` (`estudiante`, `profesor` o `admin`). El registro crea siempre estudiantes, y solo los estudiantes aparecen en la clasificación.

Cuerpo de una respuesta: `{"opcionId": 7, "tiempoSegundos": 4}`. El usuario sale del token. El servidor devuelve `correcta`, `puntos_ganados`, `puntos_bonus`, `puntos_totales`, `retos_completados`, `racha_actual`, `racha_maxima` y `reto_completado`.

### Rachas

- La racha son los días seguidos con el reto diario completado (las 5 preguntas). No se guarda: se calcula desde `intentos` (`src/utils/streak.js`).
- Sigue viva mientras el último día completado sea hoy o ayer. Si se salta un día, vuelve a 0. `racha_maxima` guarda la más larga.
- Al completar el reto diario se gana un bonus de `min(racha, 10)` puntos. Se guarda en `intentos.puntos_bonus` y suma a `puntos_totales` y al ranking.
- `login` y `/api/auth/me` devuelven también `racha_actual` y `racha_maxima`. El día lo marca `TZ`, igual que el reto diario.

Los errores llegan como `{"error": {"code": "...", "message": "..."}}`.

### Autenticación

- `login` y `register` crean una sesión y devuelven un `token` aleatorio de 43 caracteres. En la tabla `sesiones` solo se guarda su hash SHA-256.
- La sesión caduca a los 30 días sin uso. Cada petición autenticada renueva el plazo, como mucho una vez al día.
- `logout` borra la sesión: ese token deja de valer al instante.
- El middleware `requireAuth` (`src/middleware/auth.js`) valida el token y deja el id del usuario en `request.userId`.

## Estructura

```
backend/
├── src/
│   ├── server.js            # Arranque del servidor y cierre ordenado (SIGTERM/SIGINT)
│   ├── app.js               # App Express: middlewares, rutas, 404 y errores
│   ├── config/
│   │   ├── env.js           # Lectura de variables de entorno
│   │   └── database.js      # Pool de PostgreSQL y helper withTransaction
│   ├── routes/              # URLs y métodos HTTP de cada recurso
│   ├── controllers/         # Lógica: auth, users, questions (diario y semanal), health
│   ├── middleware/          # Manejador de errores y requireAuth (sesión)
│   └── utils/               # Contraseñas, tokens de sesión, validaciones y HttpError
├── database/
│   ├── schema.sql           # Esquema completo: tipos, tablas, claves e índices
│   ├── seed.sql             # Datos iniciales: área, retos diario/semanal, 20 preguntas y 80 opciones
│   └── migrations/          # Cambios para bases ya creadas (idempotentes)
├── test/                    # Tests con node:test (no necesitan base de datos)
├── docker-compose.yml       # PostgreSQL local para desarrollo
├── Dockerfile               # Imagen de producción del backend
└── .env.example             # Plantilla de configuración
```

### Modelo de datos

- `usuarios`, `areas`, `preguntas` (con `puntos`), `opciones` (con `es_correcta`).
- `sesiones`: hash del token, usuario y caducidad.
- `retos` y `reto_preguntas`: definen cada reto y su banco de preguntas.
- `reto_diario` / `reto_diario_preguntas`: el conjunto de 5 preguntas de cada día.
- `reto_semanal` / `reto_semanal_preguntas`: el conjunto de 10 preguntas de cada semana (`semana` es el lunes).
- `intentos`: un intento por usuario, reto y periodo. Los semanales usan `fecha_dia` = lunes.
- `respuestas_estudiante`: cada respuesta dada. Es la fuente de verdad de los puntos.

## Probarlo en otra máquina

### Requisitos

- [Node.js](https://nodejs.org/) **24 o superior** (`node -v`).
- [Docker](https://docs.docker.com/get-docker/) con Docker Compose, para PostgreSQL. También vale un PostgreSQL 17 instalado a mano.
- Git.

### Pasos

1. **Clona el repositorio e instala las dependencias**

   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd backend
   npm install
   ```

2. **Crea tu `.env`.** No está en el repositorio porque contiene credenciales.

   ```bash
   cp .env.example .env
   ```

   Cambia `DB_PASSWORD` si quieres. Docker Compose y el servidor leen el mismo `.env`, así que basta con cambiarlo ahí.

3. **Levanta PostgreSQL**

   ```bash
   docker compose up -d postgres
   ```

   Cuando el volumen está vacío, en el primer arranque se ejecutan automáticamente `database/schema.sql` y `database/seed.sql`.

   Si el puerto `5432` ya está ocupado, cambia `DB_PORT` en `.env`.

4. **Arranca el servidor**

   ```bash
   npm run dev     # recarga al guardar cambios
   # o
   npm start
   ```

5. **Comprueba que funciona**

   ```bash
   curl http://localhost:8080/health

   # Crea un usuario y guarda el token que devuelve
   curl -X POST http://localhost:8080/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"username":"prueba","email":"prueba@example.com","password":"secreto123"}'

   curl http://localhost:8080/api/preguntas/semanales -H 'Authorization: Bearer <TOKEN>'
   ```

6. **Ejecuta los tests.** No necesitan la base de datos.

   ```bash
   npm test
   ```

### Conectar la app Flutter

El servidor escucha en `0.0.0.0:8080`. En Flutter, la URL se pasa con `--dart-define=API_BASE_URL=...`:

- Emulador Android: `http://10.0.2.2:8080`
- Simulador iOS: `http://127.0.0.1:8080`
- Móvil físico: `http://IP_DEL_PC:8080`. El móvil y el PC deben estar en la misma red, y el firewall debe permitir el puerto 8080.

### Base de datos: tareas habituales

```bash
# Consola SQL
docker exec -it questionsapp-pg psql -U questionsapp -d questionsapp

# Recargar el banco de preguntas en una base existente (idempotente)
docker exec -i questionsapp-pg psql -U questionsapp -d questionsapp < database/seed.sql

# Aplicar las migraciones a una base creada antes de esos cambios (en orden)
docker exec -i questionsapp-pg psql -U questionsapp -d questionsapp < database/migrations/001_reto_semanal.sql
docker exec -i questionsapp-pg psql -U questionsapp -d questionsapp < database/migrations/002_sesiones.sql
docker exec -i questionsapp-pg psql -U questionsapp -d questionsapp < database/migrations/003_racha_bonus.sql
docker exec -i questionsapp-pg psql -U questionsapp -d questionsapp < database/migrations/004_retos_personalizados.sql

# Crear un profesor (o convertir en profesor una cuenta que ya existe)
npm run crear-profesor -- profesor profesor@questionsapp.com profesor123

# Cerrar todas las sesiones (todos tendrán que volver a entrar)
docker exec -i questionsapp-pg psql -U questionsapp -d questionsapp -c 'DELETE FROM sesiones;'

# Empezar de cero (BORRA todos los datos)
docker compose down -v && docker compose up -d postgres
```

Los scripts de `schema.sql` y `seed.sql` solo se ejecutan solos si el volumen está vacío. Si ya tenías una base de una versión anterior, aplica las migraciones de `database/migrations/` en orden y después recarga `seed.sql`.

### Problemas frecuentes

- **`ECONNREFUSED 127.0.0.1:5432`**: PostgreSQL no está arrancado. Revisa `docker compose ps`.
- **`password authentication failed`**: cambiaste `DB_PASSWORD` después de crear el volumen. Vuelve a la clave anterior o recrea la base con `docker compose down -v`.
- **`relation "reto_semanal" does not exist`**: tu base es anterior al reto semanal. Aplica `database/migrations/001_reto_semanal.sql` y recarga `seed.sql`.
- **`relation "sesiones" does not exist`**: aplica `database/migrations/002_sesiones.sql`.
- **`column "puntos_bonus" does not exist`**: aplica `database/migrations/003_racha_bonus.sql`.
- **`column r.da_puntos does not exist`** (o `codigo`): aplica `database/migrations/004_retos_personalizados.sql`.
- **`401 UNAUTHORIZED` en todas las rutas**: falta la cabecera `Authorization: Bearer <token>`, o la sesión caducó o se cerró. Vuelve a hacer login.
- **`No hay un reto ... activo`**: falta `seed.sql`, o no hay ningún reto `ACTIVO` de ese tipo en `retos`.

## Configuración (`.env`)

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | `8080` | Puerto HTTP |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `127.0.0.1`, `5432`, `questionsapp`, —, `questionsapp` | Conexión a PostgreSQL |
| `TZ` | `UTC` | Zona horaria; decide cuándo cambian el día y la semana |
| `DATABASE_URL` | — | Opcional. Si existe, tiene prioridad sobre `DB_*` (útil en la nube) |
| `DB_SSL` | `false` | `true` para bases gestionadas con TLS |
| `DB_POOL_MAX` | `5` | Conexiones máximas del pool |

No hace falta `dotenv`: `npm start` y `npm run dev` cargan `.env` con `node --env-file-if-exists=.env`. En la nube, las variables las define la plataforma.

## Despliegue con Docker

```bash
docker build -t questionsapp-backend .
docker run --rm -p 8080:8080 --env-file .env \
  -e DB_HOST=host.docker.internal --add-host=host.docker.internal:host-gateway \
  questionsapp-backend
```

La imagen usa `node:24-alpine`, incluye solo las dependencias de producción y se ejecuta con el usuario `node`.

## Pendiente

- Endpoints para que los profesores creen retos, y editen o desactiven preguntas.
