require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const { hashPassword } = require('../helpers/password');
const { ROLES } = require('../utils/constants');

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('JWT y roles', () => {
  test('rechaza rutas protegidas sin token JWT', async () => {
    const res = await api(app).get('/api/catalog');
    expect(res.status).toBe(401);
  });

  test('rechaza rutas de Manager cuando el rol no coincide', async () => {
    const passwordHash = await hashPassword('claveSegura123');
    const user = await User.create({
      nombre: 'Auxiliar Uno',
      email: 'auxiliar@usac.gt',
      passwordHash,
      rol: ROLES.USER,
      allowedCategories: ['LIBRO'],
    });

    const loginRes = await api(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'claveSegura123' });

    expect(loginRes.status).toBe(200);
    const { token } = loginRes.body.data;

    const res = await api(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('Manejo de errores', () => {
  test('un JSON mal formado responde 400 con un mensaje claro, no 500', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "roto@usac.gt", "password":');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Login', () => {
  test('inicia sesion con credenciales correctas', async () => {
    const passwordHash = await hashPassword('claveSegura123');
    await User.create({
      nombre: 'Manager Uno',
      email: 'manager@usac.gt',
      passwordHash,
      rol: ROLES.MANAGER,
    });

    const res = await api(app).post('/api/auth/login').send({
      email: 'manager@usac.gt',
      password: 'claveSegura123',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.rol).toBe(ROLES.MANAGER);
  });

  test('inicia sesion usando el nombre en vez del correo', async () => {
    const passwordHash = await hashPassword('claveSegura123');
    await User.create({
      nombre: 'adminbiblio',
      email: 'adminbiblio@usac.gt',
      passwordHash,
      rol: ROLES.MANAGER,
    });

    const res = await api(app).post('/api/auth/login').send({
      identificador: 'AdminBiblio',
      password: 'claveSegura123',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('adminbiblio@usac.gt');
  });

  test('un nombre con caracteres especiales de regex no rompe el login ni actua como comodin', async () => {
    const passwordHash = await hashPassword('claveSegura123');
    await User.create({ nombre: 'Manager Uno', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER });

    const res = await api(app).post('/api/auth/login').send({
      identificador: '.*',
      password: 'claveSegura123',
    });

    expect(res.status).toBe(401);
  });

  test('rechaza credenciales incorrectas', async () => {
    const passwordHash = await hashPassword('claveSegura123');
    await User.create({
      nombre: 'Manager Uno',
      email: 'manager@usac.gt',
      passwordHash,
      rol: ROLES.MANAGER,
    });

    const res = await api(app).post('/api/auth/login').send({
      email: 'manager@usac.gt',
      password: 'claveIncorrecta',
    });

    expect(res.status).toBe(401);
  });
});
