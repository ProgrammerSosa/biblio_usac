require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const { registrarAuditoria } = require('../src/audit/audit_service');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ACCIONES_AUDITORIA } = require('../utils/constants');
const mongoose = require('mongoose');

let manager;
let admin;
let auxiliar;
let managerToken;
let adminToken;
let auxiliarToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  const passwordHash = await hashPassword('claveSegura123');

  manager = await User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER });
  admin = await User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN });
  auxiliar = await User.create({ nombre: 'Auxiliar', email: 'auxiliar@usac.gt', passwordHash, rol: ROLES.USER });

  managerToken = generateJWT(manager);
  adminToken = generateJWT(admin);
  auxiliarToken = generateJWT(auxiliar);

  const entidadId = new mongoose.Types.ObjectId();
  await registrarAuditoria({ accion: ACCIONES_AUDITORIA.CREAR, entidad: 'Catalog', entidadId, usuario: auxiliar._id });
  await registrarAuditoria({ accion: ACCIONES_AUDITORIA.APROBAR, entidad: 'Catalog', entidadId, usuario: admin._id });
  await registrarAuditoria({ accion: ACCIONES_AUDITORIA.INVITAR, entidad: 'Invitation', entidadId, usuario: manager._id });
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('Visibilidad de auditoria por rol', () => {
  test('Admin solo ve las acciones realizadas por Auxiliares', async () => {
    const res = await api(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.registros[0].accion).toBe(ACCIONES_AUDITORIA.CREAR);
    expect(res.body.data.registros[0].usuario.rol).toBe(ROLES.USER);
  });

  test('Manager ve las acciones de Auxiliares, Admin y de si misma', async () => {
    const res = await api(app).get('/api/audit').set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
  });

  test('Admin no puede filtrar por un usuario fuera de su alcance (otro Admin o Manager)', async () => {
    const res = await api(app)
      .get(`/api/audit?usuario=${manager._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  test('GET /api/audit/usuarios: Admin solo ve Auxiliares', async () => {
    const res = await api(app).get('/api/audit/usuarios').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].rol).toBe(ROLES.USER);
  });

  test('GET /api/audit/usuarios: Manager ve a todo el personal', async () => {
    const res = await api(app).get('/api/audit/usuarios').set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  test('Auxiliar tambien puede entrar, pero solo ve sus propias acciones', async () => {
    const res = await api(app).get('/api/audit').set('Authorization', `Bearer ${auxiliarToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.registros[0].accion).toBe(ACCIONES_AUDITORIA.CREAR);
    expect(res.body.data.registros[0].usuario.rol).toBe(ROLES.USER);
  });

  test('Auxiliar no puede ver la auditoria de alguien mas aunque lo pida por la URL', async () => {
    const res = await api(app)
      .get(`/api/audit?usuario=${admin._id}`)
      .set('Authorization', `Bearer ${auxiliarToken}`);

    expect(res.status).toBe(200);
    // Se ignora el ?usuario= ajeno: sigue viendo solo lo suyo (1), no lo del Admin.
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.registros[0].usuario.rol).toBe(ROLES.USER);
  });

  test('GET /api/audit/usuarios: Auxiliar no recibe la lista de personal', async () => {
    const res = await api(app).get('/api/audit/usuarios').set('Authorization', `Bearer ${auxiliarToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
