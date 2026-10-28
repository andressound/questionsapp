const HttpError = require('./http-error');
const { answeredSql, pointsSql } = require('./progress');

// Guarda la respuesta de un usuario a una pregunta de un reto y actualiza su intento.
// `day` es el fecha_dia del intento ('YYYY-MM-DD'): el día, el lunes de la semana o el día
// en que se creó un reto personalizado. Lanza 400 INVALID_OPTION y 409 si ya respondió.
async function saveAnswer(client, { userId, challengeId, day, questionId, optionId, elapsedSeconds, points, total, alreadyAnswered }) {
  // Upsert sin cambios reales para obtener el id del intento en una sola consulta
  // y bloquear la fila igual que un SELECT ... FOR UPDATE.
  const { rows: attemptRows } = await client.query(
    `INSERT INTO intentos (id_estudiante, id_reto, fecha_dia)
     VALUES ($1, $2, $3::date)
     ON CONFLICT (id_estudiante, id_reto, fecha_dia)
     DO UPDATE SET id_estudiante = EXCLUDED.id_estudiante
     RETURNING id_intento`,
    [userId, challengeId, day],
  );
  const attemptId = attemptRows[0].id_intento;

  let correct = false;
  if (optionId !== null) {
    const { rows: optionRows } = await client.query(
      'SELECT es_correcta FROM opciones WHERE id_opcion = $1 AND id_pregunta = $2',
      [optionId, questionId],
    );
    if (!optionRows[0]) {
      throw new HttpError(400, 'INVALID_OPTION', 'Opción inválida');
    }
    correct = optionRows[0].es_correcta;
  }

  const { rowCount } = await client.query(
    `INSERT INTO respuestas_estudiante
      (id_intento, id_pregunta, id_opcion_seleccionada, tiempo_segundos, es_correcta)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id_intento, id_pregunta) DO NOTHING`,
    [attemptId, questionId, optionId, elapsedSeconds, correct],
  );
  if (rowCount === 0) {
    throw new HttpError(409, 'QUESTION_ALREADY_ANSWERED', alreadyAnswered);
  }

  const earned = correct ? points : 0;
  const { rows: attemptState } = await client.query(
    `UPDATE intentos i
        SET puntaje_total = i.puntaje_total + $1,
            estado = CASE WHEN answered.total >= $2 THEN 'COMPLETADO'::estado_intento
                          ELSE 'EN_PROCESO'::estado_intento END,
            fecha_fin = CASE WHEN answered.total >= $2 THEN CURRENT_TIMESTAMP ELSE i.fecha_fin END
       FROM (SELECT COUNT(*) AS total FROM respuestas_estudiante WHERE id_intento = $3) AS answered
      WHERE i.id_intento = $3
      RETURNING i.estado`,
    [earned, total, attemptId],
  );
  return { attemptId, correct, earned, completed: attemptState[0].estado === 'COMPLETADO' };
}

// Puntos totales y retos respondidos del usuario tras responder.
async function userProgress(client, userId) {
  const { rows } = await client.query(
    `SELECT ${pointsSql('$1::int')} AS puntos_totales, ${answeredSql('$1::int')} AS retos_completados`,
    [userId],
  );
  return {
    puntos_totales: Number(rows[0].puntos_totales),
    retos_completados: Number(rows[0].retos_completados),
  };
}

module.exports = { saveAnswer, userProgress };
