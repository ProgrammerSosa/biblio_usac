require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const { seed, DEFAULT_MANAGER_EMAIL, DEFAULT_MANAGER_PASSWORD } = require('../scripts/seed');
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

describe('Cuenta Manager por defecto', () => {
  test('crea la cuenta Manager por defecto cuando no existe ningun Manager', async () => {
    await seed();

    const manager = await User.findOne({ email: DEFAULT_MANAGER_EMAIL });
    expect(manager).not.toBeNull();
    expect(manager.rol).toBe(ROLES.MANAGER);
  });

  test('correr el seed dos veces no duplica la cuenta', async () => {
    await seed();
    await seed();

    const managers = await User.find({ rol: ROLES.MANAGER });
    expect(managers).toHaveLength(1);
  });

  test('no crea la cuenta por defecto si ya existe otro Manager', async () => {
    await User.create({
      nombre: 'Manager Existente',
      email: 'otro-manager@usac.gt',
      passwordHash: await hashPassword('claveSegura123'),
      rol: ROLES.MANAGER,
    });

    await seed();

    const cuentaPorDefecto = await User.findOne({ email: DEFAULT_MANAGER_EMAIL });
    expect(cuentaPorDefecto).toBeNull();
  });

  test('se puede iniciar sesion de inmediato con la cuenta Manager por defecto', async () => {
    await seed();

    const login = await api(app).post('/api/auth/login').send({
      email: DEFAULT_MANAGER_EMAIL,
      password: DEFAULT_MANAGER_PASSWORD,
    });

    expect(login.status).toBe(200);
    expect(login.body.data.user.rol).toBe(ROLES.MANAGER);
    expect(login.body.data.token).toBeDefined();
  });
});
