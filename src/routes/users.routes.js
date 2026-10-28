const express = require('express');
const { myRanking, ranking, updateProfile } = require('../controllers/users.controller');

const router = express.Router();

router.get('/ranking', ranking);
router.get('/ranking/me', myRanking);
router.patch('/:id', updateProfile);

module.exports = router;
