const express = require('express');
const { verifyJWT } = require('../../middlewares/auth');
const { exportCatalogPdf } = require('./export_controller');

const router = express.Router();

// Cualquier rol autenticado puede exportar - lo que ve y busca en el catalogo es lo mismo
// que puede exportar a PDF, sin distincion de rol (la visibilidad de borradores privados la
// sigue filtrando exportCatalogPdf, igual que en el listado).
router.get('/catalog', verifyJWT, exportCatalogPdf);

module.exports = router;
