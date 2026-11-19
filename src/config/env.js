// Las variables llegan desde el entorno. En local, `npm start` carga `.env` con
// `node --env-file-if-exists=.env`; en la nube las define la plataforma.

function toNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

module.exports = {
  port: toNumber(process.env.PORT, 8080),
  // Código que deben escribir los profesores al registrarse; vacío desactiva ese registro.
  teacherSignupCode: process.env.TEACHER_SIGNUP_CODE || '',
  database: {
    // DATABASE_URL (habitual en proveedores cloud) tiene prioridad sobre DB_*.
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || '127.0.0.1',
    port: toNumber(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'questionsapp',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'questionsapp',
    timezone: process.env.TZ || 'UTC',
    ssl: process.env.DB_SSL === 'true',
    poolMax: toNumber(process.env.DB_POOL_MAX, 5),
  },
};
