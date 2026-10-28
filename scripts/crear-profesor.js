// Crea una cuenta de profesor (el registro de la app solo crea estudiantes).
// Uso: npm run crear-profesor -- <usuario> <correo> <contraseña>
// Si el usuario o el correo ya existen, esa cuenta pasa a profesor con la contraseña indicada.
const { pool } = require('../src/config/database');
const { hashPassword, normalizeEmail, validCredentials, validEmail } = require('../src/utils/auth');

async function main() {
  const [rawUsername, rawEmail, password] = process.argv.slice(2);
  const username = normalizeEmail(rawUsername);
  const email = normalizeEmail(rawEmail);
  if (!validEmail(email) || !validCredentials(username, password)) {
    console.error('Uso: npm run crear-profesor -- <usuario> <correo> <contraseña de 8 o más caracteres>');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `UPDATE usuarios SET role = 'PROFESOR', password_hash = $3
      WHERE username = $1 OR email = $2
      RETURNING id_usuario`,
    [username, email, passwordHash],
  );
  if (rows.length > 1) {
    console.error('El usuario y el correo pertenecen a cuentas distintas');
    process.exitCode = 1;
    return;
  }
  if (rows[0]) {
    console.log(`Cuenta ${rows[0].id_usuario} actualizada como profesor`);
    return;
  }
  const { rows: inserted } = await pool.query(
    `INSERT INTO usuarios (username, email, password_hash, role)
     VALUES ($1, $2, $3, 'PROFESOR')
     RETURNING id_usuario`,
    [username, email, passwordHash],
  );
  console.log(`Profesor ${username} creado con id ${inserted[0].id_usuario}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
