require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
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

describe('Rechazo en lote (solo Admin/Manager)', () => {
  test('Admin puede rechazar varios registros pendientes de una sola vez, con el mismo motivo', async () => {
    const ids = [];
    for (const titulo of ['Rechazo lote 1', 'Rechazo lote 2', 'Rechazo lote 3']) {
      const creado = await crearYEnviar(userToken, { ...libroValido(), titulo });
      ids.push(creado.body.data._id);
    }

    const res = await api(app)
      .patch('/api/catalog/rechazar-lote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids, observaciones: 'Faltan datos en los tres' });

    expect(res.status).toBe(200);
    expect(res.body.data.rechazados).toBe(3);

    for (const id of ids) {
      const item = await api(app).get(`/api/catalog/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(item.body.data.estadoRevision).toBe(ESTADOS_REVISION.RECHAZADO);
      expect(item.body.data.observaciones).toBe('Faltan datos en los tres');
      expect(item.body.data.idInventario).toBeUndefined();
    }
  });

  test('rechaza la peticion si no se mandan observaciones', async () => {
    const creado = await crearYEnviar(userToken, libroValido());

    const res = await api(app)
      .patch('/api/catalog/rechazar-lote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [creado.body.data._id] });

    expect(res.status).toBe(400);

    const item = await api(app).get(`/api/catalog/${creado.body.data._id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(item.body.data.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE);
  });

  test('un Auxiliar no puede usar el rechazo en lote', async () => {
    const creado = await crearYEnviar(userToken, libroValido());

    const res = await api(app)
      .patch('/api/catalog/rechazar-lote')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: [creado.body.data._id], observaciones: 'Motivo' });

    expect(res.status).toBe(403);
  });
});

describe('Copias detectadas automaticamente al registrar (sin ninguna accion extra)', () => {
  test('registrar un material identico a uno que ya existe no choca con nada: cada registro queda propio, listo para agruparse en la vista', async () => {
    // No existe ningun endpoint para "agregar copias": si ya hay 5 ejemplares en el catalogo
    // y se registran 3 mas con exactamente los mismos datos (solo cambia estado fisico), los
    // 3 se crean sin problema, cada uno como su propio documento Pendiente - la vista de
    // Catalogo (CatalogListPage) los agrupa solos por coincidir en todo salvo estado fisico.
    const datosBase = { ...libroValido(), titulo: 'Libro En Stock Multiple' };
    for (let i = 0; i < 5; i++) {
      const res = await api(app)
        .post('/api/catalog')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...datosBase, estadoFisico: `Ejemplar ${i + 1}` });
      expect(res.status).toBe(201);
    }

    for (let i = 0; i < 3; i++) {
      const res = await api(app)
        .post('/api/catalog')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...datosBase, estadoFisico: `Ejemplar nuevo ${i + 1}` });
      expect(res.status).toBe(201);
    }

    const registros = await Catalog.find({ titulo: 'Libro En Stock Multiple' });
    expect(registros).toHaveLength(8);
    expect(registros.every((r) => r.estadoRevision === ESTADOS_REVISION.PENDIENTE)).toBe(true);
  });
});

describe('Dar de baja (distinto de eliminar - el registro se queda visible)', () => {
  test('Admin puede dar de baja un registro Aprobado, con motivo obligatorio', async () => {
    const creado = await crearYEnviar(userToken, libroValido());
    await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const sinMotivo = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(sinMotivo.status).toBe(400);

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motivo: 'Se dono a la biblioteca municipal' });

    expect(res.status).toBe(200);
    expect(res.body.data.deBaja).toBe(true);
    expect(res.body.data.motivoBaja).toBe('Se dono a la biblioteca municipal');
    expect(res.body.data.fechaBaja).not.toBeNull();
    expect(res.body.data.dadoDeBajaPor).toBe(admin._id.toString());

    // Sigue visible (no se oculta como al eliminar).
    const listado = await api(app).get('/api/catalog').set('Authorization', `Bearer ${adminToken}`);
    expect(listado.body.data.registros.map((r) => r._id)).toContain(creado.body.data._id);

    const auditoria = await Audit.findOne({ accion: ACCIONES_AUDITORIA.DAR_DE_BAJA, entidadId: creado.body.data._id });
    expect(auditoria).not.toBeNull();
  });

  test('un Auxiliar no puede dar de baja', async () => {
    const creado = await crearYEnviar(userToken, libroValido());
    await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ motivo: 'Se perdio' });

    expect(res.status).toBe(403);
  });

  test('no se puede dar de baja un registro que sigue Pendiente', async () => {
    const creado = await crearYEnviar(userToken, libroValido());

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motivo: 'Motivo cualquiera' });

    expect(res.status).toBe(409);
  });

  test('no se puede dar de baja dos veces el mismo registro', async () => {
    const creado = await crearYEnviar(userToken, libroValido());
    await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });
    await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motivo: 'Primera baja' });

    const segunda = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motivo: 'Segunda baja' });

    expect(segunda.status).toBe(409);
  });

  test('el filtro estadoRevision=DE_BAJA en el listado muestra solo los dados de baja', async () => {
    const activo = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Activo' });
    await api(app)
      .patch(`/api/catalog/${activo.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const deBaja = await crearYEnviar(userToken, { ...libroValido(), titulo: 'De baja' });
    await api(app)
      .patch(`/api/catalog/${deBaja.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });
    await api(app)
      .patch(`/api/catalog/${deBaja.body.data._id}/dar-de-baja`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motivo: 'Se dono' });

    const res = await api(app)
      .get('/api/catalog')
      .query({ estadoRevision: 'DE_BAJA' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.registros.map((r) => r._id);
    expect(ids).toContain(deBaja.body.data._id);
    expect(ids).not.toContain(activo.body.data._id);
    expect(res.body.data.registros.every((r) => r.deBaja === true)).toBe(true);
  });

  test('el filtro anioRegistro en el listado muestra solo lo creado ese año (createdAt, no el año de publicacion)', async () => {
    const viejo = await Catalog.create({
      ...libroValido(),
      titulo: 'Registrado en 2020',
      registradoPor: admin._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
      createdAt: new Date('2020-05-01T00:00:00.000Z'),
    });
    const reciente = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Registrado ahora' });

    const res = await api(app)
      .get('/api/catalog')
      .query({ anioRegistro: '2020' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.registros.map((r) => r._id);
    expect(ids).toContain(viejo._id.toString());
    expect(ids).not.toContain(reciente.body.data._id);
  });
});

describe('ID de inventario automatico (se asigna solo al aprobar)', () => {
  test('un registro recien creado no tiene ID de inventario todavia', async () => {
    const res = await api(app).post('/api/catalog').set('Authorization', `Bearer ${userToken}`).send(libroValido());

    expect(res.status).toBe(201);
    expect(res.body.data.idInventario).toBeUndefined();
  });

  test('al aprobar un registro se le asigna el primer ID disponible (10001)', async () => {
    const creado = await crearYEnviar(userToken, libroValido());

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    expect(res.status).toBe(200);
    expect(res.body.data.idInventario).toBe(10001);
  });

  test('cada aprobacion siguiente recibe el proximo numero, en orden', async () => {
    const uno = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Primero' });
    const dos = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Segundo' });

    const resUno = await api(app)
      .patch(`/api/catalog/${uno.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });
    const resDos = await api(app)
      .patch(`/api/catalog/${dos.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    expect(resUno.body.data.idInventario).toBe(10001);
    expect(resDos.body.data.idInventario).toBe(10002);
  });

  test('rechazar un registro NO le asigna ID de inventario', async () => {
    const creado = await crearYEnviar(userToken, libroValido());

    const res = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'RECHAZAR', observaciones: 'Falta corregir el autor' });

    expect(res.status).toBe(200);
    expect(res.body.data.idInventario).toBeUndefined();
  });

  test('aprobar en lote tambien asigna un ID a cada registro', async () => {
    const uno = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Lote uno' });
    const dos = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Lote dos' });

    const res = await api(app)
      .patch('/api/catalog/aprobar-lote')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [uno.body.data._id, dos.body.data._id] });

    expect(res.status).toBe(200);
    expect(res.body.data.aprobados).toBe(2);

    const registros = await Catalog.find({ _id: { $in: [uno.body.data._id, dos.body.data._id] } });
    expect(registros.map((r) => r.idInventario).sort()).toEqual([10001, 10002]);
  });

  test('si la Manager vuelve a guardar un registro ya Aprobado, no le reasigna otro ID', async () => {
    const creado = await crearYEnviar(userToken, libroValido());
    await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const editado = await api(app)
      .patch(`/api/catalog/${creado.body.data._id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ autor: 'Autor Corregido' });

    expect(editado.status).toBe(200);
    expect(editado.body.data.idInventario).toBe(10001);
  });

  test('se puede buscar un registro aprobado por su ID de inventario', async () => {
    const creado = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Buscable por ID' });
    await api(app)
      .patch(`/api/catalog/${creado.body.data._id}/revisar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APROBAR' });

    const res = await api(app).get('/api/catalog?buscar=10001').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.registros.map((r) => r.titulo)).toContain('Buscable por ID');
  });
});

describe('Obtener un registro individual', () => {
  test('GET /api/catalog/:id devuelve el registro con sus datos poblados', async () => {
    const creado = await crearYEnviar(userToken, libroValido('INV-007'));

    const res = await api(app)
      .get(`/api/catalog/${creado.body.data._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
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
    expect(res.body.data.registros[0].titulo).toBe('Titulo de Prueba');
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

describe('Ordenamiento del catalogo (parametro sort)', () => {
  test('sort=titulo_asc alfabetiza sin importar mayusculas ni acentos', async () => {
    await crearYEnviar(adminToken, { ...libroValido('ORD-1'), titulo: 'banco de datos' });
    await crearYEnviar(adminToken, { ...libroValido('ORD-2'), titulo: 'Ábaco antiguo' });
    await crearYEnviar(adminToken, { ...libroValido('ORD-3'), titulo: 'Cielo abierto' });

    const res = await api(app).get('/api/catalog?sort=titulo_asc&limit=50').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const titulos = res.body.data.registros.map((r) => r.titulo);
    const indice = (t) => titulos.indexOf(t);
    // Sin la collation en español, Mongo pondria "Cielo abierto" (mayuscula) antes que
    // "banco de datos" (minuscula) por orden de codigo Unicode, no alfabetico real.
    expect(indice('Ábaco antiguo')).toBeLessThan(indice('banco de datos'));
    expect(indice('banco de datos')).toBeLessThan(indice('Cielo abierto'));
  });

  test('sort=anio_asc ordena del anio mas antiguo al mas nuevo', async () => {
    await crearYEnviar(adminToken, { ...libroValido('ORD-4'), anio: '2010' });
    await crearYEnviar(adminToken, { ...libroValido('ORD-5'), anio: '1990' });
    await crearYEnviar(adminToken, { ...libroValido('ORD-6'), anio: '2020' });

    const res = await api(app).get('/api/catalog?sort=anio_asc&limit=50').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.registros.map((r) => r.anio)).toEqual(['1990', '2010', '2020']);
  });

  test('un valor de sort desconocido no rompe la peticion (cae al orden por defecto)', async () => {
    await crearYEnviar(adminToken, libroValido('ORD-7'));

    const res = await api(app).get('/api/catalog?sort=algoQueNoExiste').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.registros).toHaveLength(1);
  });
});

describe('Paginacion agrupada por copias (GET /api/catalog)', () => {
  test('las copias de un mismo material siempre caen en la misma pagina, sin importar cuando se creo cada una', async () => {
    // 3 copias "viejas" del mismo libro, ya aprobadas.
    for (let i = 0; i < 3; i++) {
      const creado = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Libro Viejo En Stock', estadoFisico: `Copia vieja ${i + 1}` });
      await api(app).patch(`/api/catalog/${creado.body.data._id}/revisar`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APROBAR' });
    }

    // 3 materiales aparte (no son copias de nada), creados y aprobados despues.
    for (let i = 0; i < 3; i++) {
      const creado = await crearYEnviar(userToken, { ...libroValido(), titulo: `Libro Aparte ${i + 1}` });
      await api(app).patch(`/api/catalog/${creado.body.data._id}/revisar`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APROBAR' });
    }

    // Una 4ta copia del "Libro Viejo En Stock", recien registrada y aprobada - de los 7
    // documentos totales, es el mas reciente de todos.
    const nueva = await crearYEnviar(userToken, { ...libroValido(), titulo: 'Libro Viejo En Stock', estadoFisico: 'Copia nueva' });
    await api(app).patch(`/api/catalog/${nueva.body.data._id}/revisar`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APROBAR' });

    // Ordenando del mas nuevo al mas viejo, con solo 2 materiales por pagina: sin agrupar
    // antes de paginar, la pagina 1 traeria nada mas los 2 documentos mas recientes (esta
    // copia nueva + el ultimo "Libro Aparte"), dejando las 3 copias viejas del mismo libro
    // varadas en otra pagina - exactamente el problema reportado. Agrupando antes de paginar,
    // las 4 copias de "Libro Viejo En Stock" viajan juntas, aunque 3 sean mucho mas viejas.
    const res = await api(app)
      .get('/api/catalog?estadoRevision=APROBADO&sort=fecha_desc&limit=2&page=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4); // 4 materiales distintos: el libro con copias + 3 aparte
    const titulosEnPagina1 = res.body.data.registros.map((r) => r.titulo);
    expect(titulosEnPagina1.filter((t) => t === 'Libro Viejo En Stock')).toHaveLength(4);
  });
});
