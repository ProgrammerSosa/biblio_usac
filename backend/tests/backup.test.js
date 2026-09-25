require('./setupEnv');

const ExcelJS = require('exceljs');
const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const Category = require('../src/catalog/category_model');
const Counter = require('../src/catalog/counter_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ESTADOS_REVISION } = require('../utils/constants');
const { CONTADOR_ID } = require('../helpers/idInventario');

let manager;
let admin;
let user;
let managerToken;
let adminToken;
let userToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();
  const passwordHash = await hashPassword('claveSegura123');
  [manager, admin, user] = await Promise.all([
    User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER }),
    User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN }),
    User.create({ nombre: 'Auxiliar', email: 'user@usac.gt', passwordHash, rol: ROLES.USER, allowedCategories: ['LIBRO'] }),
  ]);
  managerToken = generateJWT(manager);
  adminToken = generateJWT(admin);
  userToken = generateJWT(user);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function descargarRespaldo(token) {
  return api(app)
    .get('/api/backup/exportar')
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

describe('GET /api/backup/exportar', () => {
  test('solo la Manager puede exportar el respaldo', async () => {
    const comoAdmin = await descargarRespaldo(adminToken);
    expect(comoAdmin.status).toBe(403);

    const comoUser = await descargarRespaldo(userToken);
    expect(comoUser.status).toBe(403);

    const comoManager = await descargarRespaldo(managerToken);
    expect(comoManager.status).toBe(200);
    expect(comoManager.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(comoManager.body.length).toBeGreaterThan(0);
  });

  test('el Excel de respaldo trae las hojas Categorias y Catalogo con los datos reales', async () => {
    await Catalog.create({
      categoria: 'LIBRO',
      idInventario: 10001,
      autor: 'Autor De Respaldo',
      titulo: 'Libro De Respaldo',
      atributos: { EDITORIAL: 'Editorial X', ISBN: '978-1', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });

    const res = await descargarRespaldo(managerToken);
    expect(res.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const hojaCategorias = workbook.getWorksheet('Categorias');
    // El catalogo va en una hoja POR CATEGORIA (nombre de hoja = clave), no una sola hoja
    // "Catalogo" generica.
    const hojaLibro = workbook.getWorksheet('LIBRO');
    expect(hojaCategorias).toBeDefined();
    expect(hojaLibro).toBeDefined();

    // 1 encabezado + al menos las categorias sembradas (LIBRO, FOLLETO, etc.)
    expect(hojaCategorias.rowCount).toBeGreaterThan(1);
    // 1 encabezado + el libro que se creo arriba
    expect(hojaLibro.rowCount).toBe(2);

    const encabezados = hojaLibro.getRow(1).values;
    expect(encabezados).toContain('Editorial');
    expect(encabezados).toContain('ISBN');
    expect(encabezados).toContain('Tipo de documento');

    const filaLibro = hojaLibro.getRow(2);
    const valores = filaLibro.values;
    expect(valores).toContain('Libro De Respaldo');
    expect(valores).toContain('Autor De Respaldo');
    expect(valores).toContain('Editorial X');
  });
});

describe('POST /api/backup/restaurar', () => {
  test('solo la Manager puede restaurar', async () => {
    const res = await api(app)
      .post('/api/backup/restaurar')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('archivo', Buffer.from('lo que sea'), 'respaldo.xlsx');

    expect(res.status).toBe(403);
  });

  test('responde 400 si no se sube ningun archivo', async () => {
    const res = await api(app).post('/api/backup/restaurar').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(400);
  });

  test('rechaza un archivo que no sea Excel', async () => {
    const res = await api(app)
      .post('/api/backup/restaurar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', Buffer.from('no es un excel'), 'respaldo.txt');

    expect(res.status).toBe(400);
  });

  test('exportar y luego restaurar el mismo respaldo reproduce exactamente el catalogo (ida y vuelta)', async () => {
    const original = await Catalog.create({
      categoria: 'LIBRO',
      idInventario: 10005,
      autor: 'Autor Ida Y Vuelta',
      titulo: 'Libro Ida Y Vuelta',
      idioma: 'Español',
      anio: '2021',
      edicion: '2da',
      lugar: 'Guatemala',
      paginasImpresas: 150,
      estadoFisico: 'Buen estado',
      atributos: { EDITORIAL: 'Editorial Z', ISBN: '978-9', TIPO_DE_DOCUMENTO: 'Fisico' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      observaciones: '',
      enviado: true,
      registradoPor: manager._id,
      revisadoPorAdmin: admin._id,
    });

    const respaldo = await descargarRespaldo(managerToken);
    expect(respaldo.status).toBe(200);

    // Simula "algo paso": se borra el registro de verdad.
    await Catalog.deleteOne({ _id: original._id });
    expect(await Catalog.exists({ _id: original._id })).toBeNull();

    const restaurar = await api(app)
      .post('/api/backup/restaurar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', respaldo.body, 'respaldo.xlsx');

    expect(restaurar.status).toBe(200);
    expect(restaurar.body.data.errores).toHaveLength(0);
    expect(restaurar.body.data.catalogoCreados).toBeGreaterThanOrEqual(1);

    const restaurado = await Catalog.findById(original._id);
    expect(restaurado).not.toBeNull();
    expect(restaurado.titulo).toBe('Libro Ida Y Vuelta');
    expect(restaurado.autor).toBe('Autor Ida Y Vuelta');
    expect(restaurado.idInventario).toBe(10005);
    expect(restaurado.atributos.EDITORIAL).toBe('Editorial Z');
    expect(restaurado.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);
    expect(String(restaurado.registradoPor)).toBe(String(manager._id));
    expect(String(restaurado.revisadoPorAdmin)).toBe(String(admin._id));
  });

  test('restaurar un ID de inventario mas alto que el contador actual empuja el contador hacia adelante (no choca con la siguiente aprobacion)', async () => {
    const workbook = new ExcelJS.Workbook();
    const hojaCategorias = workbook.addWorksheet('Categorias');
    hojaCategorias.addRow(['clave', 'nombre', 'campos', 'camposComunesDesactivados', 'activo']);
    hojaCategorias.addRow(['LIBRO', 'Libro', '[]', '[]', true]);

    // El catalogo va en una hoja por categoria (nombre de hoja = clave), sin columna
    // "categoria" aparte - asi es como lo genera exportarRespaldo.
    const hojaLibro = workbook.addWorksheet('LIBRO');
    hojaLibro.addRow([
      '_id', 'idInventario', 'autor', 'titulo', 'idioma', 'anio', 'edicion', 'lugar', 'paginasImpresas',
      'estadoFisico', 'estadoRevision', 'observaciones', 'enviado', 'registradoPor', 'registradoPorEmail',
      'origenImportacion', 'revisadoPorAdmin', 'revisadoPorAdminEmail', 'eliminado', 'createdAt', 'updatedAt',
    ]);
    hojaLibro.addRow([
      '', 99999, 'Autor Contador', 'Libro Contador', 'Español', '2020', '1ra', 'Guatemala', 100,
      'Buen estado', 'APROBADO', '', true, String(manager._id), '', '', '', '', false, '', '',
    ]);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/backup/restaurar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'respaldo.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.data.catalogoCreados).toBe(1);

    const contador = await Counter.findById(CONTADOR_ID);
    expect(contador.seq).toBeGreaterThanOrEqual(99999);
  });
});
