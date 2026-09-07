const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const { createInvitation, listInvitations, listUsers, setUserStatus } = require('./user_controller');

const router = express.Router();

router.use(verifyJWT, checkRole(ROLES.MANAGER));

router.get('/', listUsers);
router.post('/invitations', createInvitation);
router.get('/invitations', listInvitations);
router.patch('/:id/estado', setUserStatus);

module.exports = router;
