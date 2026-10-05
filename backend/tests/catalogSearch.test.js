require('./setupEnv');

const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ESTADOS_REVISION } = require('../utils/constants');
const { construirFiltroBusqueda, etiquetaModoBusqueda } = require('../helpers/catalogSearch');

let managerToken;
let managerId;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();
  const manager = await User.create({
    nombre: 'Jefatura',
    email: 'manager@usac.gt',
    passwordHash: await hashPassword('claveSegura123'),
    rol: ROLES.MANAGER,
  });
  managerToken = generateJWT(manager);
  managerId = manager._id;

  const registros = [
    { idInventario: '20F', titulo: 'Libro Alfa', autor: 'Zoe Perez' },
    { idInventario: '20F-C1', titulo: 'Libro Alfa', autor: 'Zoe Perez' },
    // El titulo contiene "20F" pero su ID no: solo la busqueda "en todo" o "en titulo" lo encuentra.
    { idInventario: '5L', titulo: 'Tratado 20F de algo', autor: 'Ana Gomez' },
    { idInventario: '45-SDE', titulo: 'Enciclopedia Juridica', autor: 'Pedro Ruiz' },
  ];
  for (const datos of registros) {
    await Catalog.create({
      categoria: 'LIBRO',
      ...datos,
      atributos: { EDITORIAL: 'Ed' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });
  }
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function buscarIds(query) {
  const res = await api(app).get(`/api/catalog?limit=50&${query}`).set('Authorization', `Bearer ${managerToken}`);
  expect(res.status).toBe(200);
  return res.body.data.registros.map((r) => r.idInventario).sort();
}

describe('Buscar en... (todo, ID, ID exacto, titulo, autor)', () => {
  test('"todo" (el de siempre) busca en titulo, autor e ID a la vez', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=todo')).toEqual(['20F', '20F-C1', '5L']);
  });

  test('sin buscarEn, o con un valor desconocido, se comporta como "todo"', async () => {
    expect(await buscarIds('buscar=20F')).toEqual(['20F', '20F-C1', '5L']);
    expect(await buscarIds('buscar=20F&buscarEn=loQueSea')).toEqual(['20F', '20F-C1', '5L']);
  });

  test('"ID (contiene)" solo mira el ID: encuentra el ejemplar y sus copias, no un titulo que mencione el texto', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=id')).toEqual(['20F', '20F-C1']);
  });

  test('"ID (contiene)" tambien sirve para buscar por sello o tipo (ej. SDE)', async () => {
    expect(await buscarIds('buscar=sde&buscarEn=id')).toEqual(['45-SDE']);
  });

  test('"ID exacto" encuentra solo ese ID (no sus copias), sin importar mayusculas ni espacios de mas', async () => {
    expect(await buscarIds('buscar=20f&buscarEn=id_exacto')).toEqual(['20F']);
    expect(await buscarIds('buscar=%2020f%20&buscarEn=id_exacto')).toEqual(['20F']);
    expect(await buscarIds('buscar=20&buscarEn=id_exacto')).toEqual([]);
  });

  test('"Titulo" solo mira el titulo', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=titulo')).toEqual(['5L']);
  });

  test('"Autor" solo mira el autor', async () => {
    expect(await buscarIds('buscar=zoe&buscarEn=autor')).toEqual(['20F', '20F-C1']);
    expect(await buscarIds('buscar=Libro Alfa&buscarEn=autor')).toEqual([]);
  });

  test('el PDF respeta el mismo filtro: con "ID" encuentra por sello, con "Titulo" no hay coincidencias (404)', async () => {
    const conId = await api(app)
      .get('/api/exports/catalog?buscar=SDE&buscarEn=id')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(conId.status).toBe(200);

    const conTitulo = await api(app)
      .get('/api/exports/catalog?buscar=SDE&buscarEn=titulo')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(conTitulo.status).toBe(404);
  });
});

describe('Buscar en varios campos a la vez (casillas del panel de filtros)', () => {
  test('ID y Titulo marcados: encuentra por cualquiera de los dos, pero no por autor', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=id,titulo')).toEqual(['20F', '20F-C1', '5L']);
    expect(await buscarIds('buscar=zoe&buscarEn=id,titulo')).toEqual([]);
  });

  test('Titulo y Autor marcados: no mira el ID', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=titulo,autor')).toEqual(['5L']);
    expect(await buscarIds('buscar=zoe&buscarEn=titulo,autor')).toEqual(['20F', '20F-C1']);
  });

  test('ID exacto junto con Titulo: el ID tiene que ser ese, el titulo basta que lo contenga', async () => {
    expect(await buscarIds('buscar=20f&buscarEn=id_exacto,titulo')).toEqual(['20F', '5L']);
  });

  test('si llegan "id" e "id_exacto" a la vez, manda el exacto', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=id,id_exacto')).toEqual(['20F']);
  });

  test('el orden de la lista no importa, y lo desconocido se ignora', async () => {
    expect(await buscarIds('buscar=20F&buscarEn=titulo,id')).toEqual(['20F', '20F-C1', '5L']);
    expect(await buscarIds('buscar=zoe&buscarEn=autor,loQueSea')).toEqual(['20F', '20F-C1']);
  });
});

describe('Filtro de varias categorias y estados (casillas del panel de filtros)', () => {
  beforeEach(async () => {
    const base = { atributos: { EDITORIAL: 'Ed' }, enviado: true, registradoPor: managerId };
    await Catalog.create({
      ...base,
      atributos: { EDITORIAL: 'Ed', VOLUMEN: '1' },
      categoria: 'REVISTA',
      idInventario: '9R',
      titulo: 'Revista Uno',
      autor: 'Luis Soto',
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });
    await Catalog.create({ ...base, categoria: 'LIBRO', idInventario: '7L', titulo: 'Libro Pendiente', autor: 'Eva Mena', estadoRevision: ESTADOS_REVISION.PENDIENTE });
    await Catalog.create({ ...base, categoria: 'LIBRO', idInventario: '8L', titulo: 'Libro De Baja', autor: 'Mia Lara', estadoRevision: ESTADOS_REVISION.APROBADO, deBaja: true });
  });

  test('una categoria, varias categorias o ninguna (todas)', async () => {
    expect(await buscarIds('categoria=REVISTA')).toEqual(['9R']);
    expect(await buscarIds('categoria=REVISTA,LIBRO')).toEqual(['20F', '20F-C1', '45-SDE', '5L', '7L', '8L', '9R'].sort());
    expect(await buscarIds('categoria=FOLLETO,REVISTA')).toEqual(['9R']);
    expect(await buscarIds('')).toHaveLength(7);
  });

  test('un estado, varios estados, o "De baja" mezclado con los de revision', async () => {
    expect(await buscarIds('estadoRevision=PENDIENTE')).toEqual(['7L']);
    expect(await buscarIds('estadoRevision=PENDIENTE,APROBADO')).toHaveLength(7);
    expect(await buscarIds('estadoRevision=DE_BAJA')).toEqual(['8L']);
    expect(await buscarIds('estadoRevision=DE_BAJA,PENDIENTE')).toEqual(['7L', '8L']);
  });

  test('categoria, estado y busqueda se combinan', async () => {
    expect(await buscarIds('categoria=LIBRO&estadoRevision=PENDIENTE,DE_BAJA&buscar=libro&buscarEn=titulo')).toEqual(['7L', '8L']);
    expect(await buscarIds('categoria=REVISTA&estadoRevision=PENDIENTE')).toEqual([]);
  });

  test('un operador de Mongo disfrazado de categoria ("categoria[$ne]=") no filtra: se ignora', async () => {
    expect(await buscarIds('categoria[$ne]=LIBRO')).toHaveLength(7);
  });

  test('el PDF acepta las mismas listas (categorias, estados mezclados con "De baja")', async () => {
    const res = await api(app)
      .get('/api/exports/catalog?categoria=LIBRO,REVISTA&estadoRevision=DE_BAJA,PENDIENTE')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    const sinResultados = await api(app)
      .get('/api/exports/catalog?categoria=FOLLETO&estadoRevision=DE_BAJA,PENDIENTE')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(sinResultados.status).toBe(404);
  });
});

describe('construirFiltroBusqueda', () => {
  test('con varios campos basta que coincida en uno ($or); con uno solo es la condicion directa', () => {
    const filtro = construirFiltroBusqueda('x', 'id,autor');
    expect(filtro.$or).toHaveLength(2);
    expect(Object.keys(filtro.$or[0])).toEqual(['idInventario']);
    expect(Object.keys(filtro.$or[1])).toEqual(['autor']);
    expect(Object.keys(construirFiltroBusqueda('x', 'autor'))).toEqual(['autor']);
  });

  test('sin texto no hay nada que filtrar', () => {
    expect(construirFiltroBusqueda('', 'id')).toBeNull();
    expect(construirFiltroBusqueda('   ', 'todo')).toBeNull();
    expect(construirFiltroBusqueda(undefined, 'titulo')).toBeNull();
  });

  test('"ID exacto" compara contra el ID normalizado (mayusculas y espacios), igual que se guarda', () => {
    expect(construirFiltroBusqueda(' 20-f   c1 ', 'id_exacto')).toEqual({ idInventario: '20-F C1' });
  });

  test('los caracteres especiales del texto no rompen la busqueda', () => {
    const filtro = construirFiltroBusqueda('a.*(b', 'titulo');
    expect(filtro.titulo.test('a.*(b')).toBe(true);
    expect(filtro.titulo.test('aXXb')).toBe(false);
  });

  test('etiquetaModoBusqueda describe el modo (y cae a "todo" si es desconocido)', () => {
    expect(etiquetaModoBusqueda('id_exacto')).toBe('ID exacto');
    expect(etiquetaModoBusqueda('???')).toBe('titulo, autor o ID');
  });

  test('etiquetaModoBusqueda con varios campos los nombra en orden (ID, titulo, autor)', () => {
    expect(etiquetaModoBusqueda('titulo,id')).toBe('ID o titulo');
    expect(etiquetaModoBusqueda('autor,titulo,id_exacto')).toBe('ID exacto, titulo o autor');
    expect(etiquetaModoBusqueda('id,titulo,autor')).toBe('titulo, autor o ID');
  });
});
