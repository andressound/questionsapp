const app = require('./app');
const { port } = require('./config/env');
const { pool } = require('./config/database');

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`QuestionsApp backend listening on port ${port}`);
});

// Las plataformas cloud envían SIGTERM antes de detener el contenedor:
// se dejan de aceptar conexiones, se terminan las peticiones en curso y se cierra el pool.
function shutdown(signal) {
  console.log(`${signal} recibido, cerrando servidor`);
  const forceExit = setTimeout(() => {
    console.error('Cierre forzado tras agotar el tiempo de espera');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
