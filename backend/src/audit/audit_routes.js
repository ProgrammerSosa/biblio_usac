const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const { listAudit, listUsuariosFiltrables } = require('./audit_controller');

const router = express.Router();

router.use(verifyJWT, checkRole(ROLES.ADMIN, ROLES.MANAGER));

router.get('/', listAudit);
router.get('/usuarios', listUsuariosFiltrables);

module.exports = router;
