const crypto = require('node:crypto');
const { pool, withTransaction } = require('../config/database');
const HttpError = require('../utils/http-error');
const { saveAnswer, userProgress } = require('../utils/answers');
const { getStreak } = require('../utils/streak');

// Retos personalizados: los crea un profesor con preguntas del banco y los estudiantes
// entran con un código. Se guardan en `retos` con tipo TIEMPO_DEFINIDO.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para no confundirlos
const CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const CODE_ATTEMPTS = 5;
const TIMER_SECONDS = [10, 15, 20, 30, 45, 60];
const DURATION_HOURS = [1, 2, 24, 72, 168];
const MAX_TITLE_LENGTH = 150;
const MAX_QUESTIONS = 20;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function parseCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return CODE_PATTERN.test(code) ? code : null;
}

function parseId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Devuelve el cuerpo limpio o lanza VALIDATION_ERROR.
function validateNewChallenge(body) {
  const { titulo, preguntas, segundosPregunta, daPuntos, duracionHoras } = body || {};
  const title = typeof titulo === 'string' ? titulo.trim() : '';
  if (title === '' || title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, 'VALIDATION_ERROR', `El título debe tener entre 1 y ${MAX_TITLE_LENGTH} caracteres`);
  }
  if (!Array.isArray(preguntas) || preguntas.length === 0 || preguntas.length > MAX_QUESTIONS) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Elige entre 1 y ${MAX_QUESTIONS} preguntas`);
  }
  if (!preguntas.every((id) => Number.isInteger(id) && id > 0) || new Set(preguntas).size !== preguntas.length) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Preguntas inválidas o repetidas');
  }
  if (!TIMER_SECONDS.includes(segundosPregunta)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `El cronómetro debe ser de ${TIMER_SECONDS.join(', ')} segundos`);
  }
  if (typeof daPuntos !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Indica si el reto da puntos');
  }
  if (!DURATION_HOURS.includes(duracionHoras)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Duración del reto inválida');
  }
  return { titulo: title, preguntas, segundosPregunta, daPuntos, duracionHoras };
}

// Las fechas de `retos` son TIMESTAMP sin zona: se devuelven con zona para que el cliente las ubique.
const CHALLENGE_COLUMNS = `
  r.id_reto AS id,
  r.titulo,
  r.codigo,
  r.cantidad_preguntas,
  r.segundos_por_pregunta,
  r.da_puntos,
  r.fecha_inicio AT TIME ZONE current_setting('TimeZone') AS fecha_inicio,
  r.fecha_fin AT TIME ZONE current_setting('TimeZone') AS fecha_fin,
  (r.fecha_fin > LOCALTIMESTAMP) AS activo,
  (SELECT COUNT(*) FROM intentos i WHERE i.id_reto = r.id_reto) AS estudiantes`;

function challengeJson(row) {
  return { ...row, estudiantes: Number(row.estudiantes) };
}

// --- Profesor ---

async function listChallenges(request, response) {
  const { rows } = await pool.query(
    `SELECT ${CHALLENGE_COLUMNS}
       FROM retos r
      WHERE r.tipo = 'TIEMPO_DEFINIDO' AND r.id_creador = $1
      ORDER BY r.id_reto DESC
      LIMIT 50`,
    [request.userId],
  );
  return response.json(rows.map(challengeJson));
}

async function createChallenge(request, response) {
  const { titulo, preguntas, segundosPregunta, daPuntos, duracionHoras } = validateNewChallenge(request.body);

  const challenge = await withTransaction(async (client) => {
    const { rows: found } = await client.query(
      'SELECT COUNT(*) AS total FROM preguntas WHERE id_pregunta = ANY($1::int[]) AND activa = TRUE',
      [preguntas],
    );
    if (Number(found[0].total) !== preguntas.length) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Alguna pregunta no existe o está desactivada');
    }

    // Un código repetido no inserta nada (ON CONFLICT) y se prueba con otro.
    let challengeId = null;
    for (let attempt = 0; attempt < CODE_ATTEMPTS && challengeId === null; attempt++) {
      const { rows } = await client.query(
        `INSERT INTO retos (id_creador, titulo, tipo, cantidad_preguntas, puntos, fecha_inicio, fecha_fin,
                            estado, codigo, segundos_por_pregunta, da_puntos)
         VALUES ($1, $2, 'TIEMPO_DEFINIDO', $3, 0, LOCALTIMESTAMP, LOCALTIMESTAMP + make_interval(hours => $4),
                 'ACTIVO', $5, $6, $7)
         ON CONFLICT (codigo) DO NOTHING
         RETURNING id_reto`,
        [request.userId, titulo, preguntas.length, duracionHoras, generateCode(), segundosPregunta, daPuntos],
      );
      challengeId = rows[0]?.id_reto ?? null;
    }
    if (challengeId === null) {
      throw new Error('No se pudo generar un código de reto único');
    }

    // Las preguntas se juegan en el orden en que el profesor las eligió.
    await client.query(
      `INSERT INTO reto_preguntas (id_reto, id_pregunta, posicion)
       SELECT $1, chosen.id_pregunta, chosen.posicion
         FROM unnest($2::int[]) WITH ORDINALITY AS chosen(id_pregunta, posicion)`,
      [challengeId, preguntas],
    );

    const { rows } = await client.query(`SELECT ${CHALLENGE_COLUMNS} FROM retos r WHERE r.id_reto = $1`, [challengeId]);
    return challengeJson(rows[0]);
  });

  return response.status(201).json(challenge);
}

// Cuántos estudiantes (y quiénes) eligieron cada opción de cada pregunta. Solo el creador (o un admin) lo ve.
async function challengeStats(request, response) {
  const challengeId = parseId(request.params.id);
  if (!challengeId) {
    throw new HttpError(404, 'CHALLENGE_NOT_FOUND', 'Reto no encontrado');
  }
  const { rows: challengeRows } = await pool.query(
    `SELECT ${CHALLENGE_COLUMNS}
       FROM retos r
      WHERE r.id_reto = $1 AND r.tipo = 'TIEMPO_DEFINIDO'
        AND (r.id_creador = $2 OR $3)`,
    [challengeId, request.userId, request.userRole === 'ADMIN'],
  );
  if (!challengeRows[0]) {
    throw new HttpError(404, 'CHALLENGE_NOT_FOUND', 'Reto no encontrado');
  }

  const { rows } = await pool.query(
    `WITH conteo AS (
       SELECT re.id_pregunta, re.id_opcion_seleccionada AS id_opcion, COUNT(*) AS total,
              jsonb_agg(u.username ORDER BY u.username) AS nombres
         FROM respuestas_estudiante re
         INNER JOIN intentos i ON i.id_intento = re.id_intento
         INNER JOIN usuarios u ON u.id_usuario = i.id_estudiante
        WHERE i.id_reto = $1
        GROUP BY re.id_pregunta, re.id_opcion_seleccionada
     )
     SELECT p.id_pregunta AS id,
            rp.posicion,
            p.enunciado,
            COALESCE(sr.total, 0) AS sin_respuesta,
            COALESCE(sr.nombres, '[]'::jsonb) AS estudiantes_sin_respuesta,
            json_agg(json_build_object(
              'id', o.id_opcion,
              'texto', o.texto,
              'es_correcta', o.es_correcta,
              'respuestas', COALESCE(oc.total, 0),
              'estudiantes', COALESCE(oc.nombres, '[]'::jsonb)
            ) ORDER BY o.id_opcion) AS opciones
       FROM reto_preguntas rp
       INNER JOIN preguntas p ON p.id_pregunta = rp.id_pregunta
       INNER JOIN opciones o ON o.id_pregunta = p.id_pregunta
       LEFT JOIN conteo oc ON oc.id_opcion = o.id_opcion
       LEFT JOIN conteo sr ON sr.id_pregunta = p.id_pregunta AND sr.id_opcion IS NULL
      WHERE rp.id_reto = $1
      GROUP BY p.id_pregunta, rp.posicion, p.enunciado, sr.total, sr.nombres
      ORDER BY rp.posicion`,
    [challengeId],
  );

  const challenge = challengeJson(challengeRows[0]);
  return response.json({
    reto: challenge,
    estudiantes: challenge.estudiantes,
    preguntas: rows.map((row) => ({ ...row, sin_respuesta: Number(row.sin_respuesta) })),
  });
}

// --- Estudiante ---

// Reto vigente con ese código; 404 si no existe y 410 si ya terminó.
async function findOpenChallenge(db, rawCode) {
  const code = parseCode(rawCode);
  const { rows } = code === null ? { rows: [] } : await db.query(
    `SELECT r.id_reto, r.titulo, r.cantidad_preguntas, r.segundos_por_pregunta, r.da_puntos,
            r.fecha_inicio::date::text AS dia,
            r.fecha_fin AT TIME ZONE current_setting('TimeZone') AS fecha_fin,
            (r.fecha_fin > LOCALTIMESTAMP) AS activo
       FROM retos r
      WHERE r.codigo = $1 AND r.tipo = 'TIEMPO_DEFINIDO'`,
    [code],
  );
  if (!rows[0]) {
    throw new HttpError(404, 'CHALLENGE_NOT_FOUND', 'Código no válido');
  }
  if (!rows[0].activo) {
    throw new HttpError(410, 'CHALLENGE_EXPIRED', 'Este reto ya terminó');
  }
  return rows[0];
}

// Datos del reto y sus preguntas (sin la respuesta correcta), con `realizada` para el estudiante.
async function joinChallenge(request, response) {
  const challenge = await findOpenChallenge(pool, request.params.codigo);
  const { rows: questions } = await pool.query(
    `SELECT r.id_reto AS reto_id,
            rp.posicion,
            p.id_pregunta AS id,
            'opcion_multiple' AS tipo,
            p.enunciado,
            p.puntos,
            (re.id_respuesta IS NOT NULL) AS realizada,
            json_agg(json_build_object('id', o.id_opcion, 'texto', o.texto) ORDER BY o.id_opcion) AS opciones
       FROM retos r
       INNER JOIN reto_preguntas rp ON rp.id_reto = r.id_reto
       INNER JOIN preguntas p ON p.id_pregunta = rp.id_pregunta
       INNER JOIN opciones o ON o.id_pregunta = p.id_pregunta
       LEFT JOIN intentos i ON i.id_reto = r.id_reto AND i.id_estudiante = $2
       LEFT JOIN respuestas_estudiante re ON re.id_intento = i.id_intento AND re.id_pregunta = p.id_pregunta
      WHERE r.id_reto = $1
      GROUP BY r.id_reto, rp.posicion, p.id_pregunta, p.enunciado, p.puntos, re.id_respuesta
      ORDER BY rp.posicion`,
    [challenge.id_reto, request.userId],
  );
  return response.json({
    id: challenge.id_reto,
    titulo: challenge.titulo,
    segundos_por_pregunta: challenge.segundos_por_pregunta,
    da_puntos: challenge.da_puntos,
    fecha_fin: challenge.fecha_fin,
    preguntas: questions,
  });
}

async function answerChallengeQuestion(request, response) {
  const { userId } = request;
  const questionId = parseId(request.params.idPregunta);
  const rawOptionId = request.body?.opcionId;
  const optionId = rawOptionId == null ? null : parseId(rawOptionId);
  const elapsedSeconds = Math.max(Number.parseInt(request.body?.tiempoSegundos, 10) || 0, 0);

  if (!questionId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Pregunta inválida');
  }
  if (rawOptionId != null && !optionId) {
    throw new HttpError(400, 'INVALID_OPTION', 'Opción inválida');
  }

  const result = await withTransaction(async (client) => {
    const challenge = await findOpenChallenge(client, request.params.codigo);
    const { rows: questionRows } = await client.query(
      `SELECT rp.posicion, p.puntos
         FROM reto_preguntas rp
         INNER JOIN preguntas p ON p.id_pregunta = rp.id_pregunta
        WHERE rp.id_reto = $1 AND rp.id_pregunta = $2`,
      [challenge.id_reto, questionId],
    );
    const question = questionRows[0];
    if (!question) {
      throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Pregunta no disponible');
    }

    // Igual que el semanal: se responde en orden.
    const { rows: pendingRows } = await client.query(
      `SELECT MIN(rp.posicion) AS posicion
         FROM reto_preguntas rp
        WHERE rp.id_reto = $1
          AND rp.posicion < $2
          AND NOT EXISTS (
            SELECT 1
              FROM respuestas_estudiante re
              INNER JOIN intentos i ON i.id_intento = re.id_intento
             WHERE i.id_estudiante = $3 AND i.id_reto = rp.id_reto AND re.id_pregunta = rp.id_pregunta
          )`,
      [challenge.id_reto, question.posicion, userId],
    );
    if (pendingRows[0].posicion !== null) {
      throw new HttpError(409, 'QUESTION_LOCKED', `Responde antes la pregunta ${pendingRows[0].posicion}`);
    }

    const { correct, earned, completed } = await saveAnswer(client, {
      userId,
      challengeId: challenge.id_reto,
      day: challenge.dia,
      questionId,
      optionId,
      elapsedSeconds,
      points: challenge.da_puntos ? question.puntos : 0,
      total: challenge.cantidad_preguntas,
      alreadyAnswered: 'Esta pregunta ya fue respondida',
    });
    const streak = await getStreak(client, userId);
    return {
      correcta: correct,
      puntos_ganados: earned,
      puntos_bonus: 0,
      ...(await userProgress(client, userId)),
      racha_actual: streak.racha_actual,
      racha_maxima: streak.racha_maxima,
      reto_completado: completed,
    };
  });
  return response.status(201).json(result);
}

module.exports = {
  CODE_ALPHABET,
  answerChallengeQuestion,
  challengeStats,
  createChallenge,
  generateCode,
  joinChallenge,
  listChallenges,
  parseCode,
  validateNewChallenge,
};
