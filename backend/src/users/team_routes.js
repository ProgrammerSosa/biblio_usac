const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const { listEstadisticasEquipo, getPerfilUsuario } = require('./team_controller');

const router = express.Router();

router.use(verifyJWT);

router.get('/', checkRole(ROLES.ADMIN, ROLES.MANAGER), listEstadisticasEquipo);
router.get('/:id/perfil', getPerfilUsuario);

module.exports = router;
