const { pool, withTransaction } = require('../config/database');
const HttpError = require('../utils/http-error');

const PAGE_SIZE = 5;
const OPTION_COUNT = 4;
const MAX_STATEMENT_LENGTH = 500;
const MAX_OPTION_LENGTH = 200;

// Preguntas con todas sus opciones, incluida la correcta: solo lo ven los profesores.
// `where` es un fragmento fijo de este archivo.
function bankQuestionsSql(where) {
  return `
    SELECT p.id_pregunta AS id,
           p.enunciado,
           p.puntos,
           p.activa,
           json_agg(json_build_object(
             'id', o.id_opcion,
             'texto', o.texto,
             'es_correcta', o.es_correcta
           ) ORDER BY o.id_opcion) AS opciones
      FROM preguntas p
      INNER JOIN opciones o ON o.id_pregunta = p.id_pregunta
     WHERE ${where}
     GROUP BY p.id_pregunta
     ORDER BY p.id_pregunta DESC`;
}

// Banco de preguntas de 5 en 5, las más nuevas primero.
async function listQuestions(request, response) {
  const requestedPage = Number.parseInt(request.query.pagina, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT * FROM (${bankQuestionsSql('TRUE')}) AS banco LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
    pool.query('SELECT COUNT(*) AS total FROM preguntas'),
  ]);
  const total = Number(countRows[0].total);
  return response.json({
    preguntas: rows,
    pagina: page,
    total,
    total_paginas: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

// Devuelve el cuerpo limpio ({ enunciado, opciones, correcta }) o lanza VALIDATION_ERROR.
function validateNewQuestion(body) {
  const { enunciado, opciones, correcta } = body || {};
  const statement = typeof enunciado === 'string' ? enunciado.trim() : '';
  if (statement === '' || statement.length > MAX_STATEMENT_LENGTH) {
    throw new HttpError(400, 'VALIDATION_ERROR', `El enunciado debe tener entre 1 y ${MAX_STATEMENT_LENGTH} caracteres`);
  }
  if (!Array.isArray(opciones) || opciones.length !== OPTION_COUNT) {
    throw new HttpError(400, 'VALIDATION_ERROR', `La pregunta debe tener ${OPTION_COUNT} opciones`);
  }
  const options = opciones.map((option) => (typeof option === 'string' ? option.trim() : ''));
  if (options.some((option) => option === '' || option.length > MAX_OPTION_LENGTH)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Cada opción debe tener entre 1 y ${MAX_OPTION_LENGTH} caracteres`);
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Las opciones no pueden repetirse');
  }
  if (!Number.isInteger(correcta) || correcta < 0 || correcta >= OPTION_COUNT) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Indica cuál es la opción correcta');
  }
  return { enunciado: statement, opciones: options, correcta };
}

// Crea la pregunta con sus opciones y la añade a los retos diario y semanal activos,
// que es de donde se sortean las preguntas de cada día y de cada semana.
async function createQuestion(request, response) {
  const { enunciado, opciones, correcta } = validateNewQuestion(request.body);

  const question = await withTransaction(async (client) => {
    const { rows: areaRows } = await client.query(
      `SELECT id_area FROM retos
        WHERE tipo = 'DIARIO' AND estado = 'ACTIVO' AND id_area IS NOT NULL
        ORDER BY id_reto DESC
        LIMIT 1`,
    );
    const areaId = areaRows[0]?.id_area ?? 1;

    const { rows } = await client.query(
      `INSERT INTO preguntas (id_area, enunciado, nivel_dificultad, puntos)
       VALUES ($1, $2, 'MEDIO', 1)
       RETURNING id_pregunta`,
      [areaId, enunciado],
    );
    const questionId = rows[0].id_pregunta;

    await client.query(
      `INSERT INTO opciones (id_pregunta, texto, es_correcta)
       SELECT $1, option.texto, option.posicion - 1 = $3
         FROM unnest($2::text[]) WITH ORDINALITY AS option(texto, posicion)`,
      [questionId, opciones, correcta],
    );

    // Bloquea los retos para que dos altas a la vez no calculen la misma posición.
    await client.query(
      `WITH activos AS (
         SELECT id_reto FROM retos
          WHERE tipo IN ('DIARIO', 'SEMANAL') AND estado = 'ACTIVO'
          FOR UPDATE
       )
       INSERT INTO reto_preguntas (id_reto, id_pregunta, posicion)
       SELECT a.id_reto, $1,
              COALESCE((SELECT MAX(rp.posicion) FROM reto_preguntas rp WHERE rp.id_reto = a.id_reto), 0) + 1
         FROM activos a`,
      [questionId],
    );

    const { rows: created } = await client.query(bankQuestionsSql('p.id_pregunta = $1'), [questionId]);
    return created[0];
  });

  return response.status(201).json(question);
}

module.exports = { createQuestion, listQuestions, validateNewQuestion };
