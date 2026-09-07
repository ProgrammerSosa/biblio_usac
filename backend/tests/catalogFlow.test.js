require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ESTADOS_REVISION, ACCIONES_AUDITORIA } = require('../utils/constants');

let user;
let admin;
let manager;
let userToken;
let adminToken;
let managerToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();

  const passwordHash = await hashPassword('claveSegura123');

  [user, admin, manager] = await Promise.all([
    User.create({
      nombre: 'Auxiliar',
      email: 'user@usac.gt',
      passwordHash,
      rol: ROLES.USER,
      allowedCategories: ['LIBRO'],
    }),
    User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN }),
    User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER }),
  ]);

  userToken = generateJWT(user);
  adminToken = generateJWT(admin);
  managerToken = generateJWT(manager);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

function libroValido(noInventario) {
  return {
    categoria: 'LIBRO',
    noInventario,
    autor: 'Autor de Prueba',
    titulo: 'Titulo de Prueba',
    idioma: 'Espanol',
    anio: '2020',
    edicion: '1ra',
    lugar: 'Guatemala',
    paginasImpresas: 200,
    estadoFisico: 'Buen estado',
    atributos: {
      EDITORIAL: 'Editorial USAC',
      ISBN: '978-0-00-000000-0',
      TIPO_DE_DOCUMENTO: 'Fisico',
    },
  };
}

function revistaValida(noInventario) {
  return {
    categoria: 'REVISTA',
    noInventario,
    autor: 'Autor de Prueba',
    titulo: 'Titulo de Prueba',
    idioma: 'Espanol',
    anio: '2020',
    edicion: '1ra',
    lugar: 'Guatemala',
    paginasImpresas: 200,
    estadoFisico: 'Buen estado',
    atributos: {
      EDITORIAL: 'Editorial USAC',
      ISSN: '1234-5678',
      VOLUMEN: '1',
    },
  };
}

function diccionarioValido(noInventario) {
  return {
    categoria: 'DICCIONARIO',
    noInventario,
    autor: 'Autor de Prueba',
    titulo: 'Titulo de Prueba',
    idioma: 'Espanol',
    anio: '2020',
    edicion: '1ra',
    lugar: 'Guatemala',
    paginasImpresas: 200,
    estadoFisico: 'Buen estado',
    atributos: {
      EDITORIAL: 'Editorial USAC',
    },
  };
}

describe('Flujo de 2 filtros', () => {
  test('un registro nuevo inicia en PENDIENTE_ADMIN y queda auditado', async () => {
    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-001'));

    expect(res.status).toBe(201);
    expect(res.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE_ADMIN);

    const auditoria = await Audit.find({ entidadId: res.body.data._id });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].accion).toBe(ACCIONES_AUDITORIA.CREAR);
  });

  test('rechaza la creacion si la categoria no esta en allowedCategories del usuario', async () => {
    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(revistaValida('INV-002'));

    expect(res.status).toBe(403);
  });

  test('camino feliz: Admin aprueba (filtro 1) y Manager aprueba (filtro 2)', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-003'));

    const id = creado.body.data._id;

    const filtro1 = await api(app)
      .patch(`/api/catalog/${id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    expect(filtro1.status).toBe(200);
    expect(filtro1.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE_MANAGER);

    const filtro2 = await api(app)
      .patch(`/api/catalog/${id}/aprobar`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'APROBAR' });

    expect(filtro2.status).toBe(200);
    expect(filtro2.body.data.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);

    const auditoria = await Audit.find({ entidadId: id }).sort({ fecha: 1 });
    expect(auditoria.map((a) => a.accion)).toEqual([
      ACCIONES_AUDITORIA.CREAR,
      ACCIONES_AUDITORIA.APROBAR,
      ACCIONES_AUDITORIA.APROBAR,
    ]);
  });

  test('camino de rechazo: Admin rechaza, autor edita y el registro vuelve a PENDIENTE_ADMIN', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-004'));

    const id = creado.body.data._id;

    const rechazo = await api(app)
      .patch(`/api/catalog/${id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'RECHAZAR', observaciones: 'Falta corregir el autor' });

    expect(rechazo.status).toBe(200);
    expect(rechazo.body.data.estadoRevision).toBe(ESTADOS_REVISION.RECHAZADO);

    const edicion = await api(app)
      .patch(`/api/catalog/${id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ autor: 'Autor Corregido' });

    expect(edicion.status).toBe(200);
    expect(edicion.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE_ADMIN);
    expect(edicion.body.data.autor).toBe('Autor Corregido');

    const auditoria = await Audit.find({ entidadId: id }).sort({ fecha: 1 });
    expect(auditoria.map((a) => a.accion)).toEqual([
      ACCIONES_AUDITORIA.CREAR,
      ACCIONES_AUDITORIA.RECHAZAR,
      ACCIONES_AUDITORIA.EDITAR,
    ]);
  });

  test('rechaza el rechazo sin observaciones', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-005'));

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'RECHAZAR' });

    expect(res.status).toBe(400);
  });
});

describe('Obtener un registro individual', () => {
  test('GET /api/catalog/:id devuelve el registro con sus datos poblados', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-007'));

    const res = await api(app)
      .get(`/api/catalog/${creado.body.data._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.noInventario).toBe('INV-007');
    expect(res.body.data.registradoPor.email).toBe('user@usac.gt');
    expect(res.body.data.atributos.EDITORIAL).toBe('Editorial USAC');
  });

  test('GET /api/catalog/:id responde 404 si no existe', async () => {
    const res = await api(app)
      .get('/api/catalog/64b7f9f3f3f3f3f3f3f3f3f3')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('Auditoria', () => {
  test('USER no puede leer el log de auditoria', async () => {
    const res = await api(app).get('/api/audit').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  test('Manager puede leer el log de auditoria', async () => {
    await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-006'));

    const res = await api(app).get('/api/audit').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });
});

describe('Filtro por registradoPor', () => {
  test('GET /api/catalog?registradoPor= solo devuelve los registros de ese usuario', async () => {
    await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(libroValido('INV-010'));
    const otroCreado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(diccionarioValido('INV-011'));
    expect(otroCreado.status).toBe(201);

    const res = await api(app)
      .get(`/api/catalog?registradoPor=${user._id}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.registros).toHaveLength(1);
    expect(res.body.data.registros[0].noInventario).toBe('INV-010');
  });
});

describe('Correccion de registros por Admin/Manager', () => {
  test('Admin puede corregir un registro incluso ya APROBADO, sin reiniciar el flujo', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-020'));
    const id = creado.body.data._id;

    await api(app)
      .patch(`/api/catalog/${id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });
    await api(app)
      .patch(`/api/catalog/${id}/aprobar`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'APROBAR' });

    const correccion = await api(app)
      .patch(`/api/catalog/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ autor: 'Autor Corregido Por Admin' });

    expect(correccion.status).toBe(200);
    expect(correccion.body.data.autor).toBe('Autor Corregido Por Admin');
    expect(correccion.body.data.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);
  });

  test('un Auxiliar sigue sin poder editar el registro de otra persona', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(diccionarioValido('INV-021'));
    expect(creado.status).toBe(201);

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ autor: 'Intento de edicion' });

    expect(res.status).toBe(403);
  });
});
