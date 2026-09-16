require('./setupEnv');

const ExcelJS = require('exceljs');
const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const { hashPassword } = require('../helpers/password');
const { generateJWT } = require('../helpers/tokens');
const { ROLES, ESTADOS_REVISION } = require('../utils/constants');

let manager;
let admin;
let auxiliar;
let managerToken;
let adminToken;
let auxiliarToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();

  const passwordHash = await hashPassword('claveSegura123');
  [manager, admin, auxiliar] = await Promise.all([
    User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER }),
    User.create({ nombre: 'Supervisor', email: 'admin@usac.gt', passwordHash, rol: ROLES.ADMIN }),
    User.create({ nombre: 'Auxiliar', email: 'aux@usac.gt', passwordHash, rol: ROLES.USER, allowedCategories: ['LIBRO'] }),
  ]);

  managerToken = generateJWT(manager);
  adminToken = generateJWT(admin);
  auxiliarToken = generateJWT(auxiliar);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function construirExcelDePrueba() {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet('Libros');
  hoja.addRow([
    'No.',
    'Autor',
    'Titulo',
    'Idioma',
    'Año',
    'Edicion',
    'Editorial',
    'Lugar',
    'ISBN',
    'Tipo de documento',
    'Paginas impresas',
    'No. De Inventario',
    'Estado fisico',
    'Notas',
    'Copias',
    'Donante',
  ]);
  hoja.addRow([1, 'Autor Valido', 'Libro Valido Unico', 'Español', 2020, '1ra', 'Editorial X', 'Guatemala', '978-1', 'Fisico', 200, 'IMP-001', 'Buen estado', 'Sin notas', 1, '']);
  // Estas 3 filas son "el mismo libro" (autor+titulo+edicion+idioma) con variaciones tipicas
  // de Excel real: con/sin acento, mayusculas y espacios de mas, y estado fisico distinto -
  // deben agruparse solas en un item con copias:3, sin usar la columna "Copias" para nada.
  hoja.addRow([2, 'Jose Copias', 'Libro Con Copias', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, 'IMP-002', 'Buen estado', '', '', 'Donante X']);
  hoja.addRow([3, 'José Copias', 'Libro Con Copias', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, 'IMP-002B', 'Regular', '', '', '']);
  hoja.addRow([4, 'JOSE  COPIAS', '  Libro Con Copias ', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, 'IMP-002C', 'Deteriorado', '', '', '']);
  hoja.addRow([5, 'Autor Incompleto', 'Libro Sin ISBN', 'Español', 2018, '1ra', 'Editorial Z', 'Guatemala', '', 'Fisico', 100, '', 'Regular', '', '', '']);
  hoja.addRow([]); // fila vacia, debe ignorarse

  return workbook.xlsx.writeBuffer();
}

describe('POST /api/catalog/importar (previsualizar)', () => {
  test('un Auxiliar tambien puede previsualizar un Excel (no es exclusivo de Admin/Manager)', async () => {
    const buffer = await construirExcelDePrueba();
    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${auxiliarToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
  });

  test('responde 400 si no se sube ningun archivo', async () => {
    const res = await api(app).post('/api/catalog/importar').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(400);
  });

  test('rechaza archivos que no son Excel', async () => {
    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', Buffer.from('no es un excel'), 'prueba.txt');

    expect(res.status).toBe(400);
  });

  test('Admin y Manager pueden previsualizar un Excel real: detecta filas, copias, notas y errores', async () => {
    const buffer = await construirExcelDePrueba();
    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.data.totalItems).toBe(3);
    // Las 3 filas tienen autor y titulo, asi que las 3 son "validas" (importables) -
    // a la que le falta el ISBN se le rellena con N/A en vez de descartarla.
    expect(res.body.data.totalValidos).toBe(3);

    const hojaLibros = res.body.data.hojas.find((h) => h.categoria === 'LIBRO');
    expect(hojaLibros.items).toHaveLength(3);

    const valido = hojaLibros.items.find((i) => i.titulo === 'Libro Valido Unico');
    expect(valido.valido).toBe(true);
    expect(valido.noInventario).toBe('IMP-001');
    expect(valido.atributos.ISBN).toBe('978-1');
    expect(valido.estadoFisico).toBe('Buen estado - Sin notas');
    expect(valido.copias).toBe(1);
    expect(valido.camposFaltantes).toEqual([]);

    // Las 3 filas "Libro Con Copias" (con acento, sin acento, mayusculas/espacios de mas)
    // se agrupan solas como copias del mismo material - la columna "Copias" del Excel ya no
    // se usa para nada, y cada No. de Inventario real se conserva (no se pierden 2 de 3).
    const conCopias = hojaLibros.items.find((i) => i.titulo === 'Libro Con Copias');
    expect(conCopias.copias).toBe(3);
    expect(conCopias.filas).toHaveLength(3);
    expect(conCopias.noInventario).toBe('IMP-002');
    expect(conCopias.noInventarios).toEqual(['IMP-002', 'IMP-002B', 'IMP-002C']);

    const sinIsbn = hojaLibros.items.find((i) => i.titulo === 'Libro Sin ISBN');
    expect(sinIsbn.valido).toBe(true);
    expect(sinIsbn.atributos.ISBN).toBe('N/A');
    expect(sinIsbn.camposFaltantes).toEqual(['ISBN']);

    // "Donante" no es un campo conocido de LIBRO: se avisa en vez de perderse callado. "Copias"
    // si se reconoce (aunque ya no se use para nada), asi que no debe aparecer como desconocida.
    expect(hojaLibros.camposDesconocidos).toContain('donante');
    expect(hojaLibros.camposDesconocidos).not.toContain('copias');
  });

  test('si difieren en un campo que no sea estado fisico o No. de Inventario, NO son copias', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Idioma', 'Año', 'Edicion', 'Editorial', 'Lugar', 'ISBN', 'Tipo de documento', 'Paginas impresas']);
    // Mismo autor+titulo+edicion+idioma que antes bastaba para agrupar, pero el Año cambia -
    // son ediciones/impresiones distintas del mismo libro, no la misma copia fisica.
    hoja.addRow(['Autor Igual', 'Mismo Titulo', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150]);
    hoja.addRow(['Autor Igual', 'Mismo Titulo', 'Español', 2021, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150]);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    const items = res.body.data.hojas[0].items;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.copias === 1)).toBe(true);
  });

  test('un No. de Inventario escrito como "N/A" (o variantes) se trata como ausente, no como un valor real', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'No. De Inventario']);
    hoja.addRow(['Autor Uno', 'Libro Uno Sin Inventario Real', 'Ed', '1', 'Fisico', 'N/A']);
    hoja.addRow(['Autor Dos', 'Libro Dos Sin Inventario Real', 'Ed', '2', 'Fisico', 'n/a']);
    hoja.addRow(['Autor Tres', 'Libro Tres Sin Inventario Real', 'Ed', '3', 'Fisico', 'S/N']);
    const buffer = await workbook.xlsx.writeBuffer();

    const previsualizar = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(previsualizar.status).toBe(200);
    const items = previsualizar.body.data.hojas[0].items;
    expect(items.every((i) => !i.noInventario)).toBe(true);

    // Lo que de verdad importaba: que las 3 filas -todas "sin numero"- se puedan confirmar
    // juntas sin que la 2a y 3a choquen contra la 1a como si "N/A" fuera un numero repetido.
    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items, archivoOrigen: 'prueba.xlsx' });

    expect(confirmar.body.data.creados).toBe(3);
    expect(confirmar.body.data.errores).toHaveLength(0);
  });

  test('una celda con texto de formato mixto (rich text) se lee como texto plano, no como objeto', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'Lugar', 'ISBN', 'Tipo de documento', 'Estado fisico']);
    const fila = hoja.addRow([null, null, null, null, '978-1', 'Fisico', null]);
    // Asi guarda ExcelJS una celda donde una palabra esta en un color/formato distinto al
    // resto del texto (ej. copiado y pegado de otro documento) - varios "runs" en vez de un
    // solo texto plano. Es justo lo que trajo el Excel real que reporto el error.
    fila.getCell(1).value = { richText: [{ font: {}, text: 'Poder Judicial ' }, { font: { bold: true }, text: 'de la Nacion' }] };
    fila.getCell(2).value = { richText: [{ font: {}, text: 'Manual de Derecho ' }, { font: { bold: true }, text: 'Venezolano' }] };
    fila.getCell(3).value = { richText: [{ font: {}, text: 'Ofgloma, S.A. ' }, { font: {}, text: 'de C.V.' }] };
    fila.getCell(4).value = { richText: [{ font: {}, text: 'Estados Unidos,' }, { font: {}, text: ' Chicago' }] };
    fila.getCell(7).value = { richText: [{ font: {}, text: 'Buen estado' }, { font: {}, text: ' Es copia' }] };
    const buffer = await workbook.xlsx.writeBuffer();

    const previsualizar = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(previsualizar.status).toBe(200);
    const item = previsualizar.body.data.hojas[0].items[0];
    expect(item.autor).toBe('Poder Judicial de la Nacion');
    expect(item.titulo).toBe('Manual de Derecho Venezolano');
    expect(item.lugar).toBe('Estados Unidos, Chicago');
    expect(item.estadoFisico).toBe('Buen estado Es copia');
    expect(item.atributos.EDITORIAL).toBe('Ofgloma, S.A. de C.V.');

    // Y que de verdad se pueda guardar (antes esto tumbaba la fila con un CastError, o peor,
    // guardaba el texto literal "[object Object]").
    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [item], archivoOrigen: 'prueba.xlsx' });

    expect(confirmar.body.data.creados).toBe(1);
    expect(confirmar.body.data.errores).toHaveLength(0);

    const guardado = await Catalog.findOne({ titulo: 'Manual de Derecho Venezolano' });
    expect(guardado.autor).toBe('Poder Judicial de la Nacion');
    expect(guardado.atributos.EDITORIAL).toBe('Ofgloma, S.A. de C.V.');
  });

  test('una fila con titulo pero sin autor si queda invalida (eso no se rellena con N/A)', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['No.', 'Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento']);
    hoja.addRow([1, '', 'Titulo Sin Autor', 'Editorial X', '978-1', 'Fisico']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.data.totalItems).toBe(1);
    expect(res.body.data.totalValidos).toBe(0);
    expect(res.body.data.hojas[0].items[0].errores).toContain('Falta el autor');
  });

  test('una fila completamente vacia (sin autor ni titulo) se ignora por completo', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['No.', 'Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento']);
    hoja.addRow([1, '', '', 'Editorial X', '978-1', 'Fisico']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    // Sin ninguna fila utilizable en ninguna hoja, no hay nada que previsualizar.
    expect(res.status).toBe(400);
  });
});

describe('POST /api/catalog/importar/confirmar', () => {
  function itemValido(overrides = {}) {
    return {
      categoria: 'LIBRO',
      noInventario: 'IMP-CONF-1',
      autor: 'Autor Importado',
      titulo: 'Titulo Importado',
      idioma: 'Español',
      anio: '2020',
      edicion: '1ra',
      lugar: 'Guatemala',
      paginasImpresas: 100,
      estadoFisico: 'Buen estado',
      atributos: { EDITORIAL: 'Editorial X', ISBN: '978-1', TIPO_DE_DOCUMENTO: 'Fisico' },
      copias: 1,
      ...overrides,
    };
  }

  test('un Auxiliar puede confirmar una importacion en su categoria permitida', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${auxiliarToken}`)
      .send({ items: [itemValido()] }); // itemValido() es categoria LIBRO, y el auxiliar de prueba tiene allowedCategories: ['LIBRO']

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);

    const registro = await Catalog.findOne({ noInventario: 'IMP-CONF-1' });
    expect(registro.registradoPor.toString()).toBe(auxiliar._id.toString());
  });

  test('un Auxiliar NO puede confirmar una importacion en una categoria que no le asignaron', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${auxiliarToken}`)
      .send({
        items: [
          itemValido(), // LIBRO: si permitido
          itemValido({ categoria: 'REVISTA', noInventario: 'IMP-CONF-REV', titulo: 'Revista No Permitida', atributos: { EDITORIAL: 'E', ISSN: '1', VOLUMEN: '1' } }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
    expect(res.body.data.errores).toHaveLength(1);
    expect(res.body.data.errores[0].titulo).toBe('Revista No Permitida');
    expect(res.body.data.errores[0].error).toMatch(/no tienes permiso/i);

    expect(await Catalog.findOne({ noInventario: 'IMP-CONF-1' })).not.toBeNull();
    expect(await Catalog.findOne({ noInventario: 'IMP-CONF-REV' })).toBeNull();
  });

  test('rechaza la peticion si no hay items', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [] });

    expect(res.status).toBe(400);
  });

  test('guarda el nombre del archivo de origen para poder mostrarlo en vez de quien lo importo', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido()], archivoOrigen: 'Base_Ingreso - Gabriela.xlsx' });

    expect(res.status).toBe(200);

    const registro = await Catalog.findOne({ noInventario: 'IMP-CONF-1' });
    expect(registro.origenImportacion).toBe('Base_Ingreso - Gabriela.xlsx');
  });

  test('crea el registro como Pendiente pero ya enviado (visible para revisar, no autoaprobado)', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido()] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);

    const registro = await Catalog.findOne({ noInventario: 'IMP-CONF-1' });
    expect(registro.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE);
    expect(registro.enviado).toBe(true);
    expect(registro.registradoPor.toString()).toBe(manager._id.toString());
  });

  test('crea la cantidad de copias indicada; solo la primera se queda con el No. de Inventario', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido({ noInventario: 'IMP-CONF-2', titulo: 'Libro Con 3 Copias', copias: 3 })] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(3);

    const registros = await Catalog.find({ titulo: 'Libro Con 3 Copias' });
    expect(registros).toHaveLength(3);
    const conNumero = registros.filter((r) => r.noInventario);
    expect(conNumero).toHaveLength(1);
    expect(conNumero[0].noInventario).toBe('IMP-CONF-2');
  });

  test('si un item no trae copias (>1 desmarcado por el usuario), importa solo 1', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido({ noInventario: 'IMP-CONF-3', titulo: 'Libro Copias Desmarcadas', copias: 1 })] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
  });

  test('si el item trae noInventarios (filas agrupadas por copia), cada copia se queda con el suyo', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        items: [
          itemValido({
            titulo: 'Libro Con Inventarios Reales',
            copias: 3,
            noInventario: 'IMP-REAL-1',
            noInventarios: ['IMP-REAL-1', 'IMP-REAL-2', 'IMP-REAL-3'],
          }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(3);

    const registros = await Catalog.find({ titulo: 'Libro Con Inventarios Reales' }).sort({ noInventario: 1 });
    expect(registros.map((r) => r.noInventario)).toEqual(['IMP-REAL-1', 'IMP-REAL-2', 'IMP-REAL-3']);
  });

  test('si un No. de Inventario ya existe, reporta el error sin tumbar el resto del lote', async () => {
    await Catalog.create({
      categoria: 'LIBRO',
      noInventario: 'IMP-DUPLICADO',
      autor: 'Ya existe',
      titulo: 'Ya existe',
      atributos: { EDITORIAL: 'Ed', ISBN: '1', TIPO_DE_DOCUMENTO: 'Fisico' },
      registradoPor: manager._id,
      enviado: true,
    });

    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        items: [
          itemValido({ noInventario: 'IMP-DUPLICADO', titulo: 'Choca con el existente' }),
          itemValido({ noInventario: 'IMP-CONF-4', titulo: 'Este si entra' }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
    expect(res.body.data.errores).toHaveLength(1);
    expect(res.body.data.errores[0].titulo).toBe('Choca con el existente');
  });
});
