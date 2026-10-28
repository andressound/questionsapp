const { Pool, types } = require('pg');
const { database } = require('./env');

// NUMERIC (puntaje_total) llega como string por defecto; se devuelve como número igual que con mysql2.
types.setTypeParser(types.builtins.NUMERIC, Number.parseFloat);

const pool = new Pool({
  connectionString: database.connectionString,
  host: database.host,
  port: database.port,
  user: database.user,
  password: database.password,
  database: database.name,
  ssl: database.ssl ? { rejectUnauthorized: false } : undefined,
  // Pool pequeño: los planes cloud limitados admiten pocas conexiones simultáneas.
  max: database.poolMax,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  options: `-c TimeZone=${database.timezone}`,
});

// Un cliente inactivo puede perder la conexión (reinicio de la base, red);
// sin este listener el error tumbaría el proceso.
pool.on('error', (error) => {
  console.error('Error en un cliente inactivo de PostgreSQL', error);
});

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
