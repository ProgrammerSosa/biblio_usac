require('dotenv').config();

const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');
const { startKeepAlive } = require('./helpers/keepAlive');

const authRoutes = require('./src/auth/auth_routes');
const userRoutes = require('./src/users/user_routes');
const teamRoutes = require('./src/users/team_routes');
const catalogRoutes = require('./src/catalog/catalog_routes');
const categoryRoutes = require('./src/catalog/category_routes');
const auditRoutes = require('./src/audit/audit_routes');
const exportRoutes = require('./src/exports/export_routes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ success: true, data: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/exports', exportRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada' });
});

app.use(errorHandler);

async function start() {
  await connectDB();
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
    startKeepAlive();
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('No se pudo iniciar el servidor:', err.message);
    process.exit(1);
  });
}

module.exports = app;
