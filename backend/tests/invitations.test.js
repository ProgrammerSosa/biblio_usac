require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Invitation = require('../src/auth/invitation_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ACCIONES_AUDITORIA } = require('../utils/constants');

let managerToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();

  const passwordHash = await hashPassword('claveSegura123');
  const manager = await User.create({
    nombre: 'Jefatura',
    email: 'manager@usac.gt',
    passwordHash,
    rol: ROLES.MANAGER,
  });
  managerToken = generateJWT(manager);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('Alta de usuarios por invitacion (Manager)', () => {
  test('Manager crea una invitacion para un Auxiliar con categorias asignadas', async () => {
    const res = await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: 'auxiliar@usac.gt', rol: ROLES.USER, allowedCategories: ['LIBRO', 'REVISTA'] });

    expect(res.status).toBe(201);
    expect(res.body.data.invitationLink).toContain(res.body.data.invitation.token);
    expect(res.body.data.invitation.estado).toBe('PENDIENTE');
    // Sin SMTP_USER/SMTP_PASS en el entorno de pruebas: el enlace se devuelve igual, solo que sin enviar correo.
    expect(res.body.data.emailEnviado).toBe(false);

    const auditoria = await Audit.find({ accion: ACCIONES_AUDITORIA.INVITAR });
    expect(auditoria).toHaveLength(1);
  });

  test('un rol distinto de Manager no puede crear invitaciones', async () => {
    const passwordHash = await hashPassword('claveSegura123');
    const admin = await User.create({ nombre: 'Admin', email: 'admin2@usac.gt', passwordHash, rol: ROLES.ADMIN });
    const adminToken = generateJWT(admin);

    const res = await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'auxiliar@usac.gt', rol: ROLES.USER, allowedCategories: ['LIBRO'] });

    expect(res.status).toBe(403);
  });

  test('el invitado acepta la invitacion, queda con las categorias asignadas y puede iniciar sesion', async () => {
    const invitacion = await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: 'auxiliar2@usac.gt', rol: ROLES.USER, allowedCategories: ['DICCIONARIO'] });

    const { token } = invitacion.body.data.invitation;

    const registro = await api(app).post('/api/auth/register-invitation').send({
      token,
      nombre: 'Auxiliar Dos',
      password: 'claveSegura123',
    });

    expect(registro.status).toBe(201);
    expect(registro.body.data.allowedCategories).toEqual(['DICCIONARIO']);

    const login = await api(app)
      .post('/api/auth/login')
      .send({ email: 'auxiliar2@usac.gt', password: 'claveSegura123' });

    expect(login.status).toBe(200);
    expect(login.body.data.user.allowedCategories).toEqual(['DICCIONARIO']);
  });

  test('GET /api/users/invitations lista las invitaciones con su invitationLink', async () => {
    await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: 'auxiliar3@usac.gt', rol: ROLES.USER, allowedCategories: ['FOLLETO'] });

    const res = await api(app).get('/api/users/invitations').set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].invitationLink).toBeDefined();
  });

  test('no se puede reutilizar una invitacion ya aceptada', async () => {
    const invitacion = await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: 'auxiliar4@usac.gt', rol: ROLES.USER, allowedCategories: ['LIBRO'] });

    const { token } = invitacion.body.data.invitation;

    await api(app).post('/api/auth/register-invitation').send({ token, nombre: 'Auxiliar Cuatro', password: 'claveSegura123' });

    const segundoIntento = await api(app)
      .post('/api/auth/register-invitation')
      .send({ token, nombre: 'Otra Persona', password: 'otraClave123' });

    expect(segundoIntento.status).toBe(409);
  });
});

describe('GET /api/auth/invitations/:token (validar antes de mostrar el formulario)', () => {
  test('una invitacion pendiente y vigente es valida', async () => {
    const invitacion = await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: 'valida@usac.gt', rol: ROLES.USER, allowedCategories: ['LIBRO'] });

    const { token } = invitacion.body.data.invitation;

    const res = await api(app).get(`/api/auth/invitations/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.valido).toBe(true);
    expect(res.body.data.email).toBe('valida@usac.gt');
  });

  test('una invitacion ya aceptada deja de ser valida (no muestra el formulario de nuevo)', async () => {
    const invitacion = await api(app)
      .post('/api/users/invitations')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: 'yausada@usac.gt', rol: ROLES.USER, allowedCategories: ['LIBRO'] });

    const { token } = invitacion.body.data.invitation;

    await api(app).post('/api/auth/register-invitation').send({ token, nombre: 'Ya Usada', password: 'claveSegura123' });

    const res = await api(app).get(`/api/auth/invitations/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.valido).toBe(false);
    expect(res.body.data.motivo).toMatch(/ya fue utilizada/i);
  });

  test('una invitacion expirada no es valida', async () => {
    const invitacion = await Invitation.create({
      email: 'expirada@usac.gt',
      rol: ROLES.USER,
      token: 'token-de-prueba-expirado',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await api(app).get(`/api/auth/invitations/${invitacion.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.valido).toBe(false);
    expect(res.body.data.motivo).toMatch(/expiro/i);
  });

  test('un token que no existe no es valido', async () => {
    const res = await api(app).get('/api/auth/invitations/token-inventado-que-no-existe');

    expect(res.status).toBe(200);
    expect(res.body.data.valido).toBe(false);
  });
});
