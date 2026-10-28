// La racha son los días seguidos con el reto diario completado. No se guarda:
// se calcula desde `intentos`, igual que los puntos.
const MAX_STREAK_BONUS = 10;

// Puntos extra al completar el reto diario: uno por día de racha, con tope.
function streakBonus(days) {
  return Math.min(days, MAX_STREAK_BONUS);
}

// Racha actual y máxima del usuario. `db` puede ser el pool o el cliente de una transacción.
// Los días seguidos comparten `fecha_dia - n.º de fila`, así cada grupo es una racha.
// La actual sigue viva si su último día es hoy o ayer (hoy aún puede completarse).
async function getStreak(db, userId) {
  const { rows } = await db.query(
    `WITH dias AS (
       SELECT DISTINCT i.fecha_dia
         FROM intentos i
         INNER JOIN retos r ON r.id_reto = i.id_reto AND r.tipo = 'DIARIO'
        WHERE i.id_estudiante = $1 AND i.estado = 'COMPLETADO'
     ), rachas AS (
       SELECT COUNT(*) AS dias, MAX(fecha_dia) AS ultimo
         FROM (SELECT fecha_dia,
                      fecha_dia - (ROW_NUMBER() OVER (ORDER BY fecha_dia))::int AS grupo
                 FROM dias) AS d
        GROUP BY grupo
     )
     SELECT COALESCE(MAX(dias) FILTER (WHERE ultimo >= CURRENT_DATE - 1), 0) AS racha_actual,
            COALESCE(MAX(dias), 0) AS racha_maxima
       FROM rachas`,
    [userId],
  );
  return {
    racha_actual: Number(rows[0].racha_actual),
    racha_maxima: Number(rows[0].racha_maxima),
  };
}

// Bonus de racha de todos los intentos del usuario, para sumarlo a sus puntos.
// `userColumn` es una columna fija del SQL que lo usa, nunca entrada del usuario.
function bonusPointsSql(userColumn) {
  return `COALESCE((SELECT SUM(bi.puntos_bonus) FROM intentos bi WHERE bi.id_estudiante = ${userColumn}), 0)`;
}

module.exports = { MAX_STREAK_BONUS, bonusPointsSql, getStreak, streakBonus };
