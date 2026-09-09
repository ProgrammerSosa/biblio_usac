require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ACCIONES_AUDITORIA } = require('../utils/constants');

let auxiliar1;
let auxiliar2;
let manager;
let auxiliar1Token;
let auxiliar2Token;
let managerToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();

  const passwordHash = await hashPassword('claveSegura123');
  [auxiliar1, auxiliar2, manager] = await Promise.all([
    User.create({ nombre: 'Auxiliar Uno', email: 'aux1@usac.gt', passwordHash, rol: ROLES.USER, allowedCategories: ['LIBRO'] }),
    User.create({ nombre: 'Auxiliar Dos', email: 'aux2@usac.gt', passwordHash, rol: ROLES.USER, allowedCategories: ['LIBRO'] }),
    User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER }),
  ]);

  auxiliar1Token = generateJWT(auxiliar1);
  auxiliar2Token = generateJWT(auxiliar2);
  managerToken = generateJWT(manager);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

function libro(noInventario) {
  return {
    categoria: 'LIBRO',
    noInventario,
    autor: 'Autor de Prueba',
    titulo: 'Titulo Borrador de Prueba',
    atributos: { EDITORIAL: 'Ed', ISBN: '123', TIPO_DE_DOCUMENTO: 'Fisico' },
  };
}

describe('Modo borrador: un registro nuevo solo lo ve su autor hasta que se envia', () => {
  test('un registro recien creado nace como borrador (enviado: false)', async () => {
    const res = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('BOR-001'));
    expect(res.status).toBe(201);
    expect(res.body.data.enviado).toBe(false);
  });

  test('el autor SI ve su propio borrador en el listado', async () => {
    await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('BOR-002'));

    const res = await api(app).get('/api/catalog?buscar=BOR-002').set('Authorization', `Bearer ${auxiliar1Token}`);
    expect(res.body.data.registros).toHaveLength(1);
  });

  test('otro Auxiliar NO ve el borrador ajeno', async () => {
    await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('BOR-003'));

    const res = await api(app).get('/api/catalog?buscar=BOR-003').set('Authorization', `Bearer ${auxiliar2Token}`);
    expect(res.body.data.registros).toHaveLength(0);
  });

  test('el Manager tampoco ve el borrador ajeno', async () => {
    await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('BOR-004'));

    const res = await api(app).get('/api/catalog?buscar=BOR-004').set('Authorization', `Bearer ${managerToken}`);
    expect(res.body.data.registros).toHaveLength(0);
  });

  test('GET /api/catalog/:id de un borrador ajeno responde 404 (no revela que existe)', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('BOR-005'));

    const res = await api(app)
      .get(`/api/catalog/${creado.body.data._id}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(404);
  });

  test('Admin/Manager no pueden revisar/aprobar un registro que todavia no se ha enviado', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('BOR-006'));

    const revisar = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'APROBAR' });
    expect(revisar.status).toBe(404);

    const lote = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ ids: [creado.body.data._id] });
    expect(lote.body.data.aprobados).toBe(0);
  });
});

describe('PATCH /api/catalog/enviar-lote', () => {
  test('el autor puede enviar su propio borrador y queda visible para los demas', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('ENV-001'));

    const envio = await api(app)
      .patch('/api/catalog/enviar-lote')
      .set('Authorization', `Bearer ${auxiliar1Token}`)
      .send({ ids: [creado.body.data._id] });

    expect(envio.status).toBe(200);
    expect(envio.body.data.enviados).toBe(1);

    const res = await api(app).get('/api/catalog?buscar=ENV-001').set('Authorization', `Bearer ${managerToken}`);
    expect(res.body.data.registros).toHaveLength(1);

    const auditoria = await Audit.find({ entidadId: creado.body.data._id }).sort({ fecha: 1 });
    expect(auditoria.map((a) => a.accion)).toEqual([ACCIONES_AUDITORIA.CREAR, ACCIONES_AUDITORIA.ENVIAR]);
  });

  test('se pueden enviar varios borradores de una sola vez', async () => {
    const ids = [];
    for (const noInv of ['ENV-002', 'ENV-003', 'ENV-004']) {
      const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro(noInv));
      ids.push(creado.body.data._id);
    }

    const envio = await api(app)
      .patch('/api/catalog/enviar-lote')
      .set('Authorization', `Bearer ${auxiliar1Token}`)
      .send({ ids });

    expect(envio.status).toBe(200);
    expect(envio.body.data.enviados).toBe(3);
  });

  test('no se puede enviar el borrador de otra persona', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('ENV-005'));

    const envio = await api(app)
      .patch('/api/catalog/enviar-lote')
      .set('Authorization', `Bearer ${auxiliar2Token}`)
      .send({ ids: [creado.body.data._id] });

    expect(envio.status).toBe(200);
    expect(envio.body.data.enviados).toBe(0);

    const sigueOculto = await api(app).get('/api/catalog?buscar=ENV-005').set('Authorization', `Bearer ${auxiliar2Token}`);
    expect(sigueOculto.body.data.registros).toHaveLength(0);
  });

  test('enviar algo que ya estaba enviado no cuenta de nuevo', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('ENV-006'));
    await api(app).patch('/api/catalog/enviar-lote').set('Authorization', `Bearer ${auxiliar1Token}`).send({ ids: [creado.body.data._id] });

    const segundoEnvio = await api(app)
      .patch('/api/catalog/enviar-lote')
      .set('Authorization', `Bearer ${auxiliar1Token}`)
      .send({ ids: [creado.body.data._id] });

    expect(segundoEnvio.body.data.enviados).toBe(0);
  });

  test('rechaza la peticion si no se envian ids', async () => {
    const res = await api(app)
      .patch('/api/catalog/enviar-lote')
      .set('Authorization', `Bearer ${auxiliar1Token}`)
      .send({ ids: [] });

    expect(res.status).toBe(400);
  });

  test('una vez enviado, Admin/Manager si pueden aprobarlo', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('ENV-007'));
    await api(app).patch('/api/catalog/enviar-lote').set('Authorization', `Bearer ${auxiliar1Token}`).send({ ids: [creado.body.data._id] });

    const revisar = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'APROBAR' });

    expect(revisar.status).toBe(200);
    expect(revisar.body.data.estadoRevision).toBe('APROBADO');
  });
});
