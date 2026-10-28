const express = require('express');
const { createQuestion, listQuestions } = require('../controllers/teacher.controller');
const { challengeStats, createChallenge, listChallenges } = require('../controllers/custom-challenges.controller');

const router = express.Router();

router.get('/preguntas', listQuestions);
router.post('/preguntas', createQuestion);
router.get('/retos', listChallenges);
router.post('/retos', createChallenge);
router.get('/retos/:id/estadisticas', challengeStats);

module.exports = router;
