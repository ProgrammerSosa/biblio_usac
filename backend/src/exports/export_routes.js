const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const { exportCatalogPdf } = require('./export_controller');

const router = express.Router();

router.get('/catalog', verifyJWT, checkRole(ROLES.ADMIN, ROLES.MANAGER), exportCatalogPdf);

module.exports = router;
