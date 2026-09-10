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
  test('cualquier rol autenticado puede exportar (no solo Admin/Manager)', async () => {
    const userToken = await crearUsuarioConToken(ROLES.USER);
    const user = await User.findOne({ rol: ROLES.USER });

    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-USER',
      autor: 'Autor de Prueba',
      titulo: 'Titulo de Prueba',
      atributos: { EDITORIAL: 'Editorial USAC', ISBN: '978-0-00-000000-0', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: 'APROBADO',
      enviado: true,
      registradoPor: user._id,
    });

    const res = await api(app).get('/api/exports/catalog').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
  });

  test('sin registros visibles, responde 404 en vez de la lista vacia de siempre', async () => {
    const userToken = await crearUsuarioConToken(ROLES.USER);
    const res = await api(app).get('/api/exports/catalog').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(404);
  });

  test('un borrador sin enviar de otra persona no se cuela en el PDF de nadie mas (ni Admin/Manager)', async () => {
    const managerToken = await crearUsuarioConToken(ROLES.MANAGER);
    const auxToken = await crearUsuarioConToken(ROLES.USER);
    const auxiliar = await User.findOne({ rol: ROLES.USER });

    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-BORRADOR',
      autor: 'Autor Borrador',
      titulo: 'Titulo Borrador Privado',
      atributos: { EDITORIAL: 'Editorial USAC', ISBN: '999', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: 'PENDIENTE',
      enviado: false,
      registradoPor: auxiliar._id,
    });

    // El Manager exporta "todo" - el borrador ajeno no deberia aparecer, asi que no hay nada
    // que coincida y responde 404, igual que si el catalogo estuviera vacio.
    const comoManager = await api(app).get('/api/exports/catalog').set('Authorization', `Bearer ${managerToken}`);
    expect(comoManager.status).toBe(404);

    // El propio autor si lo puede exportar (su propio borrador, aunque no lo haya enviado).
    const comoAutor = await api(app).get('/api/exports/catalog').set('Authorization', `Bearer ${auxToken}`);
    expect(comoAutor.status).toBe(200);
  });

  test('el filtro registradoPor (checkbox "solo mis registros") tambien aplica al exportar', async () => {
    const managerToken = await crearUsuarioConToken(ROLES.MANAGER);
    const manager = await User.findOne({ rol: ROLES.MANAGER });
    const otro = await User.create({
      nombre: 'Otro Admin',
      email: 'otroadmin@usac.gt',
      passwordHash: await hashPassword('claveSegura123'),
      rol: ROLES.ADMIN,
    });

    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-MIO',
      autor: 'A',
      titulo: 'Mio',
      atributos: { EDITORIAL: 'E', ISBN: '1', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: 'APROBADO',
      enviado: true,
      registradoPor: manager._id,
    });
    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-AJENO',
      autor: 'B',
      titulo: 'Ajeno',
      atributos: { EDITORIAL: 'E', ISBN: '2', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: 'APROBADO',
      enviado: true,
      registradoPor: otro._id,
    });

    const soloMios = await api(app)
      .get(`/api/exports/catalog?registradoPor=${manager._id}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(soloMios.status).toBe(200);

    const soloDelOtro = await api(app)
      .get(`/api/exports/catalog?registradoPor=${manager._id}&buscar=Ajeno`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(soloDelOtro.status).toBe(404);
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
      enviado: true,
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

  test('el filtro "buscar" de la barra de busqueda tambien aplica al exportar', async () => {
    const managerToken = await crearUsuarioConToken(ROLES.MANAGER);
    const manager = await User.findOne({ rol: ROLES.MANAGER });

    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-2',
      autor: 'Autor Distinto',
      titulo: 'Un titulo que no coincide',
      atributos: { EDITORIAL: 'Editorial USAC', ISBN: '000', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: 'APROBADO',
      enviado: true,
      registradoPor: manager._id,
    });
    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'INV-EXP-3',
      autor: 'Autor Buscado',
      titulo: 'Titulo Cualquiera',
      atributos: { EDITORIAL: 'Editorial USAC', ISBN: '111', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: 'APROBADO',
      enviado: true,
      registradoPor: manager._id,
    });

    const conBusqueda = await api(app)
      .get('/api/exports/catalog?buscar=Autor Buscado')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(conBusqueda.status).toBe(200);

    const sinCoincidencia = await api(app)
      .get('/api/exports/catalog?buscar=NoExisteEsteTexto')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(sinCoincidencia.status).toBe(404);
  });
});
