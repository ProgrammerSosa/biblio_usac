const express = require('express');
const multer = require('multer');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const {
  createItem,
  listItems,
  getItem,
  updateOwnItem,
  revisarMaterial,
  aprobarLote,
  rechazarLote,
  enviarLote,
  previsualizarImportacion,
  confirmarImportacion,
  deleteItem,
  darDeBaja,
} = require('./catalog_controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const nombre = file.originalname.toLowerCase();
    if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('El archivo debe ser un Excel (.xlsx o .xls)'));
    }
  },
});

router.use(verifyJWT);

router.get('/', listItems);
router.post('/', createItem);
router.patch('/aprobar-lote', checkRole(ROLES.ADMIN, ROLES.MANAGER), aprobarLote);
router.patch('/rechazar-lote', checkRole(ROLES.ADMIN, ROLES.MANAGER), rechazarLote);
router.patch('/enviar-lote', enviarLote);
router.post('/importar', upload.single('archivo'), previsualizarImportacion);
router.post('/importar/confirmar', confirmarImportacion);
router.get('/:id', getItem);
router.patch('/:id', updateOwnItem);
router.patch('/:id/revisar', checkRole(ROLES.ADMIN, ROLES.MANAGER), revisarMaterial);
router.patch('/:id/dar-de-baja', checkRole(ROLES.ADMIN, ROLES.MANAGER), darDeBaja);
router.delete('/:id', checkRole(ROLES.MANAGER), deleteItem);

module.exports = router;
