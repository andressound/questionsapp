const { bonusPointsSql } = require('./streak');

// Puntos y retos respondidos de un usuario, calculados desde sus respuestas.


function scoredAnswersSql(userColumn, select) {
  return `(SELECT ${select}
             FROM respuestas_estudiante re
             INNER JOIN intentos ri ON ri.id_intento = re.id_intento
             INNER JOIN retos rr ON rr.id_reto = ri.id_reto AND rr.da_puntos
             INNER JOIN preguntas p ON p.id_pregunta = re.id_pregunta
            WHERE ri.id_estudiante = ${userColumn})`;
}

function pointsSql(userColumn) {
  return `${scoredAnswersSql(userColumn, 'COALESCE(SUM(CASE WHEN re.es_correcta THEN p.puntos ELSE 0 END), 0)')}
              + ${bonusPointsSql(userColumn)}`;
}

function answeredSql(userColumn) {
  return scoredAnswersSql(userColumn, 'COUNT(*)');
}

module.exports = { answeredSql, pointsSql };
