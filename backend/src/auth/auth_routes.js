const express = require('express');
const { login, checkInvitation, registerFromInvitation } = require('./auth_controller');

const router = express.Router();

router.post('/login', login);
router.get('/invitations/:token', checkInvitation);
router.post('/register-invitation', registerFromInvitation);

module.exports = router;
