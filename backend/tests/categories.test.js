require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Category = require('../src/catalog/category_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES } = require('../utils/constants');

let managerToken;
let adminToken;
let userToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();

  const passwordHash = await hashPassword('claveSegura123');
  const [manager, admin, user] = await Promise.all([
    User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER }),
    User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN }),
    User.create({ nombre: 'Auxiliar', email: 'user@usac.gt', passwordHash, rol: ROLES.USER }),
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

describe('CRUD de categorias', () => {
  test('GET /api/categories devuelve las categorias sembradas a cualquier rol autenticado', async () => {
    const res = await api(app).get('/api/categories').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.clave)).toEqual(
      expect.arrayContaining(['LIBRO', 'ENCICLOPEDIA', 'REVISTA', 'DICCIONARIO', 'FOLLETO', 'PUBLICACIONES_INSTITUCIONALES'])
    );
  });

  test('Manager crea una categoria nueva y la clave se genera del nombre', async () => {
    const res = await api(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        nombre: 'Tesis y Memorias',
        campos: [
          { etiqueta: 'Asesor', requerido: true },
          { etiqueta: 'Numero de registro', requerido: false },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.clave).toBe('TESIS_Y_MEMORIAS');
    expect(res.body.data.campos).toEqual([
      { clave: 'ASESOR', etiqueta: 'Asesor', requerido: true },
      { clave: 'NUMERO_DE_REGISTRO', etiqueta: 'Numero de registro', requerido: false },
    ]);
  });

  test('Admin y Auxiliar no pueden crear categorias', async () => {
    const payload = { nombre: 'Otra Categoria', campos: [] };

    const resAdmin = await api(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send(payload);
    expect(resAdmin.status).toBe(403);

    const resUser = await api(app).post('/api/categories').set('Authorization', `Bearer ${userToken}`).send(payload);
    expect(resUser.status).toBe(403);
  });

  test('no se puede crear una categoria cuya clave generada ya existe', async () => {
    const res = await api(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ nombre: 'Libro', campos: [] });

    expect(res.status).toBe(409);
  });

  test('Manager puede editar el nombre y los campos de una categoria', async () => {
    const categoria = await Category.findOne({ clave: 'FOLLETO' });

    const res = await api(app)
      .patch(`/api/categories/${categoria._id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ nombre: 'Folletos y Trifoliares', campos: [{ etiqueta: 'Editorial', requerido: false }] });

    expect(res.status).toBe(200);
    expect(res.body.data.nombre).toBe('Folletos y Trifoliares');
    expect(res.body.data.clave).toBe('FOLLETO');
    expect(res.body.data.campos).toEqual([{ clave: 'EDITORIAL', etiqueta: 'Editorial', requerido: false }]);
  });

  test('Manager puede desactivar una categoria y deja de listarse por defecto', async () => {
    const categoria = await Category.findOne({ clave: 'ENCICLOPEDIA' });

    const desactivar = await api(app)
      .patch(`/api/categories/${categoria._id}/estado`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ activo: false });
    expect(desactivar.status).toBe(200);

    const listado = await api(app).get('/api/categories').set('Authorization', `Bearer ${userToken}`);
    expect(listado.body.data.map((c) => c.clave)).not.toContain('ENCICLOPEDIA');

    const listadoCompleto = await api(app)
      .get('/api/categories?incluirInactivas=true')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(listadoCompleto.body.data.map((c) => c.clave)).toContain('ENCICLOPEDIA');
  });
});

describe('El catalogo usa las categorias dinamicas', () => {
  test('se puede registrar un material en una categoria recien creada, con sus campos propios', async () => {
    const nueva = await api(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ nombre: 'Tesis', campos: [{ etiqueta: 'Asesor', requerido: true }] });

    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        categoria: nueva.body.data.clave,
        noInventario: 'T-001',
        autor: 'Autor de Prueba',
        titulo: 'Tesis de Prueba',
        atributos: { ASESOR: 'Lic. Prueba' },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.atributos.ASESOR).toBe('Lic. Prueba');
  });

  test('rechaza el registro si falta un campo obligatorio de la categoria', async () => {
    await api(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ nombre: 'Tesis', campos: [{ etiqueta: 'Asesor', requerido: true }] });

    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ categoria: 'TESIS', noInventario: 'T-002', autor: 'Autor', titulo: 'Titulo' });

    expect(res.status).toBe(400);
  });

  test('rechaza el registro si la categoria no existe', async () => {
    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ categoria: 'NO_EXISTE', noInventario: 'T-003', autor: 'Autor', titulo: 'Titulo' });

    expect(res.status).toBe(400);
  });

  test('rechaza un atributo que no esta definido para la categoria', async () => {
    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        categoria: 'DICCIONARIO',
        noInventario: 'T-004',
        autor: 'Autor',
        titulo: 'Titulo',
        atributos: { EDITORIAL: 'Ed', campoInventado: 'x' },
      });

    expect(res.status).toBe(400);
  });
});
