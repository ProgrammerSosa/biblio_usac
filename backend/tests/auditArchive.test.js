require('./setupEnv');

const mongoose = require('mongoose');
const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Audit = require('../src/audit/audit_model');
const AuditArchive = require('../src/audit/auditArchive_model');
const { archivarAuditoriaVieja, DIAS_ANTES_DE_ARCHIVAR } = require('../helpers/archiveAudit');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ACCIONES_AUDITORIA } = require('../utils/constants');

const HACE_40_DIAS = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
const HACE_5_DIAS = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

let manager;
let admin;
let managerToken;
let adminToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  const passwordHash = await hashPassword('claveSegura123');
  manager = await User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER });
  admin = await User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN });
  managerToken = generateJWT(manager);
  adminToken = generateJWT(admin);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('archivarAuditoriaVieja', () => {
  test(`mueve a AuditArchive lo de mas de ${DIAS_ANTES_DE_ARCHIVAR} dias y deja intacto lo reciente`, async () => {
    const entidadId = new mongoose.Types.ObjectId();
    await Audit.create({ accion: ACCIONES_AUDITORIA.CREAR, entidad: 'Catalog', entidadId, usuario: manager._id, fecha: HACE_40_DIAS });
    await Audit.create({ accion: ACCIONES_AUDITORIA.APROBAR, entidad: 'Catalog', entidadId, usuario: manager._id, fecha: HACE_5_DIAS });

    const archivados = await archivarAuditoriaVieja();

    expect(archivados).toBe(1);
    expect(await Audit.countDocuments()).toBe(1);
    expect(await AuditArchive.countDocuments()).toBe(1);

    const enAudit = await Audit.findOne();
    expect(enAudit.accion).toBe(ACCIONES_AUDITORIA.APROBAR);

    const enArchivo = await AuditArchive.findOne();
    expect(enArchivo.accion).toBe(ACCIONES_AUDITORIA.CREAR);
  });

  test('no hace nada si no hay registros viejos', async () => {
    await Audit.create({
      accion: ACCIONES_AUDITORIA.CREAR,
      entidad: 'Catalog',
      entidadId: new mongoose.Types.ObjectId(),
      usuario: manager._id,
      fecha: HACE_5_DIAS,
    });

    const archivados = await archivarAuditoriaVieja();

    expect(archivados).toBe(0);
    expect(await Audit.countDocuments()).toBe(1);
    expect(await AuditArchive.countDocuments()).toBe(0);
  });
});

describe('GET /api/audit?origen=archivo', () => {
  test('sin "origen" solo devuelve lo reciente; con origen=archivo solo lo archivado', async () => {
    const entidadId = new mongoose.Types.ObjectId();
    await Audit.create({ accion: ACCIONES_AUDITORIA.CREAR, entidad: 'Catalog', entidadId, usuario: manager._id, fecha: HACE_40_DIAS });
    await Audit.create({ accion: ACCIONES_AUDITORIA.APROBAR, entidad: 'Catalog', entidadId, usuario: manager._id, fecha: HACE_5_DIAS });
    await archivarAuditoriaVieja();

    const recientes = await api(app).get('/api/audit').set('Authorization', `Bearer ${managerToken}`);
    expect(recientes.status).toBe(200);
    expect(recientes.body.data.total).toBe(1);
    expect(recientes.body.data.registros[0].accion).toBe(ACCIONES_AUDITORIA.APROBAR);

    const archivo = await api(app).get('/api/audit?origen=archivo').set('Authorization', `Bearer ${managerToken}`);
    expect(archivo.status).toBe(200);
    expect(archivo.body.data.total).toBe(1);
    expect(archivo.body.data.registros[0].accion).toBe(ACCIONES_AUDITORIA.CREAR);
  });

  test('las reglas de visibilidad por rol tambien aplican al archivo', async () => {
    const auxiliar = await User.create({
      nombre: 'Auxiliar',
      email: 'auxiliar@usac.gt',
      passwordHash: await hashPassword('claveSegura123'),
      rol: ROLES.USER,
    });
    const entidadId = new mongoose.Types.ObjectId();
    await Audit.create({ accion: ACCIONES_AUDITORIA.CREAR, entidad: 'Catalog', entidadId, usuario: auxiliar._id, fecha: HACE_40_DIAS });
    await Audit.create({ accion: ACCIONES_AUDITORIA.INVITAR, entidad: 'Invitation', entidadId, usuario: manager._id, fecha: HACE_40_DIAS });
    await archivarAuditoriaVieja();

    const comoAdmin = await api(app).get('/api/audit?origen=archivo').set('Authorization', `Bearer ${adminToken}`);
    expect(comoAdmin.status).toBe(200);
    expect(comoAdmin.body.data.total).toBe(1);
    expect(comoAdmin.body.data.registros[0].usuario.rol).toBe(ROLES.USER);

    const comoManager = await api(app).get('/api/audit?origen=archivo').set('Authorization', `Bearer ${managerToken}`);
    expect(comoManager.status).toBe(200);
    expect(comoManager.body.data.total).toBe(2);
  });
});
