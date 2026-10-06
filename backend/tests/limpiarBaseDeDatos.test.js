require('./setupEnv');

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const Audit = require('../src/audit/audit_model');
const { hashPassword } = require('../helpers/password');
const { ROLES, ESTADOS_REVISION, ACCIONES_AUDITORIA } = require('../utils/constants');
const { limpiarBaseDeDatos } = require('../scripts/limpiarBaseDeDatos');

let manager;
let directorioRespaldo;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();
  manager = await User.create({
    nombre: 'Jefatura',
    email: 'manager@usac.gt',
    passwordHash: await hashPassword('claveSegura123'),
    rol: ROLES.MANAGER,
  });
  await mongoose.connection.collection('invitations').insertOne({ email: 'nuevo@usac.gt' });

  for (const idInventario of ['1L', '2L', '3L']) {
    const item = await Catalog.create({
      categoria: 'LIBRO',
      idInventario,
      autor: 'Autor',
      titulo: `Titulo ${idInventario}`,
      atributos: { EDITORIAL: 'Ed' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });
    await Audit.create({ accion: ACCIONES_AUDITORIA.CREAR, entidad: 'Catalog', entidadId: item._id, usuario: manager._id });
  }

  directorioRespaldo = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-limpieza-'));
});

afterEach(async () => {
  await clearDatabase();
  fs.rmSync(directorioRespaldo, { recursive: true, force: true });
});

afterAll(async () => {
  await closeDatabase();
});

describe('scripts/limpiarBaseDeDatos', () => {
  test('sin confirmar es una prueba en seco: cuenta lo que hay pero no borra ni escribe nada', async () => {
    const resultado = await limpiarBaseDeDatos({ directorioRespaldo });

    expect(resultado.antes).toMatchObject({ catalogs: 3, audits: 3 });
    expect(resultado.respaldo).toBeNull();
    expect(resultado.borrados).toBeNull();
    expect(await Catalog.countDocuments({})).toBe(3);
    expect(await Audit.countDocuments({})).toBe(3);
    expect(fs.readdirSync(directorioRespaldo)).toHaveLength(0);
  });

  test('con confirmar guarda un respaldo completo y despues borra catalogo y auditoria', async () => {
    const resultado = await limpiarBaseDeDatos({ confirmar: true, directorioRespaldo });

    expect(resultado.borrados).toMatchObject({ catalogs: 3, audits: 3 });
    expect(await Catalog.countDocuments({})).toBe(0);
    expect(await Audit.countDocuments({})).toBe(0);

    const catalogoRespaldado = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'catalogs.json'), 'utf8'));
    expect(catalogoRespaldado.map((r) => r.idInventario).sort()).toEqual(['1L', '2L', '3L']);
    const auditoriaRespaldada = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'audits.json'), 'utf8'));
    expect(auditoriaRespaldada).toHaveLength(3);
  });

  test('conserva usuarios, categorias e invitaciones (sin usuarios nadie podria iniciar sesion)', async () => {
    await limpiarBaseDeDatos({ confirmar: true, directorioRespaldo });

    expect(await User.countDocuments({})).toBe(1);
    expect(await mongoose.connection.collection('categories').countDocuments({})).toBeGreaterThan(0);
    expect(await mongoose.connection.collection('invitations').countDocuments({})).toBe(1);
  });
});

describe('scripts/limpiarBaseDeDatos con vaciarInvitaciones (todos los usuarios se quedan)', () => {
  test('vacia catalogo, auditoria e invitaciones, y conserva a todos los usuarios y las categorias', async () => {
    await User.create({ nombre: 'Otra Persona', email: 'otra@usac.gt', passwordHash: await hashPassword('claveSegura123'), rol: ROLES.USER });

    const resultado = await limpiarBaseDeDatos({ confirmar: true, directorioRespaldo, vaciarInvitaciones: true });

    expect(resultado.plan).toBeNull();
    expect(resultado.borrados).toMatchObject({ catalogs: 3, audits: 3, invitations: 1 });
    expect(resultado.borrados.users).toBeUndefined();
    expect(await Catalog.countDocuments({})).toBe(0);
    expect(await mongoose.connection.collection('invitations').countDocuments({})).toBe(0);
    expect(await User.countDocuments({})).toBe(2);
    expect(await mongoose.connection.collection('categories').countDocuments({})).toBeGreaterThan(0);
    // El respaldo incluye las invitaciones que se borraron.
    const invitaciones = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'invitations.json'), 'utf8'));
    expect(invitaciones).toHaveLength(1);
  });

  test('en seco cuenta las invitaciones pero no borra nada', async () => {
    const resultado = await limpiarBaseDeDatos({ directorioRespaldo, vaciarInvitaciones: true });

    expect(resultado.antes).toMatchObject({ catalogs: 3, audits: 3, invitations: 1 });
    expect(await mongoose.connection.collection('invitations').countDocuments({})).toBe(1);
  });
});

describe('scripts/limpiarBaseDeDatos con conservarUsuarios (dejar solo algunos usuarios)', () => {
  const usuarioPorDefecto = { email: 'manager@usac.gt', nombre: 'Jefatura' };
  let anderson;
  let adaly;

  async function crearUsuario(nombre, email, rol = ROLES.USER) {
    return User.create({ nombre, email, passwordHash: await hashPassword('claveSegura123'), rol });
  }

  beforeEach(async () => {
    anderson = await crearUsuario('Anderson Lopez', 'anderson@usac.gt', ROLES.ADMIN);
    adaly = await crearUsuario('Adaly Mejia', 'adaly@usac.gt');
    await crearUsuario('Pedro Otro', 'pedro@usac.gt');
    await crearUsuario('Maria Aparte', 'maria@usac.gt');
  });

  const nombresDeUsuarios = async () => (await User.find({})).map((u) => u.nombre).sort();

  test('en seco muestra a quien conservaria y a quien borraria, sin tocar nada', async () => {
    const resultado = await limpiarBaseDeDatos({ directorioRespaldo, usuarioPorDefecto, conservarUsuarios: ['anderson', 'adaly'] });

    expect(resultado.plan.conservar.map((u) => u.nombre).sort()).toEqual(['Adaly Mejia', 'Anderson Lopez', 'Jefatura']);
    expect(resultado.plan.eliminar.map((u) => u.nombre).sort()).toEqual(['Maria Aparte', 'Pedro Otro']);
    expect(resultado.plan.problemas).toEqual([]);
    expect(await User.countDocuments({})).toBe(5);
    expect(fs.readdirSync(directorioRespaldo)).toHaveLength(0);
  });

  test('con confirmar deja solo el usuario por defecto y los indicados; vacia catalogo, auditoria e invitaciones y conserva las categorias', async () => {
    const resultado = await limpiarBaseDeDatos({
      confirmar: true,
      directorioRespaldo,
      usuarioPorDefecto,
      conservarUsuarios: ['anderson', 'adaly'],
    });

    expect(await nombresDeUsuarios()).toEqual(['Adaly Mejia', 'Anderson Lopez', 'Jefatura']);
    expect(await Catalog.countDocuments({})).toBe(0);
    expect(await Audit.countDocuments({})).toBe(0);
    expect(await mongoose.connection.collection('invitations').countDocuments({})).toBe(0);
    expect(await mongoose.connection.collection('categories').countDocuments({})).toBeGreaterThan(0);
    expect(resultado.borrados).toMatchObject({ catalogs: 3, audits: 3, invitations: 1, users: 2 });
  });

  test('antes de borrar guarda un respaldo tambien de los usuarios y las invitaciones', async () => {
    const resultado = await limpiarBaseDeDatos({
      confirmar: true,
      directorioRespaldo,
      usuarioPorDefecto,
      conservarUsuarios: ['anderson', 'adaly'],
    });

    const usuariosRespaldados = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'users.json'), 'utf8'));
    expect(usuariosRespaldados.map((u) => u.nombre).sort()).toEqual(['Adaly Mejia', 'Anderson Lopez', 'Jefatura', 'Maria Aparte', 'Pedro Otro']);
    const invitacionesRespaldadas = JSON.parse(fs.readFileSync(path.join(resultado.respaldo, 'invitations.json'), 'utf8'));
    expect(invitacionesRespaldadas).toHaveLength(1);
  });

  test('tambien se puede indicar el correo completo, y no importan mayusculas ni acentos', async () => {
    await limpiarBaseDeDatos({
      confirmar: true,
      directorioRespaldo,
      usuarioPorDefecto,
      conservarUsuarios: ['ANDERSON@usac.gt', 'ádaly'],
    });

    expect(await nombresDeUsuarios()).toEqual(['Adaly Mejia', 'Anderson Lopez', 'Jefatura']);
  });

  test('si un nombre no coincide con nadie, no se borra nada (ni se escribe respaldo)', async () => {
    await expect(
      limpiarBaseDeDatos({ confirmar: true, directorioRespaldo, usuarioPorDefecto, conservarUsuarios: ['anderson', 'fulano'] })
    ).rejects.toThrow(/fulano/);

    expect(await User.countDocuments({})).toBe(5);
    expect(await Catalog.countDocuments({})).toBe(3);
    expect(fs.readdirSync(directorioRespaldo)).toHaveLength(0);
  });

  test('si un nombre coincide con varios usuarios, no se borra nada: hay que escribir el correo completo', async () => {
    await crearUsuario('Anderson Segundo', 'anderson2@usac.gt');

    await expect(
      limpiarBaseDeDatos({ confirmar: true, directorioRespaldo, usuarioPorDefecto, conservarUsuarios: ['anderson', 'adaly'] })
    ).rejects.toThrow(/anderson.*2 usuarios/);

    expect(await User.countDocuments({})).toBe(6);
    expect(await Catalog.countDocuments({})).toBe(3);
  });

  test('si no quedaria ningun Manager, no se borra nada (nadie podria administrar el sistema)', async () => {
    await expect(
      limpiarBaseDeDatos({
        confirmar: true,
        directorioRespaldo,
        usuarioPorDefecto: { email: 'noexiste@usac.gt', nombre: 'noexiste' },
        conservarUsuarios: ['anderson', 'adaly'],
      })
    ).rejects.toThrow(/Manager/);

    expect(await User.countDocuments({})).toBe(5);
    expect(await Catalog.countDocuments({})).toBe(3);
  });
});
