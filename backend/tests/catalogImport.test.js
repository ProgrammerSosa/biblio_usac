require('./setupEnv');

const ExcelJS = require('exceljs');
const { connect, closeDatabase, clearDatabase } = require('./helpers/testDb');
const { seedCategoriasDePrueba } = require('./helpers/seedCategorias');
const { api } = require('./helpers/apiClient');
const app = require('../server');
const User = require('../src/users/user_model');
const Catalog = require('../src/catalog/catalog_model');
const Category = require('../src/catalog/category_model');
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

  // Estas pruebas de importacion usan "ISBN" y "Tipo de documento" como ejemplo de campos
  // propios de LIBRO (uno obligatorio, para probar el relleno con N/A y "campos faltantes").
  // La categoria LIBRO real ya no los tiene (se simplifico desde Gestion de Categorias), asi
  // que se restauran aqui solo para este archivo, sin tocar el seed compartido con el resto
  // de la app.
  await Category.updateOne(
    { clave: 'LIBRO' },
    {
      $set: {
        campos: [
          { clave: 'EDITORIAL', etiqueta: 'Editorial', requerido: false },
          { clave: 'ISBN', etiqueta: 'ISBN', requerido: true },
          { clave: 'TIPO_DE_DOCUMENTO', etiqueta: 'Tipo de documento', requerido: false },
        ],
      },
    }
  );

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
    'ID',
    'Estado fisico',
    'Notas',
    'Copias',
    'Donante',
  ]);
  // La columna "Copias" se ignora a proposito (ver excelImport.js) - un valor cualquiera aqui
  // no debe cambiar nada; lo que cuenta son filas identicas fusionadas (ver mas abajo).
  hoja.addRow([1, 'Autor Valido', 'Libro Valido Unico', 'Español', 2020, '1ra', 'Editorial X', 'Guatemala', '978-1', 'Fisico', 200, '1L', 'Buen estado', 'Sin notas', 9, '']);
  // Estas 3 filas son "el mismo libro" (autor+titulo+edicion+idioma) con variaciones tipicas
  // de Excel real: con/sin acento, mayusculas y espacios de mas, y estado fisico distinto -
  // deben agruparse solas en un item con copias:3 (una fila = un ejemplar fisico).
  hoja.addRow([2, 'Jose Copias', 'Libro Con Copias', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, '2L', 'Buen estado', '', '', 'Donante X']);
  hoja.addRow([3, 'José Copias', 'Libro Con Copias', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, '2L-C1', 'Regular', '', '', '']);
  hoja.addRow([4, 'JOSE  COPIAS', '  Libro Con Copias ', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, '2L-C2', 'Deteriorado', '', '', '']);
  hoja.addRow([5, 'Autor Incompleto', 'Libro Sin ISBN', 'Español', 2018, '1ra', 'Editorial Z', 'Guatemala', '', 'Fisico', 100, '3L', 'Regular', '', '', '']);
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
    expect(valido.atributos.ISBN).toBe('978-1');
    expect(valido.estadoFisico).toBe('Buen estado - Sin notas');
    expect(valido.copias).toBe(1);
    expect(valido.camposFaltantes).toEqual([]);
    expect(valido.idInventario).toBe('1L');

    // Las 3 filas "Libro Con Copias" (con acento, sin acento, mayusculas/espacios de mas)
    // se agrupan solas como copias del mismo material - una fila = un ejemplar fisico, y cada
    // una conserva el ID de su propia fila del Excel.
    const conCopias = hojaLibros.items.find((i) => i.titulo === 'Libro Con Copias');
    expect(conCopias.copias).toBe(3);
    expect(conCopias.filas).toHaveLength(3);
    expect(conCopias.ids).toEqual(['2L', '2L-C1', '2L-C2']);

    const sinIsbn = hojaLibros.items.find((i) => i.titulo === 'Libro Sin ISBN');
    expect(sinIsbn.valido).toBe(true);
    expect(sinIsbn.atributos.ISBN).toBe('N/A');
    expect(sinIsbn.camposFaltantes).toEqual(['ISBN']);

    // "Donante" no es un campo conocido de LIBRO: se avisa en vez de perderse callado. "Copias"
    // se reconoce pero se ignora a proposito, y "ID" es el ID del registro, asi que ninguna de
    // las dos debe aparecer como columna desconocida.
    expect(hojaLibros.camposDesconocidos).toContain('donante');
    expect(hojaLibros.camposDesconocidos).not.toContain('copias');
    expect(hojaLibros.camposDesconocidos).not.toContain('id');
  });

  test('la columna "Copias" del Excel se ignora - las copias se detectan agrupando filas identicas', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'Copias', 'ID']);
    // El valor de "Copias" (4) no debe usarse para nada: como es una sola fila, cuenta como 1
    // solo ejemplar, sin importar lo que diga esa columna.
    hoja.addRow(['Autor Copias', 'Libro Con Columna Copias', 'Ed', '1', 'Fisico', 4, 'CP-1']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    const items = res.body.data.hojas[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].filas).toHaveLength(1);
    expect(items[0].copias).toBe(1);

    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items, archivoOrigen: 'prueba.xlsx' });

    expect(confirmar.body.data.creados).toBe(1);
  });

  test('varias filas identicas (mismos datos, distinto estado fisico) se detectan como copias sin declarar cantidad', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'Estado fisico', 'ID']);
    hoja.addRow(['Autor Stock', 'Libro En Stock', 'Ed', '1', 'Fisico', 'Buen estado', '30L']);
    hoja.addRow(['Autor Stock', 'Libro En Stock', 'Ed', '1', 'Fisico', 'Buen estado', '30L-C1']);
    hoja.addRow(['Autor Stock', 'Libro En Stock', 'Ed', '1', 'Fisico', 'Buen estado', '30L-C2']);
    hoja.addRow(['Autor Stock', 'Libro En Stock', 'Ed', '1', 'Fisico', 'Buen estado', '30L-C3']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    const items = res.body.data.hojas[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].copias).toBe(4);
    expect(items[0].filas).toHaveLength(4);

    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items, archivoOrigen: 'prueba.xlsx' });

    expect(confirmar.body.data.creados).toBe(4);
  });

  test('si difieren en un campo que no sea estado fisico o el ID, NO son copias', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Idioma', 'Año', 'Edicion', 'Editorial', 'Lugar', 'ISBN', 'Tipo de documento', 'Paginas impresas', 'ID']);
    // Mismo autor+titulo+edicion+idioma que antes bastaba para agrupar, pero el Año cambia -
    // son ediciones/impresiones distintas del mismo libro, no la misma copia fisica.
    hoja.addRow(['Autor Igual', 'Mismo Titulo', 'Español', 2019, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, 'DIF-1']);
    hoja.addRow(['Autor Igual', 'Mismo Titulo', 'Español', 2021, '2da', 'Editorial Y', 'Guatemala', '978-2', 'Fisico', 150, 'DIF-2']);
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

  test('el ID de cada registro sale de la columna ID del Excel (tambien se reconoce "No. De Inventario"), tal cual lo escribieron', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'No. De Inventario']);
    hoja.addRow(['Autor Uno', 'Libro Uno Con ID', 'Ed', '1', 'Fisico', '20f']);
    hoja.addRow(['Autor Dos', 'Libro Dos Con ID', 'Ed', '2', 'Fisico', ' SHL-3 ']);
    const buffer = await workbook.xlsx.writeBuffer();

    const previsualizar = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(previsualizar.status).toBe(200);
    const items = previsualizar.body.data.hojas[0].items;
    // Se guardan en mayusculas y sin espacios de mas.
    expect(items.map((i) => i.idInventario)).toEqual(['20F', 'SHL-3']);

    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items, archivoOrigen: 'prueba.xlsx' });

    expect(confirmar.body.data.creados).toBe(2);
    expect(confirmar.body.data.errores).toHaveLength(0);

    const guardados = await Catalog.find({ titulo: { $in: ['Libro Uno Con ID', 'Libro Dos Con ID'] } });
    expect(guardados.map((g) => g.idInventario).sort()).toEqual(['20F', 'SHL-3']);
  });

  test('los registros se crean en el orden exacto de las filas del Excel, aunque una copia este lejos de su original', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['ID', 'Autor', 'Titulo']);
    hoja.addRow(['1L', 'Autor A', 'Libro A']); // fila 2
    hoja.addRow(['2L', 'Autor B', 'Libro B']); // fila 3
    hoja.addRow(['3L', 'Autor C', 'Libro C']); // fila 4
    hoja.addRow(['1L-C1', 'Autor A', 'Libro A']); // fila 5: copia de A, pero esta al final del Excel
    const buffer = await workbook.xlsx.writeBuffer();

    const previsualizar = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');
    const items = previsualizar.body.data.hojas[0].items;
    // La vista previa si junta la copia con su original (un solo material con 2 ejemplares)...
    expect(items).toHaveLength(3);

    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items, archivoOrigen: 'prueba.xlsx' });
    expect(confirmar.body.data.creados).toBe(4);

    // ...pero al guardar se respeta el orden de las filas: A, B, C y al final la copia de A.
    const guardados = await Catalog.find({}).sort({ createdAt: 1, _id: 1 });
    expect(guardados.map((g) => g.idInventario)).toEqual(['1L', '2L', '3L', '1L-C1']);
  });

  test('el ID es obligatorio: una fila sin ID queda invalida, no se marca para importar y avisa "Falta el ID"', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['ID', 'Autor', 'Titulo']);
    hoja.addRow(['40L', 'Autor Con ID', 'Libro Con ID']);
    hoja.addRow(['', 'Autor Sin ID', 'Libro Sin ID']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.data.totalItems).toBe(2);
    expect(res.body.data.totalValidos).toBe(1);
    const sinId = res.body.data.hojas[0].items.find((i) => i.titulo === 'Libro Sin ID');
    expect(sinId.valido).toBe(false);
    expect(sinId.errores).toContain('Falta el ID');
  });

  test('un ID repetido dentro del mismo Excel (aunque sea en otra hoja) se marca en la segunda fila', async () => {
    const workbook = new ExcelJS.Workbook();
    const libros = workbook.addWorksheet('Libros');
    libros.addRow(['ID', 'Autor', 'Titulo']);
    libros.addRow(['50L', 'Autor Uno', 'Primer Libro']);
    const revistas = workbook.addWorksheet('Revistas');
    revistas.addRow(['ID', 'Autor', 'Titulo']);
    revistas.addRow(['50l', 'Autor Dos', 'Una Revista']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    const primero = res.body.data.hojas.find((h) => h.categoria === 'LIBRO').items[0];
    const segundo = res.body.data.hojas.find((h) => h.categoria === 'REVISTA').items[0];
    expect(primero.valido).toBe(true);
    expect(segundo.valido).toBe(false);
    expect(segundo.errores.join(' ')).toContain('ID repetido en el Excel');
    expect(segundo.errores.join(' ')).toContain('Libros');
  });

  test('un ID que ya existe en el catalogo se marca como invalido (no se vuelve a importar)', async () => {
    await Catalog.create({
      categoria: 'LIBRO',
      idInventario: '60L',
      autor: 'Autor Ya Registrado',
      titulo: 'Libro Ya Registrado',
      atributos: { EDITORIAL: 'Ed', ISBN: '1' },
      registradoPor: manager._id,
    });

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['ID', 'Autor', 'Titulo']);
    hoja.addRow(['60L', 'Autor Nuevo', 'Libro Con ID Repetido']);
    hoja.addRow(['61L', 'Autor Nuevo', 'Libro Con ID Libre']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    const items = res.body.data.hojas[0].items;
    const repetido = items.find((i) => i.titulo === 'Libro Con ID Repetido');
    const libre = items.find((i) => i.titulo === 'Libro Con ID Libre');
    expect(repetido.valido).toBe(false);
    expect(repetido.errores.join(' ')).toContain('60L ya existe');
    expect(libre.valido).toBe(true);
  });

  test('si la categoria ya tiene su propio campo "Notas", la columna "Notas" del Excel llena ese campo (no se pega a Estado fisico)', async () => {
    // Antes, la columna "Notas" del Excel siempre se pegaba al final de "Estado fisico" sin
    // importar nada mas - eso tenia sentido cuando "Notas" no era un campo real de ninguna
    // categoria, pero si la categoria ya definio su propio atributo "Notas" (como aqui), ese
    // campo debe mandar: el texto va ahi, estructurado, no mezclado a ciegas con el estado
    // fisico del ejemplar.
    await Category.updateOne({ clave: 'LIBRO' }, { $push: { campos: { clave: 'NOTAS', etiqueta: 'Notas', requerido: false } } });

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'Estado fisico', 'Notas', 'ID']);
    hoja.addRow(['Autor Notas', 'Libro Con Campo De Notas', 'Ed', '1', 'Fisico', 'Buen estado', 'Es el numero 5 de la coleccion', 'NT-1']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    const item = res.body.data.hojas[0].items[0];
    expect(item.estadoFisico).toBe('Buen estado');
    expect(item.atributos.NOTAS).toBe('Es el numero 5 de la coleccion');
  });

  test('si la categoria ya NO tiene un campo (ej. se quito "Tipo de documento"), esa columna del Excel se avisa como desconocida en vez de fallar al confirmar', async () => {
    // Antes, el alias fijo "tipo de documento" -> TIPO_DE_DOCUMENTO se aplicaba sin importar
    // si la categoria todavia tenia ese campo - si ya no lo tenia (lo cambiaste por otro en
    // Gestion de Categorias), la vista previa igual guardaba el valor ahi, y el guardado real
    // fallaba con "el campo no aplica para la categoria" sin que la vista previa avisara nada.
    await Category.updateOne({ clave: 'LIBRO' }, { $pull: { campos: { clave: 'TIPO_DE_DOCUMENTO' } } });

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'ID']);
    hoja.addRow(['Autor Sin Tipo', 'Libro Sin Tipo De Documento', 'Ed', '1', 'Fisico', 'ST-1']);
    const buffer = await workbook.xlsx.writeBuffer();

    const previsualizar = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(previsualizar.status).toBe(200);
    const hoja0 = previsualizar.body.data.hojas[0];
    expect(hoja0.camposDesconocidos).toContain('tipo de documento');
    const item = hoja0.items[0];
    expect(item.atributos.TIPO_DE_DOCUMENTO).toBeUndefined();

    const confirmar = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [item], archivoOrigen: 'prueba.xlsx' });

    expect(confirmar.body.data.creados).toBe(1);
    expect(confirmar.body.data.errores).toHaveLength(0);
  });

  test('una celda con texto de formato mixto (rich text) se lee como texto plano, no como objeto', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Libros');
    hoja.addRow(['Autor', 'Titulo', 'Editorial', 'Lugar', 'ISBN', 'Tipo de documento', 'Estado fisico', 'ID']);
    const fila = hoja.addRow([null, null, null, null, '978-1', 'Fisico', null, 'RT-1']);
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
    hoja.addRow(['No.', 'Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'ID']);
    hoja.addRow([1, '', 'Titulo Sin Autor', 'Editorial X', '978-1', 'Fisico', 'SA-1']);
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

  test('no hace falta traer todas las categorias: se importa la hoja reconocida y se avisa de la que no (la plantilla vacia no se avisa)', async () => {
    const workbook = new ExcelJS.Workbook();
    const libros = workbook.addWorksheet('Libros');
    libros.addRow(['Autor', 'Titulo', 'Editorial', 'ISBN', 'Tipo de documento', 'ID']);
    libros.addRow(['Autor Solo Libros', 'Libro Que Si Entra', 'Ed', '1', 'Fisico', 'SL-1']);
    const sueltas = workbook.addWorksheet('Apuntes sueltos');
    sueltas.addRow(['Autor', 'Titulo']);
    sueltas.addRow(['Alguien', 'Algo que no es una categoria']);
    const plantilla = workbook.addWorksheet('Revistas');
    plantilla.addRow(['Autor', 'Titulo']); // solo encabezado: hoja sin llenar
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.data.hojas.map((h) => h.categoria)).toEqual(['LIBRO']);
    expect(res.body.data.hojasOmitidas).toEqual([
      { hoja: 'Apuntes sueltos', motivo: 'No hay ninguna categoria con ese nombre' },
    ]);
  });

  test('una categoria nueva se reconoce por el nombre de su hoja (tambien en plural), sin tocar codigo', async () => {
    await Category.create({ clave: 'MAPA', nombre: 'Mapa', campos: [] });

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Mapas');
    hoja.addRow(['Autor', 'Titulo', 'ID']);
    hoja.addRow(['Cartografo', 'Mapa de Guatemala', 'M-1']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.data.hojas).toHaveLength(1);
    expect(res.body.data.hojas[0].categoria).toBe('MAPA');
    expect(res.body.data.hojas[0].items[0].titulo).toBe('Mapa de Guatemala');
  });

  test('si ninguna hoja sirve, el error dice que hojas con datos se encontraron y por que no se usaron', async () => {
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Hoja1');
    hoja.addRow(['Autor', 'Titulo']);
    hoja.addRow(['Alguien', 'Algo']);
    const buffer = await workbook.xlsx.writeBuffer();

    const res = await api(app)
      .post('/api/catalog/importar')
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('archivo', buffer, 'prueba.xlsx');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('"Hoja1"');
    expect(res.body.error).toContain('No hay ninguna categoria con ese nombre');
  });
});

describe('POST /api/catalog/importar/confirmar', () => {
  // Cada item trae el ID de su fila del Excel (idInventario) y, si agrupa copias, el de cada una
  // (ids). Si la prueba no pone uno, se inventa uno distinto para que nunca choquen.
  let contadorIds = 0;
  function itemValido(overrides = {}) {
    const idInventario = overrides.idInventario ?? `IMP-${++contadorIds}`;
    return {
      categoria: 'LIBRO',
      idInventario,
      ids: [idInventario],
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

    const registro = await Catalog.findOne({ titulo: 'Titulo Importado' });
    expect(registro.registradoPor.toString()).toBe(auxiliar._id.toString());
  });

  test('un Auxiliar NO puede confirmar una importacion en una categoria que no le asignaron', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${auxiliarToken}`)
      .send({
        items: [
          itemValido(), // LIBRO: si permitido
          itemValido({ categoria: 'REVISTA', titulo: 'Revista No Permitida', atributos: { EDITORIAL: 'E', VOLUMEN: '1' } }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
    expect(res.body.data.errores).toHaveLength(1);
    expect(res.body.data.errores[0].titulo).toBe('Revista No Permitida');
    expect(res.body.data.errores[0].error).toMatch(/no tienes permiso/i);

    expect(await Catalog.findOne({ titulo: 'Titulo Importado' })).not.toBeNull();
    expect(await Catalog.findOne({ titulo: 'Revista No Permitida' })).toBeNull();
  });

  test('rechaza la peticion si no hay items', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [] });

    expect(res.status).toBe(400);
  });

  test('un item sin ID no se crea y se reporta "Falta el ID", sin tumbar el resto del lote', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        items: [
          itemValido({ titulo: 'Libro Sin ID', idInventario: '', ids: [] }),
          itemValido({ titulo: 'Libro Con ID' }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
    expect(res.body.data.errores).toHaveLength(1);
    expect(res.body.data.errores[0].titulo).toBe('Libro Sin ID');
    expect(res.body.data.errores[0].error).toBe('Falta el ID');
    expect(await Catalog.findOne({ titulo: 'Libro Sin ID' })).toBeNull();
  });

  test('un ID que ya existe en el catalogo se reporta con un mensaje claro y no se duplica', async () => {
    await Catalog.create({
      categoria: 'LIBRO',
      idInventario: '70L',
      autor: 'Autor Existente',
      titulo: 'Libro Existente',
      atributos: { EDITORIAL: 'Ed', ISBN: '1' },
      registradoPor: manager._id,
    });

    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido({ titulo: 'Libro Con ID Repetido', idInventario: '70L', ids: ['70L'] })] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(0);
    expect(res.body.data.errores[0].error).toContain('70L ya existe');
    expect(await Catalog.countDocuments({ idInventario: '70L' })).toBe(1);
  });

  test('guarda el nombre del archivo de origen para poder mostrarlo en vez de quien lo importo', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido()], archivoOrigen: 'Base_Ingreso - Gabriela.xlsx' });

    expect(res.status).toBe(200);

    const registro = await Catalog.findOne({ titulo: 'Titulo Importado' });
    expect(registro.origenImportacion).toBe('Base_Ingreso - Gabriela.xlsx');
  });

  test('crea el registro como Pendiente pero ya enviado (visible para revisar, no autoaprobado), con el ID que traia el Excel', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido({ idInventario: '15L', ids: ['15L'] })] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);

    const registro = await Catalog.findOne({ titulo: 'Titulo Importado' });
    expect(registro.estadoRevision).toBe(ESTADOS_REVISION.PENDIENTE);
    expect(registro.enviado).toBe(true);
    expect(registro.registradoPor.toString()).toBe(manager._id.toString());
    // El ID es el que escribieron en el Excel; aprobar despues no lo cambia (ver catalogFlow.test.js).
    expect(registro.idInventario).toBe('15L');
  });

  test('crea la cantidad de copias indicada (columna "Copias" o filas agrupadas, ya sumadas en el item)', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido({ titulo: 'Libro Con 3 Copias', copias: 3, idInventario: '25F', ids: ['25F', '25F-C1', '25F-C2'] })] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(3);

    // Cada copia se crea con el ID de su propia fila del Excel.
    const registros = await Catalog.find({ titulo: 'Libro Con 3 Copias' });
    expect(registros.map((r) => r.idInventario).sort()).toEqual(['25F', '25F-C1', '25F-C2']);
  });

  test('si un item no trae copias (>1 desmarcado por el usuario), importa solo 1', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ items: [itemValido({ titulo: 'Libro Copias Desmarcadas', copias: 1 })] });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
  });

  test('si un item no pasa la validacion (categoria inexistente), reporta el error sin tumbar el resto del lote', async () => {
    const res = await api(app)
      .post('/api/catalog/importar/confirmar')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        items: [
          itemValido({ categoria: 'CATEGORIA_QUE_NO_EXISTE', titulo: 'Choca con la validacion' }),
          itemValido({ titulo: 'Este si entra' }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.creados).toBe(1);
    expect(res.body.data.errores).toHaveLength(1);
    expect(res.body.data.errores[0].titulo).toBe('Choca con la validacion');

    const entro = await Catalog.findOne({ titulo: 'Este si entra' });
    expect(entro).not.toBeNull();
  });
});
