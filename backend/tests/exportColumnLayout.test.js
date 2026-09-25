require('./setupEnv');

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
  ANCHO_MIN_ATRIBUTO,
  ANCHO_MAX_ATRIBUTO,
  ANCHO_MAX_ESTADO_FISICO,
  ANCHO_ID,
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

function nuevoDoc() {
  return new PDFDocument({ margin: 40, size: [612, 936], layout: 'landscape' });
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
    // Un campo ancho definido PRIMERO en Gestion de Categorias, seguido de 3 angostos. Antes
    // (empaquetado en el orden de los campos) el ancho se probaba primero, se quedaba solo con
    // el espacio y los 3 angostos se iban de una a la continuacion - 1 sola columna extra en la
    // fila principal. Ordenando por ancho (angostas primero), las 3 angostas SI caben juntas en
    // la fila principal y es el ancho el que se va solo a la continuacion - 3 columnas extra en
    // vez de 1, que es justo lo que se busca: aprovechar al maximo la primera fila.
    const categoriaDoc = await Category.create({
      clave: 'PRUEBA_ORDEN_ANCHO',
      nombre: 'Prueba orden ancho',
      campos: [
        { clave: 'ANCHO', etiqueta: 'Campo Ancho', requerido: false },
        { clave: 'A', etiqueta: 'Campo A', requerido: false },
        { clave: 'B', etiqueta: 'Campo B', requerido: false },
        { clave: 'C', etiqueta: 'Campo C', requerido: false },
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
        A: 'x',
        B: 'x',
        C: 'x',
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
});
