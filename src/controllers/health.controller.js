const { pool } = require('../config/database');

async function health(_request, response) {
  try {
    await pool.query('SELECT 1');
    return response.json({ status: 'ok', database: 'ok' });
  } catch (_error) {
    return response.status(503).json({ status: 'ok', database: 'unavailable' });
  }
}

module.exports = { health };
