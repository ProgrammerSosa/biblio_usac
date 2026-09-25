const express = require('express');
const multer = require('multer');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const { exportarRespaldo, restaurarRespaldo } = require('./backup_controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const nombre = file.originalname.toLowerCase();
    if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('El archivo debe ser un Excel (.xlsx o .xls)'));
    }
  },
});

// Respaldo manual: solo la Manager puede generarlo o restaurarlo - es la unica accion que
// puede sobrescribir datos existentes de todo el sistema de una sola vez.
router.use(verifyJWT, checkRole(ROLES.MANAGER));

router.get('/exportar', exportarRespaldo);
router.post('/restaurar', upload.single('archivo'), restaurarRespaldo);

module.exports = router;
