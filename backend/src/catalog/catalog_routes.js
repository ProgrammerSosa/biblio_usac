const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const {
  createItem,
  listItems,
  getItem,
  updateOwnItem,
  reviewByAdmin,
  approveByManager,
  deleteItem,
} = require('./catalog_controller');

const router = express.Router();

router.use(verifyJWT);

router.get('/', listItems);
router.post('/', createItem);
router.get('/:id', getItem);
router.patch('/:id', updateOwnItem);
router.patch('/:id/revisar', checkRole(ROLES.ADMIN), reviewByAdmin);
router.patch('/:id/aprobar', checkRole(ROLES.MANAGER), approveByManager);
router.delete('/:id', checkRole(ROLES.MANAGER), deleteItem);

module.exports = router;
