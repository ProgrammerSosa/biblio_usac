const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const { listAudit, listUsuariosFiltrables } = require('./audit_controller');

const router = express.Router();

// Un Auxiliar tambien puede entrar, pero solo ve su propia auditoria - listAudit y
// listUsuariosFiltrables se encargan de acotarle el alcance, no esta ruta.
router.use(verifyJWT, checkRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.USER));

router.get('/', listAudit);
router.get('/usuarios', listUsuariosFiltrables);

module.exports = router;
