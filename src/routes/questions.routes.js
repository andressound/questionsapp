const express = require('express');
const {
  answerDailyQuestion,
  answerWeeklyQuestion,
  dailyQuestions,
  weeklyQuestions,
} = require('../controllers/questions.controller');

const router = express.Router();

router.get('/diarias', dailyQuestions);
router.post('/diarias/:idPregunta/responder', answerDailyQuestion);
router.get('/semanales', weeklyQuestions);
router.post('/semanales/:idPregunta/responder', answerWeeklyQuestion);

module.exports = router;
