require('./setupEnv');

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { ROLES, ESTADOS_REVISION, ACCIONES_AUDITORIA } = require('../utils/constants');
const { limpiarBaseDeDatos } = require('../scripts/limpiarBaseDeDatos');

let manager;
let directorioRespaldo;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();
  manager = await User.create({
    nombre: 'Jefatura',
    email: 'manager@usac.gt',
    passwordHash: await hashPassword('claveSegura123'),
    rol: ROLES.MANAGER,
  });
  await mongoose.connection.collection('invitations').insertOne({ email: 'nuevo@usac.gt' });

  for (const idInventario of ['1L', '2L', '3L']) {
    const item = await Catalog.create({
      categoria: 'LIBRO',
      idInventario,
      autor: 'Autor',
      titulo: `Titulo ${idInventario}`,
      atributos: { EDITORIAL: 'Ed' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });
    await Audit.create({ accion: ACCIONES_AUDITORIA.CREAR, entidad: 'Catalog', entidadId: item._id, usuario: manager._id });
  }

  directorioRespaldo = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-limpieza-'));
});

afterEach(async () => {
  await clearDatabase();
  fs.rmSync(directorioRespaldo, { recursive: true, force: true });
});

afterAll(async () => {
  await closeDatabase();
});

describe('scripts/limpiarBaseDeDatos', () => {
  test('sin confirmar es una prueba en seco: cuenta lo que hay pero no borra ni escribe nada', async () => {
    const resultado = await limpiarBaseDeDatos({ directorioRespaldo });

    expect(resultado.antes).toMatchObject({ catalogs: 3, audits: 3 });
    expect(resultado.respaldo).toBeNull();
    expect(resultado.borrados).toBeNull();
    expect(await Catalog.countDocuments({})).toBe(3);
    expect(await Audit.countDocuments({})).toBe(3);
    expect(fs.readdirSync(directorioRespaldo)).toHaveLength(0);
  });

  test('con confirmar guarda un respaldo completo y despues borra catalogo y auditoria', async () => {
    const resultado = await limpiarBaseDeDatos({ confirmar: true, directorioRespaldo });

    expect(resultado.borrados).toMatchObject({ catalogs: 3, audits: 3 });
    expect(await Catalog.countDocuments({})).toBe(0);
    expect(await Audit.countDocuments({})).toBe(0);

    const catalogoRespaldado = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'catalogs.json'), 'utf8'));
    expect(catalogoRespaldado.map((r) => r.idInventario).sort()).toEqual(['1L', '2L', '3L']);
    const auditoriaRespaldada = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'audits.json'), 'utf8'));
    expect(auditoriaRespaldada).toHaveLength(3);
  });

  test('conserva usuarios, categorias e invitaciones (sin usuarios nadie podria iniciar sesion)', async () => {
    await limpiarBaseDeDatos({ confirmar: true, directorioRespaldo });

    expect(await User.countDocuments({})).toBe(1);
    expect(await mongoose.connection.collection('categories').countDocuments({})).toBeGreaterThan(0);
    expect(await mongoose.connection.collection('invitations').countDocuments({})).toBe(1);
  });
});
