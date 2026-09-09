require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES } = require('../utils/constants');

let manager;
let admin;
let auxiliar1;
let auxiliar2;
let managerToken;
let adminToken;
let auxiliar1Token;
let auxiliar2Token;

const DIA_PASADO = new Date('2020-01-15T12:00:00.000Z');

function libro(noInventario) {
  return {
    categoria: 'LIBRO',
    noInventario,
    autor: 'Autor de Prueba',
    titulo: 'Titulo de Prueba',
    atributos: { EDITORIAL: 'Ed', ISBN: '123', TIPO_DE_DOCUMENTO: 'Fisico' },
  };
}

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();

  const passwordHash = await hashPassword('claveSegura123');
  [manager, admin, auxiliar1, auxiliar2] = await Promise.all([
    User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER }),
    User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN }),
    User.create({ nombre: 'Auxiliar Uno', email: 'aux1@usac.gt', passwordHash, rol: ROLES.USER, allowedCategories: ['LIBRO'] }),
    User.create({ nombre: 'Auxiliar Dos', email: 'aux2@usac.gt', passwordHash, rol: ROLES.USER, allowedCategories: ['LIBRO'] }),
  ]);

  managerToken = generateJWT(manager);
  adminToken = generateJWT(admin);
  auxiliar1Token = generateJWT(auxiliar1);
  auxiliar2Token = generateJWT(auxiliar2);

  // Auxiliar 1: 2 registros hoy + 3 registros en un dia pasado (su "mejor dia").
  // Se envian de una vez: estas pruebas verifican visibilidad/busqueda desde otras cuentas,
  // no el comportamiento de borrador en si.
  const hoy1 = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('A1-HOY-1'));
  const hoy2 = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar1Token}`).send(libro('A1-HOY-2'));
  await api(app)
    .patch('/api/catalog/enviar-lote')
    .set('Authorization', `Bearer ${auxiliar1Token}`)
    .send({ ids: [hoy1.body.data._id, hoy2.body.data._id] });

  for (const noInv of ['A1-PASADO-1', 'A1-PASADO-2', 'A1-PASADO-3']) {
    // Mongoose respeta un createdAt explicito al crear (aunque lo protege de updateOne despues),
    // asi que se simula un registro de un dia pasado indicandolo desde la creacion.
    await Catalog.create({ ...libro(noInv), registradoPor: auxiliar1._id, createdAt: DIA_PASADO, enviado: true });
  }

  // Auxiliar 2: 1 registro hoy.
  const hoyAux2 = await api(app).post('/api/catalog').set('Authorization', `Bearer ${auxiliar2Token}`).send(libro('A2-HOY-1'));
  await api(app)
    .patch('/api/catalog/enviar-lote')
    .set('Authorization', `Bearer ${auxiliar2Token}`)
    .send({ ids: [hoyAux2.body.data._id] });
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('GET /api/team (panel de actividad)', () => {
  test('Admin solo ve a los Auxiliares, con sus totales correctos', async () => {
    const res = await api(app).get('/api/team').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const nombres = res.body.data.map((f) => f.usuario.nombre);
    expect(nombres).toEqual(expect.arrayContaining(['Auxiliar Uno', 'Auxiliar Dos']));
    expect(nombres).not.toContain('Jefatura');
    expect(nombres).not.toContain('Supervisor');

    const fila1 = res.body.data.find((f) => f.usuario.nombre === 'Auxiliar Uno');
    expect(fila1.total).toBe(5);
    expect(fila1.hoy).toBe(2);
  });

  test('Manager ve a todo el personal', async () => {
    const res = await api(app).get('/api/team').set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
  });

  test('un Auxiliar no puede ver el panel de equipo', async () => {
    const res = await api(app).get('/api/team').set('Authorization', `Bearer ${auxiliar1Token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/team/:id/perfil', () => {
  test('el perfil incluye el total, el desglose por hoy y el mejor dia', async () => {
    const res = await api(app)
      .get(`/api/team/${auxiliar1._id}/perfil`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.hoy).toBe(2);
    expect(res.body.data.mejorDia).toEqual({ fecha: '2020-01-15', cantidad: 3 });
  });

  test('Admin puede ver el perfil de un Auxiliar', async () => {
    const res = await api(app)
      .get(`/api/team/${auxiliar1._id}/perfil`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('Admin no puede ver el perfil de la Manager', async () => {
    const res = await api(app)
      .get(`/api/team/${manager._id}/perfil`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  test('Admin puede ver su propio perfil', async () => {
    const res = await api(app)
      .get(`/api/team/${admin._id}/perfil`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('un Auxiliar puede ver su propio perfil pero no el de otro Auxiliar', async () => {
    const propio = await api(app)
      .get(`/api/team/${auxiliar1._id}/perfil`)
      .set('Authorization', `Bearer ${auxiliar1Token}`);
    expect(propio.status).toBe(200);

    const ajeno = await api(app)
      .get(`/api/team/${auxiliar2._id}/perfil`)
      .set('Authorization', `Bearer ${auxiliar1Token}`);
    expect(ajeno.status).toBe(403);
  });

  test('responde 404 si el usuario no existe', async () => {
    const res = await api(app)
      .get('/api/team/64b7f9f3f3f3f3f3f3f3f3f3/perfil')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Busqueda en el catalogo', () => {
  test('GET /api/catalog?buscar= filtra por titulo, autor o no. de inventario', async () => {
    const res = await api(app)
      .get('/api/catalog?buscar=A1-PASADO-2')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.registros).toHaveLength(1);
    expect(res.body.data.registros[0].noInventario).toBe('A1-PASADO-2');
  });

  test('la busqueda no distingue mayusculas/minusculas', async () => {
    const res = await api(app)
      .get('/api/catalog?buscar=titulo de prueba')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(6);
  });

  test('caracteres especiales de regex en la busqueda no rompen la peticion', async () => {
    const res = await api(app)
      .get(`/api/catalog?${new URLSearchParams({ buscar: '.*(' }).toString()}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.registros).toHaveLength(0);
  });
});
