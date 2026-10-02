require('./setupEnv');

const zlib = require('zlib');
const PDFDocument = require('pdfkit');
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
const { CATEGORIAS_POR_DEFECTO } = require('../scripts/seed');
const {
  construirGruposColumnas,
  categoriasOrdenadasParaReporte,
  ordenarFilasPorTipoDocumentoSiAplica,
  agruparFilasPorTipoDocumentoSiAplica,
  repartirSobrante,
  comprimirAnchos,
  calcularColoresPorRegistro,
  ANCHO_MIN_ATRIBUTO,
  ANCHO_MAX_ATRIBUTO,
  ANCHO_MAX_ESTADO_FISICO,
  ANCHO_ID,
  COLOR_EJEMPLAR_A,
  COLOR_EJEMPLAR_B,
  COLOR_COPIA,
  TAMANO_PAGINA_OFICIO,
  MARGEN_PAGINA,
  CM_A_PUNTOS,
} = require('../src/exports/export_controller');

// Este archivo verifica que el reparto de columnas del PDF (helpers/pdfTable.js +
// construirGruposColumnas) no dependa de NINGUNA categoria en particular: ni el nombre de la
// categoria ni sus campos estan escritos a mano en ningun lado de esa logica, asi que tiene
// que funcionar igual de bien para las 6 categorias que ya existen y para cualquier categoria
// nueva que se cree despues, con cualquier combinacion de atributos.

let manager;
let managerToken;

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await seedCategoriasDePrueba();
  const passwordHash = await hashPassword('claveSegura123');
  manager = await User.create({ nombre: 'Jefatura', email: 'manager@usac.gt', passwordHash, rol: ROLES.MANAGER });
  managerToken = generateJWT(manager);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

// Usa las MISMAS constantes que exportCatalogPdf (tamaño de hoja y margenes), no numeros
// inventados aparte - si production cambia el margen o el tamaño de hoja, esta prueba debe
// sentirlo tambien, en vez de seguir probando contra un ancho disponible que ya no existe.
function nuevoDoc() {
  return new PDFDocument({ margin: MARGEN_PAGINA, size: TAMANO_PAGINA_OFICIO, layout: 'landscape' });
}

function anchoDisponibleOficio() {
  const doc = nuevoDoc();
  return doc.page.width - doc.page.margins.left - doc.page.margins.right - ANCHO_ID;
}

function anchoTotalGrupo(grupo) {
  return grupo.reduce((suma, col) => suma + col.width, 0);
}

// Todo grupo de columnas, sin importar la categoria, tiene que respetar estas reglas basicas:
// las columnas con ancho medido por contenido (atributos, Notas, Estado fisico - las que
// traen "anchoMaximo") nunca quedan mas angostas que el minimo legible ni mas anchas que su
// propio tope; las columnas fijas (Titulo, Autor, comunes, Estado) tienen su propio ancho fijo
// y no entran en esta regla. El grupo principal nunca se pasa del ancho real disponible.
function verificarGruposValidos(grupos, anchoDisponible) {
  grupos.forEach((grupo, indice) => {
    grupo.forEach((columna) => {
      expect(Number.isFinite(columna.width)).toBe(true);
      expect(columna.width).toBeGreaterThan(0);
      if (columna.anchoMaximo !== undefined) {
        expect(columna.width).toBeGreaterThanOrEqual(ANCHO_MIN_ATRIBUTO - 0.01);
        expect(columna.width).toBeLessThanOrEqual(columna.anchoMaximo + 0.01);
      }
    });
    if (indice === 0) {
      expect(anchoTotalGrupo(grupo)).toBeLessThanOrEqual(anchoDisponible + 0.01);
    }
  });
}

async function crearRegistrosDePrueba(categoriaDoc, cantidad = 6) {
  const registros = [];
  for (let i = 0; i < cantidad; i++) {
    const atributos = {};
    categoriaDoc.campos.forEach((campo, idx) => {
      // Se alterna contenido corto y excepcionalmente largo, para forzar que el percentil (no
      // el maximo absoluto) sea lo que decide el ancho - la misma condicion que goteo en el
      // caso real de "Editorial" con un solo nombre rarisimo entre muchos cortos.
      const esLargo = i === 0 && idx === 0;
      atributos[campo.clave] = esLargo
        ? 'Un valor excepcionalmente largo que casi nunca aparece pero debe caber igual sin romper nada'
        : `Valor ${idx}`;
    });

    const registro = await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: `Autor de prueba ${i}`,
      titulo: `Titulo de prueba ${categoriaDoc.clave} ${i}`,
      idioma: 'Español',
      anio: '2020',
      edicion: '1ra',
      lugar: 'Guatemala',
      paginasImpresas: 100,
      estadoFisico: i === 0 ? 'Buen estado - un comentario viejo bastante largo pegado de una importacion anterior' : 'Buen estado',
      atributos,
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });
    registros.push(registro);
  }
  return registros;
}

describe('El reparto de columnas del PDF funciona igual para cualquier categoria', () => {
  test.each(CATEGORIAS_POR_DEFECTO.map((c) => c.clave))('categoria existente: %s', async (clave) => {
    const categoriaDoc = await Category.findOne({ clave });
    const registros = await crearRegistrosDePrueba(categoriaDoc);

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, registros);

    verificarGruposValidos(grupos, anchoDisponible);

    // Tambien tiene que poder exportarse de verdad sin tumbarse (PDF real, no solo el calculo
    // de anchos) - esto ejercita el pipeline completo: filtro, agrupado por categoria y dibujo.
    const res = await api(app)
      .get(`/api/exports/catalog?categoria=${clave}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('categoria NUEVA (creada despues, nunca vista en el codigo) - la logica no tiene ningun nombre de categoria escrito a mano', async () => {
    const nueva = await Category.create({
      clave: 'MAPAS_HISTORICOS',
      nombre: 'Mapas historicos',
      campos: [
        { clave: 'CARTOGRAFO', etiqueta: 'Cartografo', requerido: false },
        { clave: 'ESCALA', etiqueta: 'Escala', requerido: false },
        // Un atributo llamado "Notas" en una categoria que el codigo nunca vio antes: tiene
        // que garantizarse en la fila principal igual que en Folleto, porque esCampoNotas
        // compara por ETIQUETA, no por categoria.
        { clave: 'NOTAS', etiqueta: 'Notas', requerido: false },
      ],
    });

    const registros = await crearRegistrosDePrueba(nueva, 5);
    // Le damos a "Notas" contenido de verdad largo en un registro, como pasaria con una
    // descripcion real.
    registros[1].atributos.NOTAS = 'Una nota bastante larga que describe detalles del mapa, su procedencia y su estado de conservacion';
    await registros[1].save();

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, nueva, anchoDisponible, registros);

    verificarGruposValidos(grupos, anchoDisponible);

    const columnasPrincipales = grupos[0].map((c) => c.header);
    expect(columnasPrincipales).toContain('Notas');

    const res = await api(app)
      .get('/api/exports/catalog?categoria=MAPAS_HISTORICOS')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('categoria sin ningun atributo propio (solo campos comunes) no rompe nada', async () => {
    const sinAtributos = await Category.create({ clave: 'SIN_ATRIBUTOS', nombre: 'Sin atributos', campos: [] });
    const registros = await crearRegistrosDePrueba(sinAtributos, 4);

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, sinAtributos, anchoDisponible, registros);

    expect(grupos).toHaveLength(1);
    verificarGruposValidos(grupos, anchoDisponible);
  });

  test('categoria con muchos atributos (mas de los que caben en una fila) reparte en varias filas de continuacion sin romper anchos', async () => {
    const conMuchos = await Category.create({
      clave: 'MUCHOS_CAMPOS',
      nombre: 'Muchos campos',
      campos: Array.from({ length: 10 }, (_, i) => ({ clave: `CAMPO_${i}`, etiqueta: `Campo ${i}`, requerido: false })),
    });
    const registros = await crearRegistrosDePrueba(conMuchos, 4);

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, conMuchos, anchoDisponible, registros);

    expect(grupos.length).toBeGreaterThan(1);
    verificarGruposValidos(grupos, anchoDisponible);

    // Ningun atributo se pierde en el camino: los 10 campos propios tienen que aparecer en
    // algun grupo (Estado fisico y las comunes van aparte, no cuentan aqui).
    const encabezados = grupos.flat().map((c) => c.header);
    conMuchos.campos.forEach((campo) => {
      expect(encabezados).toContain(campo.etiqueta);
    });
  });

  test('reordena por ancho para aprovechar al maximo la fila principal, sin importar en que orden se definieron los campos', async () => {
    // Un campo ancho definido PRIMERO en Gestion de Categorias, seguido de muchos angostos. Antes
    // (empaquetado en el orden de los campos) el ancho se probaba primero, se quedaba solo con
    // el espacio y los angostos se iban de una a la continuacion. Ordenando por ancho (angostas
    // primero), las angostas SI caben juntas en la fila principal y es el ancho el que se va solo
    // a la continuacion - justo lo que se busca: aprovechar al maximo la primera fila.
    // Son muchos campos a proposito: con pocos, todo se comprime en UNA sola fila (ver el test de
    // "una fila por registro" mas abajo) y la continuacion nunca llega a hacer falta.
    const categoriaDoc = await Category.create({
      clave: 'PRUEBA_ORDEN_ANCHO',
      nombre: 'Prueba orden ancho',
      campos: [
        { clave: 'ANCHO', etiqueta: 'Campo Ancho', requerido: false },
        ...'ABCDEFGHIJKL'.split('').map((letra) => ({ clave: letra, etiqueta: `Campo ${letra}`, requerido: false })),
      ],
    });

    const registro = await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Autor de prueba',
      titulo: 'Titulo de prueba orden',
      idioma: 'Español',
      anio: '2020',
      edicion: '1ra',
      lugar: 'Guatemala',
      paginasImpresas: 100,
      estadoFisico: 'Buen estado',
      atributos: {
        // Bien largo, para que quede pegado al tope maximo (ANCHO_MAX_ATRIBUTO).
        ANCHO: 'Un valor excepcionalmente largo que ocupa mucho espacio y deberia ceder su turno a los campos angostos',
        ...Object.fromEntries('ABCDEFGHIJKL'.split('').map((letra) => [letra, 'x'])),
      },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, [registro]);

    verificarGruposValidos(grupos, anchoDisponible);

    const encabezadosGrupo1 = grupos[0].map((c) => c.header);
    expect(encabezadosGrupo1).toEqual(expect.arrayContaining(['Campo A', 'Campo B', 'Campo C']));
    expect(encabezadosGrupo1).not.toContain('Campo Ancho');

    const encabezadosResto = grupos.slice(1).flat().map((c) => c.header);
    expect(encabezadosResto).toContain('Campo Ancho');
  });

  test('una fila por registro: un registro real con Editorial larguisima cabe en la fila principal (se comprimen columnas, no se manda Editorial a una fila de continuacion)', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DOCS_SELLO_FACUJURI_Y_SOCI' });
    const registro = await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Secretaria general del consejo nacional de planificacion economica, Direccion de Planificacion global, Departamento de Poblacion y empleo.',
      titulo: 'Migracion interna y distribucion geografica de la poblacion',
      idioma: 'Español',
      anio: '1986',
      lugar: 'Guatemala',
      paginasImpresas: 243,
      estadoFisico: 'Buen estado',
      atributos: {
        EDITORIAL: 'Secretaria general del consejo nacional de planificacion economica',
        TIPO_DE_DOCUMENTO: 'Publicacion Institucional',
        NOTAS: 'Es una serie de resultados No.13',
      },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      enviado: true,
      registradoPor: manager._id,
    });

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, [registro]);

    expect(grupos).toHaveLength(1);
    verificarGruposValidos(grupos, anchoDisponible);
    const encabezados = grupos[0].map((c) => c.header);
    expect(encabezados).toEqual(expect.arrayContaining(['Editorial', 'Tipo de Documento', 'Notas']));
  });

  test('comprimirAnchos: recorta primero las columnas mas anchas, respeta el minimo de cada una y no toca nada si ni al minimo alcanza', () => {
    const columna = (key, width) => ({ key, width });
    const ancha = columna('atributos.A', 220);
    const media = columna('atributos.B', 100);
    const angosta = columna('atributos.C', ANCHO_MIN_ATRIBUTO);

    // Hay que quitar 80pt: sale todo de la mas ancha (220 -> 140); las otras ni se tocan.
    expect(comprimirAnchos([ancha, media, angosta], 80)).toBe(true);
    expect(ancha.width).toBeCloseTo(140, 0);
    expect(media.width).toBe(100);
    expect(angosta.width).toBe(ANCHO_MIN_ATRIBUTO);

    // Imposible: aun con todas al minimo (70 c/u) solo se pueden quitar (140-70)+(100-70)=100pt.
    const [a2, b2] = [columna('atributos.A', 140), columna('atributos.B', 100)];
    expect(comprimirAnchos([a2, b2], 500)).toBe(false);
    expect(a2.width).toBe(140);
    expect(b2.width).toBe(100);

    // Ninguna baja de su minimo aunque se pida recortar casi todo lo posible.
    const [a3, b3] = [columna('atributos.A', 140), columna('atributos.B', 100)];
    expect(comprimirAnchos([a3, b3], 99)).toBe(true);
    expect(a3.width).toBeGreaterThanOrEqual(ANCHO_MIN_ATRIBUTO - 0.01);
    expect(b3.width).toBeGreaterThanOrEqual(ANCHO_MIN_ATRIBUTO - 0.01);
    expect(a3.width + b3.width).toBeLessThanOrEqual(240 - 99 + 0.01);
  });

  test('Estado fisico con texto viejo excepcionalmente largo nunca pasa de su propio tope (la mitad del maximo normal), en cualquier categoria', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    const registros = await crearRegistrosDePrueba(categoriaDoc, 8);
    // Varios registros con texto viejo larguisimo pegado (el mismo patron que se encontro en
    // los datos reales de Folleto).
    for (const r of registros.slice(0, 5)) {
      r.estadoFisico = 'Buen estado - '.repeat(10) + 'texto viejo de una importacion de hace tiempo';
      await r.save();
    }

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, registros);

    const columnaEstadoFisico = grupos.flat().find((c) => c.header === 'Estado físico');
    expect(columnaEstadoFisico).toBeDefined();
    expect(columnaEstadoFisico.width).toBeLessThanOrEqual(ANCHO_MAX_ESTADO_FISICO + 0.01);
  });

  test('repartirSobrante: lo que una columna no puede usar (por su propio tope) pasa a otra columna en vez de perderse', () => {
    // 2 columnas, cada una a 70pt (su ideal) con topes distintos: una baja (110, como Estado
    // fisico) y le faltan solo 40pt para llegar ahi; otra alta (220, como un atributo comun) y
    // le faltan 150pt. Con 100pt de sobrante repartidos parejo (50 y 50): la de tope bajo solo
    // puede usar 40 de sus 50 (le sobran 10 sin usar), la de tope alto usa sus 50 completos y se
    // queda en 120, todavia lejos de su tope. Con el reparto viejo (una sola pasada, sin
    // reintentar) esos 10pt que la de tope bajo no pudo usar se perdian en blanco. Con el nuevo
    // reparto en rondas, esos 10pt sobrantes le pasan a la de tope alto en una segunda ronda.
    const columnaTopeBajo = { width: 70, anchoMaximo: 110 };
    const columnaTopeAlto = { width: 70, anchoMaximo: 220 };

    repartirSobrante([columnaTopeBajo, columnaTopeAlto], 100);

    expect(columnaTopeBajo.width).toBeCloseTo(110, 5); // llego exacto a su tope, no mas.
    // Con el reparto viejo hubiera quedado en 120 (70 + su parte pareja de 50); con el nuevo
    // reparto en rondas recibe tambien los 10pt que la otra columna no pudo usar.
    expect(columnaTopeAlto.width).toBeCloseTo(130, 5);
  });
});

describe('Color de la columna ID: primer ejemplar vs copias', () => {
  async function crearMaterial(categoriaDoc, datosBase, estadosFisicos) {
    const registros = [];
    for (const estadoFisico of estadosFisicos) {
      const registro = await Catalog.create({
        ...datosBase,
        categoria: categoriaDoc.clave,
        estadoFisico,
        estadoRevision: ESTADOS_REVISION.APROBADO,
        enviado: true,
        registradoPor: manager._id,
      });
      registros.push(registro);
    }
    return registros;
  }

  test('el primer ejemplar de cada material alterna azul/rojo palido; cualquier copia (misma obra, distinto estado fisico) es amarillo palido, sin importar la posicion', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    const datosLibroA = {
      autor: 'Autor Libro A',
      titulo: 'Libro A',
      idioma: 'Español',
      anio: '2020',
      edicion: '1ra',
      lugar: 'Guatemala',
      paginasImpresas: 100,
      atributos: { EDITORIAL: 'Editorial X' },
    };
    const datosLibroB = { ...datosLibroA, autor: 'Autor Libro B', titulo: 'Libro B' };
    const datosLibroC = { ...datosLibroA, autor: 'Autor Libro C', titulo: 'Libro C' };

    // Orden en que quedarian en el reporte: A (ejemplar), A (copia), B (ejemplar), A (otra
    // copia mas), C (ejemplar). Las copias de A no deberian "gastar" un turno del alternado
    // azul/rojo - ese alternado es solo entre A, B y C (los 3 materiales distintos).
    const [ejemplarA, copiaA1] = await crearMaterial(categoriaDoc, datosLibroA, ['Buen estado', 'Regular']);
    const [ejemplarB] = await crearMaterial(categoriaDoc, datosLibroB, ['Buen estado']);
    const [copiaA2] = await crearMaterial(categoriaDoc, datosLibroA, ['Hojas manchadas']);
    const [ejemplarC] = await crearMaterial(categoriaDoc, datosLibroC, ['Buen estado']);

    const registrosEnOrden = [ejemplarA, copiaA1, ejemplarB, copiaA2, ejemplarC];
    const colores = calcularColoresPorRegistro(registrosEnOrden);

    expect(colores.get(String(ejemplarA._id))).toBe(COLOR_EJEMPLAR_A);
    expect(colores.get(String(copiaA1._id))).toBe(COLOR_COPIA);
    expect(colores.get(String(copiaA2._id))).toBe(COLOR_COPIA);
    // B es el 2do material distinto (A fue el 1ro) -> le toca el otro color del patron.
    expect(colores.get(String(ejemplarB._id))).toBe(COLOR_EJEMPLAR_B);
    // C es el 3er material distinto -> vuelve a azul, sin importar cuantas copias de A hubo
    // en el medio.
    expect(colores.get(String(ejemplarC._id))).toBe(COLOR_EJEMPLAR_A);
  });

  test('exportar un catalogo con copias reales no se rompe y produce un PDF valido', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    const datos = {
      autor: 'Autor Con Copias',
      titulo: 'Libro Con Copias Reales',
      idioma: 'Español',
      anio: '2020',
      edicion: '1ra',
      lugar: 'Guatemala',
      paginasImpresas: 100,
      atributos: { EDITORIAL: 'Editorial Y' },
    };
    await crearMaterial(categoriaDoc, datos, ['Buen estado', 'Regular', 'Hojas manchadas']);

    const res = await api(app)
      .get('/api/exports/catalog?categoria=DICCIONARIO')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Abreviaturas del reporte (Idioma, Estado) y "Notas" al final de la fila', () => {
  test('Idioma sale abreviado a 3 letras (conocido o no) y Estado sale como una sola letra, incluyendo "DB" si esta dado de baja', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    const base = {
      categoria: 'DICCIONARIO',
      autor: 'Autor',
      titulo: 'Titulo',
      atributos: { EDITORIAL: 'Ed' },
      registradoPor: manager._id,
      enviado: true,
    };

    const pendiente = await Catalog.create({ ...base, titulo: 'Pendiente', idioma: 'Español', estadoRevision: ESTADOS_REVISION.PENDIENTE });
    const aprobado = await Catalog.create({ ...base, titulo: 'Aprobado', idioma: 'Ingles', estadoRevision: ESTADOS_REVISION.APROBADO });
    const rechazado = await Catalog.create({
      ...base,
      titulo: 'Rechazado',
      idioma: 'Quiche',
      estadoRevision: ESTADOS_REVISION.RECHAZADO,
      observaciones: 'Falta algo',
    });
    const deBaja = await Catalog.create({
      ...base,
      titulo: 'De baja',
      idioma: 'Frances',
      estadoRevision: ESTADOS_REVISION.APROBADO,
      deBaja: true,
      motivoBaja: 'Se perdio',
      fechaBaja: new Date(),
    });

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const registros = [pendiente, aprobado, rechazado, deBaja];
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, registros);
    const columnaIdioma = grupos[0].find((c) => c.header === 'Idioma');
    const columnaEstado = grupos[0].find((c) => c.header === 'Est.');

    expect(columnaIdioma.render(pendiente)).toBe('ESP');
    expect(columnaIdioma.render(aprobado)).toBe('ING');
    // "Quiche" no esta en la tabla de siglas conocidas - usa las primeras 3 letras.
    expect(columnaIdioma.render(rechazado)).toBe('QUI');
    expect(columnaIdioma.render(deBaja)).toBe('FRA');

    expect(columnaEstado.render(pendiente)).toBe('P');
    expect(columnaEstado.render(aprobado)).toBe('A');
    expect(columnaEstado.render(rechazado)).toBe('D');
    // "DB" manda aunque estadoRevision siga en APROBADO por debajo.
    expect(columnaEstado.render(deBaja)).toBe('DB');
  });

  test('"Notas" queda como la ULTIMA columna de la fila principal, despues de los demas atributos', async () => {
    const categoriaDoc = await Category.create({
      clave: 'PRUEBA_NOTAS_AL_FINAL',
      nombre: 'Prueba notas al final',
      campos: [
        { clave: 'NOTAS', etiqueta: 'Notas', requerido: false },
        { clave: 'EDITORIAL', etiqueta: 'Editorial', requerido: false },
      ],
    });
    const registro = await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Autor',
      titulo: 'Titulo',
      atributos: { NOTAS: 'Una nota', EDITORIAL: 'Una editorial' },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, [registro]);

    const encabezadosGrupo1 = grupos[0].map((c) => c.header);
    expect(encabezadosGrupo1[encabezadosGrupo1.length - 1]).toBe('Notas');
  });

  test('un registro dado de baja se exporta sin errores (fila gris, texto tachado)', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Autor De Baja',
      titulo: 'Libro De Baja',
      atributos: { EDITORIAL: 'Ed' },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
      deBaja: true,
      motivoBaja: 'Se dono',
      fechaBaja: new Date(),
    });

    const res = await api(app)
      .get('/api/exports/catalog?categoria=DICCIONARIO')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('"Notas" muestra el motivo de baja o la observacion de rechazo en vez del atributo libre, cuando aplica', async () => {
    const categoriaDoc = await Category.create({
      clave: 'PRUEBA_NOTAS_MOTIVO',
      nombre: 'Prueba notas motivo',
      campos: [{ clave: 'NOTAS', etiqueta: 'Notas', requerido: false }],
    });
    const base = {
      categoria: categoriaDoc.clave,
      autor: 'Autor',
      titulo: 'Titulo',
      registradoPor: manager._id,
      enviado: true,
    };

    const normal = await Catalog.create({
      ...base,
      titulo: 'Normal',
      atributos: { NOTAS: 'Nota escrita por quien registro' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });
    const rechazado = await Catalog.create({
      ...base,
      titulo: 'Rechazado',
      atributos: { NOTAS: 'Esta nota no deberia salir' },
      estadoRevision: ESTADOS_REVISION.RECHAZADO,
      observaciones: 'Falta la portada',
    });
    const deBaja = await Catalog.create({
      ...base,
      titulo: 'De baja',
      atributos: { NOTAS: 'Esta tampoco deberia salir' },
      estadoRevision: ESTADOS_REVISION.APROBADO,
      deBaja: true,
      motivoBaja: 'Se dono a la biblioteca municipal',
      fechaBaja: new Date(),
    });
    const sinNotaEscrita = await Catalog.create({
      ...base,
      titulo: 'Rechazado sin nota propia',
      atributos: {},
      estadoRevision: ESTADOS_REVISION.RECHAZADO,
      observaciones: 'Duplicado',
    });

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const registros = [normal, rechazado, deBaja, sinNotaEscrita];
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, registros);
    const columnaNotas = grupos[0].find((c) => c.header === 'Notas');

    expect(columnaNotas.render(normal)).toBe('Nota escrita por quien registro');
    expect(columnaNotas.render(rechazado)).toBe('Falta la portada');
    expect(columnaNotas.render(deBaja)).toBe('Se dono a la biblioteca municipal');
    expect(columnaNotas.render(sinNotaEscrita)).toBe('Duplicado');
  });

  test('un registro rechazado se exporta sin errores (fila roja)', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Autor Rechazado',
      titulo: 'Libro Rechazado',
      atributos: { EDITORIAL: 'Ed' },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.RECHAZADO,
      observaciones: 'No cumple los requisitos',
    });

    const res = await api(app)
      .get('/api/exports/catalog?categoria=DICCIONARIO')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Columna "Año reg." (año en que se registro el material, no el de publicacion)', () => {
  test('sale en la fila principal (columna fija) y muestra el año de createdAt, no el de "anio"', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    const registro = await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Autor',
      titulo: 'Titulo',
      atributos: { EDITORIAL: 'Ed' },
      anio: 1978,
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });

    const doc = nuevoDoc();
    const anchoDisponible = anchoDisponibleOficio();
    const grupos = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, [registro]);
    const columnaAnioReg = grupos[0].find((c) => c.header === 'Año reg.');

    expect(columnaAnioReg).toBeDefined();
    expect(columnaAnioReg.render(registro)).toBe(registro.createdAt.getFullYear());
    expect(columnaAnioReg.render(registro)).not.toBe(1978);
  });
});

describe('Tamaño de hoja oficio y margenes del PDF', () => {
  test('la hoja mide 33 x 21.5cm (el tamaño real que se esta imprimiendo)', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    await Catalog.create({
      categoria: categoriaDoc.clave,
      autor: 'Autor',
      titulo: 'Titulo',
      atributos: { EDITORIAL: 'Ed' },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });

    const res = await api(app)
      .get('/api/exports/catalog?categoria=DICCIONARIO')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    // pdfkit dibuja en landscape invirtiendo el tamaño de pagina que se le paso (formato
    // "portrait" [21.5cm, 33cm]), asi que en el PDF final el MediaBox queda con el ancho y el
    // alto ya intercambiados: 33cm de ancho x 21.5cm de alto.
    expect(res.body.toString('latin1')).toContain('/MediaBox [0 0 935.4345 609.44975]');
  });

  test('margen parejo de 1cm en los 4 lados - la tabla usa todo lo demas (ancho y alto)', () => {
    const anchoHojaFinal = TAMANO_PAGINA_OFICIO[1]; // landscape invierte el tamaño, ver test de arriba
    const altoHojaFinal = TAMANO_PAGINA_OFICIO[0];
    const margenCm = MARGEN_PAGINA / CM_A_PUNTOS;
    const anchoTablaCm = (anchoHojaFinal - 2 * MARGEN_PAGINA) / CM_A_PUNTOS;
    const altoTablaCm = (altoHojaFinal - 2 * MARGEN_PAGINA) / CM_A_PUNTOS;

    expect(margenCm).toBeCloseTo(1, 1);
    // Ancho y alto disponibles para la tabla son la hoja completa (33 x 21.5cm, medida real)
    // menos el mismo margen en los 4 lados - nada de anchos "objetivo" en cm calculados aparte
    // que despues no coinciden con lo que sale impreso de verdad. 33-2=31cm, 21.5-2=19.5cm.
    expect(anchoTablaCm).toBeCloseTo(31, 1);
    expect(altoTablaCm).toBeCloseTo(19.5, 1);
  });

  test('el nombre de la categoria se repite en el encabezado de CADA pagina, no solo la primera', async () => {
    const categoriaDoc = await Category.findOne({ clave: 'DICCIONARIO' });
    // Con la tabla ya angosta (30cm) hacen falta bastantes filas con texto largo para forzar
    // una segunda pagina fisica - se crean varios registros con notas/autor largos para eso.
    const registros = Array.from({ length: 25 }, (_, i) => ({
      categoria: categoriaDoc.clave,
      autor: `Autor bastante largo numero ${i} para ocupar mas de una linea en la celda`,
      titulo: `Titulo bastante largo numero ${i} para que la fila ocupe varias lineas de alto`,
      atributos: { EDITORIAL: `Editorial numero ${i} con un nombre tambien largo` },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
    }));
    await Catalog.insertMany(registros);

    const res = await api(app)
      .get('/api/exports/catalog?categoria=DICCIONARIO')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const crudo = res.body.toString('latin1');
    // Mas de 1 pagina en el PDF (varios objetos /Type /Page) confirma que si se forzo la
    // paginacion que este test necesita para tener sentido.
    const paginas = crudo.match(/\/Type\s*\/Page[^s]/g) || [];
    expect(paginas.length).toBeGreaterThan(1);

    // El contenido de cada pagina va comprimido (FlateDecode) - hay que descomprimir cada
    // stream para poder buscar el texto real que se dibujo. Ademas pdfkit escribe el texto
    // como string hexadecimal ("<...>") dentro de TJ, no como texto literal entre parentesis -
    // por eso se busca la version en hexadecimal de "Diccionario", no el texto tal cual.
    const zlib = require('zlib');
    const streams = [...crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
    const textoDescomprimido = streams
      .map(([, contenido]) => {
        try {
          return zlib.inflateSync(Buffer.from(contenido, 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');

    const hexNombreCategoria = Buffer.from('Diccionario', 'latin1').toString('hex');
    const apariciones = textoDescomprimido.toLowerCase().split(hexNombreCategoria).length - 1;
    expect(apariciones).toBeGreaterThan(1);
  });

  test('cada categoria empieza en una hoja nueva, aunque le hubiera quedado espacio en la anterior', async () => {
    // 1 sola fila corta por categoria - de sobra para las 2 en la misma pagina si no se forzara
    // el salto. Si el PDF da exactamente 2 paginas (no 1), confirma que si se forzo.
    await Catalog.create({
      categoria: 'DICCIONARIO',
      autor: 'Autor',
      titulo: 'Titulo diccionario',
      atributos: { EDITORIAL: 'Ed' },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });
    await Catalog.create({
      categoria: 'REVISTA',
      autor: 'Autor',
      titulo: 'Titulo revista',
      atributos: { EDITORIAL: 'Ed', VOLUMEN: '1' },
      registradoPor: manager._id,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.APROBADO,
    });

    const res = await api(app)
      .get('/api/exports/catalog')
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const crudo = res.body.toString('latin1');
    const paginas = crudo.match(/\/Type\s*\/Page[^s]/g) || [];
    expect(paginas.length).toBe(2);
  });

  test('categoriasOrdenadasParaReporte respeta "orden" (no alfabetico a secas), igual que GET /api/categories', async () => {
    // No se puede verificar esto inspeccionando el texto del PDF: pdfkit divide el texto en
    // varios trozos hexadecimales cuando hay kerning entre letras (ej. "Revista" sale como
    // "<5265> 15 <766973746120283129>", partido en 2), asi que buscar el nombre completo como
    // un solo string hex no es confiable. Se prueba en cambio la funcion que exportCatalogPdf
    // usa para pedir las categorias, directo contra la base de datos real.
    await Category.updateOne({ clave: 'DICCIONARIO' }, { orden: 5 });
    await Category.updateOne({ clave: 'REVISTA' }, { orden: 1 });
    await Category.updateOne({ clave: 'FOLLETO' }, { orden: 0 });

    const categorias = await categoriasOrdenadasParaReporte(['DICCIONARIO', 'REVISTA', 'FOLLETO']);

    // Revista (orden 1) primero, Folleto (orden 0) despues, Diccionario (orden 5)
    // al final - no alfabetico (que hubiera sido Diccionario, Folleto, Revista).
    expect(categorias.map((c) => c.clave)).toEqual(['FOLLETO', 'REVISTA', 'DICCIONARIO']);
  });
});

describe('ordenarFilasPorTipoDocumentoSiAplica (categorias "variante" con sello, ej.)', () => {
  function fila(tipoDocumento) {
    return { atributos: { TIPO_DE_DOCUMENTO: tipoDocumento } };
  }

  const categoriaConCheck = {
    ordenarPorTipoDocumento: true,
    campos: [{ clave: 'TIPO_DE_DOCUMENTO', etiqueta: 'Tipo de documento', requerido: false }],
  };

  test('sin el check activo, las filas se quedan en el orden que traian (no se toca nada)', () => {
    const filas = [fila('Revista'), fila('Libro'), fila('Folleto')];
    const categoriaSinCheck = { ...categoriaConCheck, ordenarPorTipoDocumento: false };

    const resultado = ordenarFilasPorTipoDocumentoSiAplica(categoriaSinCheck, filas);

    expect(resultado).toBe(filas); // ni siquiera copia el arreglo si no aplica.
  });

  test('con el check activo pero sin campo "Tipo de documento" en la categoria, tampoco se toca nada', () => {
    const filas = [fila('Revista'), fila('Libro')];
    const categoriaSinCampo = { ordenarPorTipoDocumento: true, campos: [{ clave: 'ISBN', etiqueta: 'ISBN' }] };

    const resultado = ordenarFilasPorTipoDocumentoSiAplica(categoriaSinCampo, filas);

    expect(resultado).toBe(filas);
  });

  test('con el check activo y el campo presente, reordena Libro, Revista, Folleto, Publicaciones Institucionales', () => {
    const revista = fila('Revista');
    const publicaciones = fila('Publicaciones Institucionales');
    const libro = fila('Libro');
    const folleto = fila('Folleto');
    const filas = [revista, publicaciones, libro, folleto];

    const resultado = ordenarFilasPorTipoDocumentoSiAplica(categoriaConCheck, filas);

    expect(resultado).toEqual([libro, revista, folleto, publicaciones]);
  });

  test('un valor que no coincide con ninguno de los 4 (o vacio) se manda al final, sin romper nada', () => {
    const revista = fila('Revista');
    const desconocido = fila('Algo que no es ninguno de los 4');
    const libro = fila('Libro');
    const sinValor = { atributos: {} };
    const filas = [desconocido, revista, sinValor, libro];

    const resultado = ordenarFilasPorTipoDocumentoSiAplica(categoriaConCheck, filas);

    expect(resultado.slice(0, 2)).toEqual([libro, revista]);
    expect(resultado.slice(2)).toEqual(expect.arrayContaining([desconocido, sinValor]));
  });

  test('no distingue mayusculas/acentos al comparar el valor (Espanol-style normalizarTexto)', () => {
    const libroMayusculas = fila('LIBRO');
    const revistaConEspacios = fila('  Revista  ');
    const filas = [revistaConEspacios, libroMayusculas];

    const resultado = ordenarFilasPorTipoDocumentoSiAplica(categoriaConCheck, filas);

    expect(resultado).toEqual([libroMayusculas, revistaConEspacios]);
  });

  test('agruparFilasPorTipoDocumentoSiAplica: una tabla por tipo (Libro, Revista, Folleto, Publicaciones); luego otros tipos en orden alfabetico y al final las filas sin tipo', () => {
    const libro1 = fila('Libro');
    const libro2 = fila('libro ');
    const revista = fila('Revista');
    const folleto = fila('Folleto');
    // Los Excel reales lo escriben en singular, y es el mismo tipo que el plural.
    const publicacionSingular = fila('Publicacion Institucional ');
    const publicacionPlural = fila('Publicaciones Institucionales');
    const boletin = fila('Boletín');
    const acta = fila('Acta');
    const sinTipo = { atributos: {} };

    const grupos = agruparFilasPorTipoDocumentoSiAplica(categoriaConCheck, [
      boletin, revista, sinTipo, libro1, publicacionSingular, acta, folleto, libro2, publicacionPlural,
    ]);

    expect(grupos.map((g) => g.tipo)).toEqual([
      'Libro', 'Revista', 'Folleto', 'Publicaciones Institucionales', 'Acta', 'Boletín', 'Sin tipo de documento',
    ]);
    expect(grupos[0].filas).toEqual([libro1, libro2]);
    expect(grupos[3].filas).toEqual([publicacionSingular, publicacionPlural]);
    expect(grupos[6].filas).toEqual([sinTipo]);
  });

  test('agruparFilasPorTipoDocumentoSiAplica: devuelve null (una sola tabla, como siempre) sin el check o sin el campo "Tipo de documento"', () => {
    const filas = [fila('Libro'), fila('Revista')];
    expect(agruparFilasPorTipoDocumentoSiAplica({ ...categoriaConCheck, ordenarPorTipoDocumento: false }, filas)).toBeNull();
    expect(agruparFilasPorTipoDocumentoSiAplica({ ordenarPorTipoDocumento: true, campos: [] }, filas)).toBeNull();
  });
});

// pdfkit comprime el contenido de cada hoja y parte el texto en varios trozos hexadecimales
// (kerning), asi que buscar un texto directo en los bytes del PDF no sirve: aqui se descomprime
// cada flujo y se vuelve a armar el texto de cada operador TJ.
function textosDelPdf(buffer) {
  const textos = [];
  const crudo = buffer.toString('latin1');
  for (const flujo of crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenido;
    try {
      contenido = zlib.inflateSync(Buffer.from(flujo[1], 'latin1')).toString('latin1');
    } catch (err) {
      continue; // fuentes u otros flujos que no son contenido de una hoja
    }
    for (const tj of contenido.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      textos.push([...tj[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
    }
  }
  return textos;
}

describe('Encabezado en la primera hoja de cada categoria y numero de hoja', () => {
  async function descargarPdf(query) {
    const res = await api(app)
      .get(`/api/exports/catalog?${query}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    return res.body;
  }

  async function crearRegistros(clave, cantidad) {
    for (let i = 0; i < cantidad; i++) {
      await Catalog.create({
        categoria: clave,
        autor: `Autor ${i}`,
        titulo: `Titulo ${clave} ${i}`,
        atributos: { EDITORIAL: 'Ed' },
        estadoRevision: ESTADOS_REVISION.APROBADO,
        enviado: true,
        registradoPor: manager._id,
      });
    }
  }

  test('el titulo del reporte sale una vez por categoria (en su primera hoja), no en las demas hojas de esa categoria', async () => {
    // Suficientes registros de LIBRO para que ocupen varias hojas.
    await crearRegistros('LIBRO', 70);
    await crearRegistros('FOLLETO', 1);

    const pdf = await descargarPdf('');
    const textos = textosDelPdf(pdf);
    const hojas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

    expect(hojas).toBeGreaterThanOrEqual(3);
    expect(textos.filter((t) => t === 'Reporte de catálogo')).toHaveLength(2);
    expect(textos.filter((t) => t.startsWith('Biblioteca - Facultad'))).toHaveLength(2);
  });

  test('con el check de "Tipo de documento", cada tipo va en su propia tabla y en una hoja nueva (libros aparte, revistas aparte...)', async () => {
    const crear = async (tipo, cantidad) => {
      for (let i = 0; i < cantidad; i++) {
        await Catalog.create({
          categoria: 'DOCS_DE_DONACION',
          autor: `Autor ${tipo} ${i}`,
          titulo: `Titulo ${tipo} ${i}`,
          atributos: { EDITORIAL: 'Ed', TIPO_DE_DOCUMENTO: tipo },
          estadoRevision: ESTADOS_REVISION.APROBADO,
          enviado: true,
          registradoPor: manager._id,
        });
      }
    };
    // Se crean en desorden a proposito: el reporte tiene que ordenarlos Libro, Revista, Folleto.
    await crear('Revista', 2);
    await crear('Folleto', 1);
    await crear('Libro', 3);

    const pdf = await descargarPdf('categoria=DOCS_DE_DONACION');
    const textos = textosDelPdf(pdf);
    const hojas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

    expect(hojas).toBe(3);
    const posicion = (titulo) => textos.indexOf(titulo);
    expect(posicion('Docs de Donacion - Libro (3)')).toBeGreaterThanOrEqual(0);
    expect(posicion('Docs de Donacion - Revista (2)')).toBeGreaterThan(posicion('Docs de Donacion - Libro (3)'));
    expect(posicion('Docs de Donacion - Folleto (1)')).toBeGreaterThan(posicion('Docs de Donacion - Revista (2)'));
    // La categoria entera cuenta como una sola: sus 3 hojas se numeran 1 de 3, 2 de 3, 3 de 3.
    [1, 2, 3].forEach((n) => expect(textos).toContain(`Hoja ${n} de 3`));
  });

  test('la columna ID se ensancha para que un ID de texto largo (ej. "SHL-123-C2") salga completo, sin partirse en dos lineas', async () => {
    for (const idInventario of ['20-F C1', 'SHL-123-C2']) {
      await Catalog.create({
        categoria: 'LIBRO',
        idInventario,
        autor: `Autor ${idInventario}`,
        titulo: `Titulo ${idInventario}`,
        atributos: { EDITORIAL: 'Ed' },
        estadoRevision: ESTADOS_REVISION.APROBADO,
        enviado: true,
        registradoPor: manager._id,
      });
    }

    const pdf = await descargarPdf('');
    const textos = textosDelPdf(pdf);

    // Si la celda hubiera partido el ID en dos lineas, el texto saldria en dos trozos
    // distintos y esta comparacion exacta no lo encontraria.
    expect(textos).toContain('20-F C1');
    expect(textos).toContain('SHL-123-C2');
  });

  test('por defecto el reporte lista los registros en el orden en que se ingresaron (como el Excel), no los mas recientes primero', async () => {
    for (const idInventario of ['ORD-1', 'ORD-2', 'ORD-3', 'ORD-4']) {
      await Catalog.create({
        categoria: 'LIBRO',
        idInventario,
        autor: `Autor ${idInventario}`,
        titulo: `Titulo ${idInventario}`,
        atributos: { EDITORIAL: 'Ed' },
        estadoRevision: ESTADOS_REVISION.APROBADO,
        enviado: true,
        registradoPor: manager._id,
      });
    }

    const textos = textosDelPdf(await descargarPdf(''));
    const posiciones = ['ORD-1', 'ORD-2', 'ORD-3', 'ORD-4'].map((id) => textos.indexOf(id));

    expect(posiciones.every((p) => p >= 0)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  test('el numero de hoja ("Hoja N de X") se cuenta por categoria: cada una arranca en "Hoja 1" y X son solo sus hojas', async () => {
    // LIBRO (orden 1) sale primero y ocupa varias hojas; FOLLETO (orden 3) va despues y ocupa 1.
    await crearRegistros('LIBRO', 70);
    await crearRegistros('FOLLETO', 1);

    const pdf = await descargarPdf('');
    const textos = textosDelPdf(pdf);
    const hojas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const hojasLibro = hojas - 1;

    expect(hojasLibro).toBeGreaterThanOrEqual(2);
    for (let n = 1; n <= hojasLibro; n++) {
      expect(textos.filter((t) => t === `Hoja ${n} de ${hojasLibro}`)).toHaveLength(1);
    }
    expect(textos.filter((t) => t === 'Hoja 1 de 1')).toHaveLength(1); // la unica hoja de FOLLETO
    // Ni una etiqueta de mas: una por hoja, ni mas ni menos.
    expect(textos.filter((t) => /^Hoja \d+ de \d+$/.test(t))).toHaveLength(hojas);
  });
});
