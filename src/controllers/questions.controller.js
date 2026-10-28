const { withTransaction } = require('../config/database');
const HttpError = require('../utils/http-error');
const { saveAnswer, userProgress } = require('../utils/answers');
const { getStreak, streakBonus } = require('../utils/streak');

// Cada reto periódico guarda su conjunto de preguntas por periodo (día o semana).
// Los nombres de tablas y columnas son constantes de este archivo, nunca entrada del usuario,
// por eso se pueden interpolar en el SQL.
const CHALLENGES = {
  diario: {
    tipo: 'DIARIO',
    periodTable: 'reto_diario',
    setTable: 'reto_diario_preguntas',
    periodColumn: 'fecha_dia',
    period: 'CURRENT_DATE',
    size: 5,
    alreadyAnswered: 'Esta pregunta ya fue realizada hoy',
  },
  semanal: {
    tipo: 'SEMANAL',
    periodTable: 'reto_semanal',
    setTable: 'reto_semanal_preguntas',
    periodColumn: 'semana',
    // Lunes de la semana actual; también es el fecha_dia de los intentos semanales.
    period: "date_trunc('week', CURRENT_DATE)::date",
    size: 10,
    alreadyAnswered: 'Esta pregunta ya fue realizada esta semana',
  },
};

function parseId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function listQuestions(config) {
  const { setTable, periodColumn, period } = config;
  return async (request, response) => {
    const { userId } = request;
    const rows = await withTransaction(async (client) => {
      await ensureQuestionSet(client, config);
      const result = await client.query(`
        SELECT r.id_reto AS reto_id,
               ds.posicion,
               p.id_pregunta AS id,
               'opcion_multiple' AS tipo,
               p.enunciado,
               p.puntos,
               (re.id_respuesta IS NOT NULL) AS realizada,
               -- Sin es_correcta: el cliente solo conoce el resultado al responder (POST /responder).
               json_agg(json_build_object(
                 'id', o.id_opcion,
                 'texto', o.texto
               ) ORDER BY o.id_opcion) AS opciones
        FROM ${setTable} ds
        INNER JOIN retos r ON r.id_reto = ds.id_reto
        INNER JOIN preguntas p ON p.id_pregunta = ds.id_pregunta
        INNER JOIN opciones o ON o.id_pregunta = p.id_pregunta
        LEFT JOIN intentos i ON i.id_reto = r.id_reto
                             AND i.id_estudiante = $1
                             AND i.fecha_dia = ${period}
        LEFT JOIN respuestas_estudiante re ON re.id_intento = i.id_intento
                                           AND re.id_pregunta = p.id_pregunta
        WHERE ds.${periodColumn} = ${period}
          AND p.activa = TRUE
        GROUP BY r.id_reto, ds.posicion, p.id_pregunta, p.enunciado, p.puntos, re.id_respuesta
        ORDER BY ds.posicion
      `, [userId]);
      return result.rows;
    });
    return response.json(rows);
  };
}

async function ensureQuestionSet(client, { tipo, periodTable, setTable, periodColumn, period, size }) {
  const { rows: challengeRows } = await client.query(
    `SELECT id_reto
       FROM retos
      WHERE tipo = $1 AND estado = 'ACTIVO'
      ORDER BY id_reto DESC
      LIMIT 1
      FOR UPDATE`,
    [tipo],
  );
  const challenge = challengeRows[0];
  if (!challenge) {
    throw new Error(`No hay un reto ${tipo.toLowerCase()} activo`);
  }

  await client.query(
    `INSERT INTO ${periodTable} (${periodColumn}, id_reto)
     VALUES (${period}, $1)
     ON CONFLICT (${periodColumn}) DO NOTHING`,
    [challenge.id_reto],
  );
  const { rows: periodRows } = await client.query(
    `SELECT id_reto FROM ${periodTable} WHERE ${periodColumn} = ${period} FOR UPDATE`,
  );
  const periodChallengeId = periodRows[0].id_reto;
  // Inserta el conjunto del periodo solo si aún no existe (una sola ida a la base).
  await client.query(
    `INSERT INTO ${setTable} (${periodColumn}, id_reto, id_pregunta, posicion)
     SELECT ${period}, selected.id_reto, selected.id_pregunta,
            ROW_NUMBER() OVER (ORDER BY selected.id_pregunta)
       FROM (
         SELECT rp.id_reto, p.id_pregunta
           FROM preguntas p
          INNER JOIN reto_preguntas rp ON rp.id_pregunta = p.id_pregunta
                                      AND rp.id_reto = $1
          WHERE p.activa = TRUE
          ORDER BY random()
          LIMIT $2
       ) AS selected
      WHERE NOT EXISTS (
        SELECT 1 FROM ${setTable} WHERE ${periodColumn} = ${period}
      )`,
    [periodChallengeId, size],
  );
}

function answerQuestion(config) {
  const { tipo, setTable, periodColumn, period, alreadyAnswered } = config;
  return async (request, response) => {
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
      await ensureQuestionSet(client, config);
      const { rows: questionRows } = await client.query(
        `SELECT r.id_reto, r.cantidad_preguntas, p.puntos, ds.posicion, (${period})::text AS dia
           FROM retos r
           INNER JOIN ${setTable} ds ON ds.id_reto = r.id_reto
                                    AND ds.${periodColumn} = ${period}
           INNER JOIN preguntas p ON p.id_pregunta = ds.id_pregunta
          WHERE r.tipo = $2 AND r.estado = 'ACTIVO'
            AND p.id_pregunta = $1
          LIMIT 1`,
        [questionId, tipo],
      );
      const question = questionRows[0];
      if (!question) {
        throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Pregunta no disponible');
      }

      // Los retos se juegan en orden: no se puede responder uno con anteriores pendientes.
      const { rows: pendingRows } = await client.query(
        `SELECT MIN(ds.posicion) AS posicion
           FROM ${setTable} ds
           INNER JOIN preguntas p ON p.id_pregunta = ds.id_pregunta AND p.activa = TRUE
          WHERE ds.${periodColumn} = ${period}
            AND ds.posicion < $1
            AND NOT EXISTS (
              SELECT 1
                FROM respuestas_estudiante re
                INNER JOIN intentos i ON i.id_intento = re.id_intento
               WHERE i.id_estudiante = $2
                 AND i.id_reto = ds.id_reto
                 AND i.fecha_dia = ${period}
                 AND re.id_pregunta = ds.id_pregunta
            )`,
        [question.posicion, userId],
      );
      if (pendingRows[0].posicion !== null) {
        throw new HttpError(409, 'QUESTION_LOCKED', `Responde antes el reto ${pendingRows[0].posicion}`);
      }

      const { attemptId, correct, earned, completed } = await saveAnswer(client, {
        userId,
        challengeId: question.id_reto,
        day: question.dia,
        questionId,
        optionId,
        elapsedSeconds,
        points: question.puntos,
        total: question.cantidad_preguntas,
        alreadyAnswered,
      });

      // Completar el reto diario suma un día a la racha y fija su bonus en el intento.
      // Solo pasa una vez por día: las respuestas siguientes chocan con QUESTION_ALREADY_ANSWERED.
      let streak = null;
      let bonus = 0;
      if (tipo === 'DIARIO' && completed) {
        streak = await getStreak(client, userId);
        bonus = streakBonus(streak.racha_actual);
        await client.query('UPDATE intentos SET puntos_bonus = $1 WHERE id_intento = $2', [bonus, attemptId]);
      }

      const progress = await userProgress(client, userId);
      streak ??= await getStreak(client, userId);
      return {
        correcta: correct,
        puntos_ganados: earned,
        puntos_bonus: bonus,
        ...progress,
        racha_actual: streak.racha_actual,
        racha_maxima: streak.racha_maxima,
        reto_completado: completed,
      };
    });
    return response.status(201).json(result);
  };
}

module.exports = {
  dailyQuestions: listQuestions(CHALLENGES.diario),
  answerDailyQuestion: answerQuestion(CHALLENGES.diario),
  weeklyQuestions: listQuestions(CHALLENGES.semanal),
  answerWeeklyQuestion: answerQuestion(CHALLENGES.semanal),
};
