require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ACCIONES_AUDITORIA } = require('../utils/constants');

let managerToken;
let manager;
let auxiliar;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  const passwordHash = await hashPassword('claveSegura123');

  manager = await User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER });
  auxiliar = await User.create({
    nombre: 'Auxiliar',
    email: 'auxiliar@usac.gt',
    passwordHash,
    rol: ROLES.USER,
    allowedCategories: ['LIBRO'],
  });

  managerToken = generateJWT(manager);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('Activar/Desactivar personal (Manager)', () => {
  test('el Manager puede desactivar a un auxiliar y queda auditado', async () => {
    const res = await api(app)
      .patch(`/api/users/${auxiliar._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });

    expect(res.status).toBe(200);

    const actualizado = await User.findById(auxiliar._id);
    expect(actualizado.activo).toBe(false);

    const auditoria = await Audit.find({ accion: ACCIONES_AUDITORIA.DESACTIVAR_USUARIO });
    expect(auditoria).toHaveLength(1);
  });

  test('un usuario desactivado no puede iniciar sesion', async () => {
    await api(app)
      .patch(`/api/users/${auxiliar._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });

    const login = await api(app).post('/api/auth/login').send({
      email: 'auxiliar@usac.gt',
      password: 'claveSegura123',
    });

    expect(login.status).toBe(403);
  });

  test('el token de un usuario ya desactivado deja de funcionar de inmediato', async () => {
    const auxiliarToken = generateJWT(auxiliar);

    const antes = await api(app).get('/api/catalog').set('Authorization', `Bearer ${auxiliarToken}`);
    expect(antes.status).toBe(200);

    await api(app)
      .patch(`/api/users/${auxiliar._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });

    const despues = await api(app).get('/api/catalog').set('Authorization', `Bearer ${auxiliarToken}`);
    expect(despues.status).toBe(401);
  });

  test('un Manager no puede desactivar su propia cuenta', async () => {
    const res = await api(app)
      .patch(`/api/users/${manager._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });

    expect(res.status).toBe(403);
  });

  test('reactivar un usuario le permite iniciar sesion de nuevo', async () => {
    await api(app)
      .patch(`/api/users/${auxiliar._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });

    await api(app)
      .patch(`/api/users/${auxiliar._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: true });

    const login = await api(app).post('/api/auth/login').send({
      email: 'auxiliar@usac.gt',
      password: 'claveSegura123',
    });

    expect(login.status).toBe(200);
  });

  test('responde 404 si el usuario no existe', async () => {
    const res = await api(app)
      .patch('/api/users/64b7f9f3f3f3f3f3f3f3f3f3/estado')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });

    expect(res.status).toBe(404);
  });
});
