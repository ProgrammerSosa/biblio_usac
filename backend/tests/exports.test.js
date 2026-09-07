require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ACCIONES_AUDITORIA } = require('../utils/constants');

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function crearUsuarioConToken(rol) {
  const passwordHash = await hashPassword('claveSegura123');
  const user = await User.create({
    nombre: `Usuario ${rol}`,
    email: `${rol.toLowerCase()}@usac.gt`,
    passwordHash,
    rol,
    allowedCategories: rol === ROLES.USER ? ['LIBRO'] : [],
  });
  return generateJWT(user);
}

describe('Exportacion de catalogo a PDF', () => {
  test('USER no puede exportar', async () => {
    const userToken = await crearUsuarioConToken(ROLES.USER);
    const res = await api(app).get('/api/exports/catalog').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  test('Manager puede exportar el catalogo aprobado a PDF y queda auditado', async () => {
    const managerToken = await crearUsuarioConToken(ROLES.MANAGER);
    const manager = await User.findOne({ rol: ROLES.MANAGER });

    const item = await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-1',
      autor: 'Autor Prueba',
      titulo: 'Titulo Prueba',
      atributos: {
        EDITORIAL: 'Editorial USAC',
        ISBN: '978-0-00-000000-0',
        TIPO_DE_DOCUMENTO: 'Fisico',
      },
      estadoRevision: 'APROBADO',
      registradoPor: manager._id,
    });

    const res = await api(app)
      .get(`/api/exports/catalog?categoria=LIBRO`)
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);

    const auditoria = await Audit.find({ accion: ACCIONES_AUDITORIA.EXPORTAR, entidadId: item._id });
    expect(auditoria).toHaveLength(1);
  });

  test('responde 404 cuando no hay registros que coincidan con el filtro', async () => {
    const managerToken = await crearUsuarioConToken(ROLES.MANAGER);
    const res = await api(app)
      .get('/api/exports/catalog?categoria=REVISTA')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(404);
  });
});
