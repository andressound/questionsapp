# QuestionsApp — Backend

API REST de **QuestionsApp**, app móvil (Flutter) de retos de preguntas de opción múltiple: retos diarios y semanales, retos personalizados de profesores, puntos, rachas y clasificación.

**Node.js 24 · Express 5 · PostgreSQL 17.** En producción: backend en Render y base de datos en Neon.

## Endpoints

🔒 exige `Authorization: Bearer <token>` (si no, `401 UNAUTHORIZED`). 👩‍🏫 exige rol profesor (si no, `403 FORBIDDEN`). Los errores llegan como `{"error": {"code", "message"}}`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/auth/register` | Crea un estudiante y devuelve `token` (`409` si el usuario o correo existen) |
| POST | `/api/auth/login` | Usuario (o correo) y contraseña → usuario + `token` |
| GET | `/api/auth/me` 🔒 | Usuario de la sesión |
| POST | `/api/auth/logout` 🔒 | Cierra la sesión (`204`) |
| GET | `/api/preguntas/diarias` 🔒 | 5 preguntas del día |
| GET | `/api/preguntas/semanales` 🔒 | 10 preguntas de la semana (lunes a domingo) |
| POST | `/api/preguntas/{diarias,semanales}/:idPregunta/responder` 🔒 | `{"opcionId", "tiempoSegundos"}`; `opcionId: null` = tiempo agotado |
| PATCH | `/api/usuarios/:id` 🔒 | Cambia `username`/`email` con la `password` actual |
| GET | `/api/usuarios/ranking?limit=` 🔒 | Clasificación de estudiantes |
| GET | `/api/usuarios/ranking/me` 🔒 | Puesto del usuario de la sesión |
| GET/POST | `/api/profesor/preguntas` 🔒👩‍🏫 | Banco de preguntas (de 5 en 5) / crear pregunta |
| GET/POST | `/api/profesor/retos` 🔒👩‍🏫 | Retos personalizados / crear reto con código |
| GET | `/api/profesor/retos/:id/estadisticas` 🔒👩‍🏫 | Respuestas por opción de cada pregunta |
| GET | `/api/retos-personalizados/:codigo` 🔒 | Entrar a un reto con su código (`410` si terminó) |
| POST | `/api/retos-personalizados/:codigo/preguntas/:idPregunta/responder` 🔒 | Igual que la diaria |
| GET | `/health` | Estado del servidor y de PostgreSQL (`503` si la base no responde) |

Las contraseñas se guardan con `scrypt` y los tokens como hash SHA-256; la sesión caduca tras 30 días sin uso. La respuesta correcta nunca se envía antes de responder.

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `DATABASE_URL` | — | Conexión a PostgreSQL. Tiene prioridad sobre `DB_*` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `127.0.0.1`, `5432`, `questionsapp`, —, `questionsapp` | Conexión por partes (desarrollo local) |
| `TZ` | `UTC` | Zona horaria: decide cuándo cambian el día y la semana de los retos |
| `PORT` | `8080` | Puerto HTTP (Render lo define solo) |
| `DB_SSL` | `false` | TLS cuando no se usa `DATABASE_URL` con `sslmode` |
| `DB_POOL_MAX` | `5` | Conexiones máximas a la base |

`npm start` carga `.env` si existe (`node --env-file-if-exists`); en la nube las variables las define la plataforma. `.env` no se sube al repositorio: usa `.env.example` como plantilla.

## Despliegue (Render + Neon)

1. **Base de datos (Neon):** cargar el esquema y los datos iniciales en el SQL Editor, y usar la cadena de conexión **directa** (sin `-pooler`) terminada en `?sslmode=verify-full`.
2. **Backend (Render):** Web Service con runtime **Docker** a partir de este repositorio. El `Dockerfile` usa `node:24-alpine`, instala solo dependencias de producción y ejecuta `node src/server.js` con el usuario `node`.
3. Variables en Render: `DATABASE_URL` y `TZ` (por ejemplo `America/Bogota`).
4. Comprobar: `https://<servicio>.onrender.com/health` → `{"status":"ok","database":"ok"}`.

En el plan gratuito, Render apaga el servicio tras 15 min sin tráfico y la primera petición después tarda cerca de un minuto.

## Desarrollo local

```bash
npm install
cp .env.example .env   # ajustar la conexión a tu PostgreSQL
npm run dev            # recarga al guardar
npm test               # tests con node:test, no necesitan base de datos
```

Crear un profesor (el registro de la app solo crea estudiantes) o cambiar su contraseña:

```bash
npm run crear-profesor -- <usuario> <correo> <contraseña>
```

Usa la base de `.env`; para la de producción, antepón `DATABASE_URL='<cadena de Neon>'`.

## Estructura

```
src/
├── server.js       # Arranque y cierre ordenado (SIGTERM)
├── app.js          # Middlewares, rutas y errores
├── config/         # Variables de entorno y pool de PostgreSQL
├── routes/         # Rutas por recurso
├── controllers/    # Lógica de cada endpoint
├── middleware/     # Sesión (requireAuth, requireTeacher) y errores
└── utils/          # Contraseñas, sesiones, respuestas, puntos y rachas
scripts/            # crear-profesor.js
test/               # Tests (node --test)
Dockerfile          # Imagen de producción
```
