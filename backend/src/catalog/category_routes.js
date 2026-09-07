const express = require('express');
const { verifyJWT, checkRole } = require('../../middlewares/auth');
const { ROLES } = require('../../utils/constants');
const {
  listCategories,
  createCategory,
  updateCategory,
  setCategoryStatus,
  countCategoryUsage,
} = require('./category_controller');

const router = express.Router();

router.use(verifyJWT);

router.get('/', listCategories);
router.post('/', checkRole(ROLES.MANAGER), createCategory);
router.patch('/:id', checkRole(ROLES.MANAGER), updateCategory);
router.patch('/:id/estado', checkRole(ROLES.MANAGER), setCategoryStatus);
router.get('/:id/uso', checkRole(ROLES.MANAGER), countCategoryUsage);

module.exports = router;
