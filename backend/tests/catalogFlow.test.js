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
    idioma: 'Español',
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
    idioma: 'Español',
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
    idioma: 'Español',
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

// Un registro nuevo nace como borrador (solo lo ve su autor). La mayoria de pruebas de
// aqui en adelante necesitan que ya este enviado, para poder probar lo que pasa despues
// (revisar, aprobar en lote, verlo desde otra cuenta, etc).
async function crearYEnviar(token, datos) {
  const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${token}`).send(datos);
  if (creado.status === 201) {
    await api(app).patch('/api/catalog/enviar-lote').set('Authorization', `Bearer ${token}`).send({ ids: [creado.body.data._id] });
  }
  return creado;
}

describe('Flujo de aprobacion (1 filtro, solo Admin)', () => {
  test('un registro nuevo inicia en PENDIENTE y queda auditado', async () => {
    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-001'));

    expect(res.status).toBe(201);
    expect(res.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE);

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

  test('camino feliz: el Admin aprueba y el registro queda Aprobado', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-003'));

    const id = creado.body.data._id;

    const revision = await api(app)
      .patch(`/api/catalog/${id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    expect(revision.status).toBe(200);
    expect(revision.body.data.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);

    const auditoria = await Audit.find({ entidadId: id }).sort({ fecha: 1 });
    expect(auditoria.map((a) => a.accion)).toEqual([
      ACCIONES_AUDITORIA.CREAR,
      ACCIONES_AUDITORIA.ENVIAR,
      ACCIONES_AUDITORIA.APROBAR,
    ]);
  });

  test('el Manager tambien puede aprobar registros (misma logica de 1 filtro)', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-003B'));

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'APROBAR' });

    expect(res.status).toBe(200);
    expect(res.body.data.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);
  });

  test('un Auxiliar no puede revisar/aprobar registros', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-003C'));

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ decision: 'APROBAR' });

    expect(res.status).toBe(403);
  });

  test('camino de rechazo: Admin rechaza, autor edita y el registro vuelve a PENDIENTE', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-004'));

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
    expect(edicion.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE);
    expect(edicion.body.data.autor).toBe('Autor Corregido');

    const auditoria = await Audit.find({ entidadId: id }).sort({ fecha: 1 });
    expect(auditoria.map((a) => a.accion)).toEqual([
      ACCIONES_AUDITORIA.CREAR,
      ACCIONES_AUDITORIA.ENVIAR,
      ACCIONES_AUDITORIA.RECHAZAR,
      ACCIONES_AUDITORIA.EDITAR,
    ]);
  });

  test('rechaza el rechazo sin observaciones', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-005'));

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'RECHAZAR' });

    expect(res.status).toBe(400);
  });
});

describe('Aprobacion en lote (solo Admin)', () => {
  test('Admin puede aprobar varios registros pendientes de una sola vez', async () => {
    const ids = [];
    for (const noInv of ['LOTE-001', 'LOTE-002', 'LOTE-003']) {
      const creado = await crearYEnviar(userToken, libroValido(noInv));
      ids.push(creado.body.data._id);
    }

    const res = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids });

    expect(res.status).toBe(200);
    expect(res.body.data.aprobados).toBe(3);

    for (const id of ids) {
      const item = await api(app).get(`/api/catalog/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(item.body.data.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);
    }

    const auditoria = await Audit.find({ entidadId: { $in: ids }, accion: ACCIONES_AUDITORIA.APROBAR });
    expect(auditoria).toHaveLength(3);
  });

  test('el lote ignora los registros que no esten pendientes', async () => {
    const creado = await crearYEnviar(userToken, libroValido('LOTE-004'));
    const id = creado.body.data._id;

    await api(app)
      .patch(`/api/catalog/${id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const res = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [id] });

    expect(res.status).toBe(200);
    expect(res.body.data.aprobados).toBe(0);
  });

  test('el Manager tambien puede usar la aprobacion en lote', async () => {
    const creado = await crearYEnviar(userToken, libroValido('LOTE-005'));

    const res = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ ids: [creado.body.data._id] });

    expect(res.status).toBe(200);
    expect(res.body.data.aprobados).toBe(1);
  });

  test('un Auxiliar no puede usar la aprobacion en lote', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('LOTE-006'));

    const res = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [creado.body.data._id] });

    expect(res.status).toBe(403);
  });

  test('rechaza la peticion si no se envian ids', async () => {
    const res = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [] });

    expect(res.status).toBe(400);
  });
});

describe('No. de Inventario opcional (para materiales importados sin numero asignado)', () => {
  test('se puede crear un registro sin noInventario', async () => {
    const datos = libroValido(undefined);
    delete datos.noInventario;

    const res = await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(datos);

    expect(res.status).toBe(201);
    expect(res.body.data.noInventario).toBeFalsy();
  });

  test('varios registros sin noInventario pueden coexistir (no chocan entre si)', async () => {
    const datos1 = libroValido(undefined);
    delete datos1.noInventario;
    const datos2 = { ...libroValido(undefined), titulo: 'Otro titulo' };
    delete datos2.noInventario;

    const res1 = await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(datos1);
    const res2 = await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(datos2);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
  });

  test('cuando si se indica, el noInventario sigue teniendo que ser unico', async () => {
    await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(libroValido('INV-DUP'));
    const res = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...libroValido('INV-DUP'), titulo: 'Titulo distinto' });

    expect(res.status).toBe(409);
  });

  // El formulario del frontend manda noInventario: '' (no omite el campo) cuando se deja en
  // blanco. Eso no es lo mismo para el indice unique+sparse de Mongo: solo salta el indice
  // cuando el campo esta ausente, no cuando vale ''. Sin limpiar la cadena vacia antes de
  // guardar, el primer registro en blanco se crea bien pero el segundo choca como si "" fuera
  // un No. de Inventario duplicado - exactamente el payload que manda el formulario real.
  test('varios registros con noInventario: "" (como lo manda el formulario) tambien pueden coexistir', async () => {
    const res1 = await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(libroValido(''));
    const res2 = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...libroValido(''), titulo: 'Otro titulo' });

    expect(res1.status).toBe(201);
    expect(res1.body.data.noInventario).toBeFalsy();
    expect(res2.status).toBe(201);
    expect(res2.body.data.noInventario).toBeFalsy();
  });

  test('editar un registro para dejarle noInventario: "" lo desasigna de verdad (no lo deja como "")', async () => {
    const creado = await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(libroValido('INV-A-QUITAR'));

    const editado = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ noInventario: '' });
    expect(editado.status).toBe(200);
    expect(editado.body.data.noInventario).toBeFalsy();

    // Si de verdad quedo desasignado (no en ""), otro registro en blanco no deberia chocar.
    const otro = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...libroValido(''), titulo: 'Otro mas' });
    expect(otro.status).toBe(201);
  });
});

describe('Obtener un registro individual', () => {
  test('GET /api/catalog/:id devuelve el registro con sus datos poblados', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-007'));

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
  test('USER tambien puede leer el log de auditoria, pero solo el suyo', async () => {
    const creado = await api(app)
      .post('/api/catalog')
      .set('Authorization', `Bearer ${userToken}`)
      .send(libroValido('INV-USER-AUDIT'));
    expect(creado.status).toBe(201);

    const res = await api(app).get('/api/audit').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.registros.every((r) => r.usuario._id === user._id.toString())).toBe(true);
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
    await crearYEnviar(userToken, libroValido('INV-010'));
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
  test('Admin puede corregir un registro Pendiente o Rechazado de otra persona sin reiniciar el flujo', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-019'));
    const id = creado.body.data._id;

    const correccion = await api(app)
      .patch(`/api/catalog/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ autor: 'Autor Corregido Por Admin' });

    expect(correccion.status).toBe(200);
    expect(correccion.body.data.autor).toBe('Autor Corregido Por Admin');
    expect(correccion.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE);
  });

  test('un registro ya APROBADO, el Admin ya no lo puede corregir (solo la Manager)', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-020'));
    const id = creado.body.data._id;

    await api(app)
      .patch(`/api/catalog/${id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const intentoAdmin = await api(app)
      .patch(`/api/catalog/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ autor: 'Intento De Admin' });

    expect(intentoAdmin.status).toBe(403);

    const correccionManager = await api(app)
      .patch(`/api/catalog/${id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ autor: 'Autor Corregido Por Manager' });

    expect(correccionManager.status).toBe(200);
    expect(correccionManager.body.data.autor).toBe('Autor Corregido Por Manager');
    expect(correccionManager.body.data.estadoRevision).toBe(ESTADOS_REVISION.APROBADO);
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
