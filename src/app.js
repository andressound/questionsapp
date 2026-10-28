const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth.routes');
const customChallengesRoutes = require('./routes/custom-challenges.routes');
const questionsRoutes = require('./routes/questions.routes');
const teacherRoutes = require('./routes/teacher.routes');
const usersRoutes = require('./routes/users.routes');
const { health } = require('./controllers/health.controller');
const { errorHandler, notFound } = require('./middleware/error-handler');
const { requireAuth, requireTeacher } = require('./middleware/auth');

const app = express();

app.disable('x-powered-by');
app.use(cors());
// Las peticiones de la app son JSON pequeños; el límite evita cuerpos abusivos.
app.use(express.json({ limit: '10kb' }));

app.get('/health', health);
app.use('/api/auth', authRoutes);
// Todo salvo registro, login y /health exige una sesión válida.
app.use('/api/preguntas', requireAuth, questionsRoutes);
app.use('/api/usuarios', requireAuth, usersRoutes);
// Retos personalizados: el estudiante entra con el código que le da el profesor.
app.use('/api/retos-personalizados', requireAuth, customChallengesRoutes);
// Banco de preguntas: solo profesores.
app.use('/api/profesor', requireAuth, requireTeacher, teacherRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
