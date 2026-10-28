const express = require('express');
const { answerChallengeQuestion, joinChallenge } = require('../controllers/custom-challenges.controller');

const router = express.Router();

router.get('/:codigo', joinChallenge);
router.post('/:codigo/preguntas/:idPregunta/responder', answerChallengeQuestion);

module.exports = router;
