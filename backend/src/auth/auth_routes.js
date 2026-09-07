const express = require('express');
const { login, registerFromInvitation } = require('./auth_controller');

const router = express.Router();

router.post('/login', login);
router.post('/register-invitation', registerFromInvitation);

module.exports = router;
