const ExcelJS = require('exceljs');

// Los Excel reales de la biblioteca traen encabezados con espacios sueltos y acentos
// inconsistentes ("Año ", "No. De Inventario", "Estado fisíco "), asi que se normalizan
// antes de compararlos: sin acentos, sin espacios extra, en minusculas.
function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita los acentos que quedan sueltos tras NFD
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Nombre de hoja de Excel -> clave de categoria ya existente en el sistema.
const HOJA_A_CATEGORIA = {
  'libros': 'LIBRO',
  'enciclopedias': 'ENCICLOPEDIA',
  'revistas': 'REVISTA',
  'diccionarios': 'DICCIONARIO',
  'folletos': 'FOLLETO',
  'publicacion institucional': 'PUBLICACIONES_INSTITUCIONALES',
  'publicaciones institucionales': 'PUBLICACIONES_INSTITUCIONALES',
};

// Encabezado normalizado de columna -> donde cae ese valor. Los campos propios de cada
// categoria (editorial, isbn, issn, volumen, tomos, tipo de documento) se resuelven aparte,
// comparando contra las claves reales de esa categoria en ese momento.
const CAMPOS_COMUNES = {
  autor: 'autor',
  titulo: 'titulo',
  idioma: 'idioma',
  ano: 'anio',
  edicion: 'edicion',
  lugar: 'lugar',
  'paginas impresas': 'paginasImpresas',
  'no. de inventario': 'noInventario',
  'no de inventario': 'noInventario',
  'estado fisico': 'estadoFisico',
};

const CAMPOS_NOTAS = ['notas', 'nota'];

// Columnas que existen en los Excel reales de la biblioteca pero no son un dato del material:
// se ignoran sin avisar (no tiene sentido pedir que se "creen como atributo de categoria").
// Ya no se usa un numero de copias declarado a mano: las copias se detectan solas (misma
// categoria+autor+titulo+edicion+idioma, sin importar el estado fisico). "No." es solo el
// numero de fila/renglon del Excel, no un dato a guardar.
const CAMPOS_IGNORADOS = ['copias', 'copia', 'no.', 'no', '#'];

// Alias para columnas que son "campos propios de categoria" pero cuyo encabezado en Excel
// no coincide letra por letra con la clave guardada en Category (ej. "Volúmen " -> VOLUMEN).
const ALIAS_ATRIBUTOS = {
  volumen: 'VOLUMEN',
  tomos: 'TOMOS',
  isbn: 'ISBN',
  issn: 'ISSN',
  editorial: 'EDITORIAL',
  'tipo de documento': 'TIPO_DE_DOCUMENTO',
};

function leerEncabezados(worksheet) {
  const fila = worksheet.getRow(1);
  const encabezados = {};
  fila.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const normalizado = normalizarTexto(cell.value);
    if (normalizado) encabezados[colNumber] = normalizado;
  });
  return encabezados;
}

function valorCelda(cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object' && cell.text !== undefined) return cell.text;
  if (typeof cell === 'object' && cell.result !== undefined) return cell.result;
  return cell;
}

function filaVacia(datos) {
  return !datos.autor?.toString().trim() && !datos.titulo?.toString().trim();
}

// Misma regla que la vista de catalogo (CatalogListPage): dos filas son "el mismo material"
// si autor, titulo, edicion e idioma coinciden 100% (normalizado - sin acentos ni espacios
// de mas), sin importar el estado fisico. Ya no se declara un numero de copias a mano: si
// varias filas del Excel cumplen esto, se cuentan solas como copias del mismo registro.
function claveDeGrupo(datos) {
  return ['autor', 'titulo', 'edicion', 'idioma'].map((campo) => normalizarTexto(datos[campo])).join('|');
}

function agruparPorCopias(items) {
  const grupos = new Map();
  for (const item of items) {
    const clave = claveDeGrupo(item);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(item);
  }

  return [...grupos.values()].map((grupo) => {
    const base = grupo[0];
    // Si cada fila agrupada traia su propio No. de Inventario (copias fisicas ya numeradas
    // en el Excel), se conservan todos en orden para que cada copia creada se quede con el
    // suyo en vez de perderlo al fusionar las filas en un solo item de la vista previa.
    const noInventarios = grupo.map((i) => i.noInventario).filter(Boolean);
    const errores = [...new Set(grupo.flatMap((i) => i.errores))];
    const camposFaltantes = [...new Set(grupo.flatMap((i) => i.camposFaltantes))];

    return {
      ...base,
      filas: grupo.map((i) => i.fila),
      noInventario: noInventarios[0],
      noInventarios,
      copias: grupo.length,
      errores,
      valido: errores.length === 0,
      camposFaltantes,
    };
  });
}

/**
 * Lee un workbook de Excel y devuelve, por cada hoja reconocida, la lista de items
 * detectados (sin guardar nada en la base todavia). categoriasPorClave es un Map de
 * clave de categoria -> documento de Category (para saber que atributos aplican y
 * cuales son obligatorios).
 */
async function previsualizarWorkbook(buffer, categoriasPorClave) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const resultado = [];

  for (const worksheet of workbook.worksheets) {
    const nombreHoja = normalizarTexto(worksheet.name);
    const claveCategoria = HOJA_A_CATEGORIA[nombreHoja];
    if (!claveCategoria) continue;

    const categoria = categoriasPorClave.get(claveCategoria);
    if (!categoria) continue;

    const encabezados = leerEncabezados(worksheet);
    const clavesAtributos = new Map(categoria.campos.map((c) => [normalizarTexto(c.etiqueta), c.clave]));

    // Columnas del Excel que no caen en ningun campo conocido de esta categoria: se ignoran
    // al leer los datos, pero se avisan en la vista previa para que no se pierdan calladas -
    // el campo hay que crearlo primero en Gestion de Categorias si se quiere capturar.
    const conocidos = new Set([
      ...Object.keys(CAMPOS_COMUNES),
      ...CAMPOS_NOTAS,
      ...CAMPOS_IGNORADOS,
      ...clavesAtributos.keys(),
      ...Object.keys(ALIAS_ATRIBUTOS),
    ]);
    const camposDesconocidos = [...new Set(Object.values(encabezados))].filter((h) => !conocidos.has(h));

    const items = [];
    worksheet.eachRow({ includeEmpty: false }, (row, numeroFila) => {
      if (numeroFila === 1) return; // encabezado

      const datos = {
        categoria: claveCategoria,
        noInventario: '',
        autor: '',
        titulo: '',
        idioma: '',
        anio: '',
        edicion: '',
        lugar: '',
        paginasImpresas: '',
        estadoFisico: '',
        atributos: {},
      };
      let notas = '';

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const encabezado = encabezados[colNumber];
        if (!encabezado) return;
        const valor = valorCelda(cell.value);
        if (valor === '' || valor === null || valor === undefined) return;

        if (CAMPOS_COMUNES[encabezado]) {
          datos[CAMPOS_COMUNES[encabezado]] = valor;
          return;
        }
        if (CAMPOS_NOTAS.includes(encabezado)) {
          notas = String(valor).trim();
          return;
        }
        if (CAMPOS_IGNORADOS.includes(encabezado)) {
          return;
        }

        const claveDesdeCategoria = clavesAtributos.get(encabezado) || ALIAS_ATRIBUTOS[encabezado];
        if (claveDesdeCategoria) {
          datos.atributos[claveDesdeCategoria] = valor;
        }
      });

      if (filaVacia(datos)) return;

      if (datos.paginasImpresas !== '') {
        const n = parseInt(datos.paginasImpresas, 10);
        datos.paginasImpresas = Number.isFinite(n) ? n : '';
      }
      if (notas) {
        datos.estadoFisico = [datos.estadoFisico, notas].filter(Boolean).join(' - ');
      }
      datos.noInventario = String(datos.noInventario || '').trim() || undefined;
      datos.autor = String(datos.autor || '').trim();
      datos.titulo = String(datos.titulo || '').trim();

      // Autor y titulo son lo unico que de verdad bloquea la fila (sin eso el registro no
      // significa nada). Los campos propios de la categoria que falten (ISBN, Editorial, etc.)
      // no descartan la fila: se llenan con "N/A" y se marcan en camposFaltantes para que la
      // vista previa los resalte en rojo - el que revise despues completa el dato real.
      const errores = [];
      if (!datos.autor) errores.push('Falta el autor');
      if (!datos.titulo) errores.push('Falta el titulo');

      const camposFaltantes = [];
      for (const campo of categoria.campos) {
        const valor = datos.atributos[campo.clave];
        if (campo.requerido && (valor === undefined || valor === null || valor === '')) {
          datos.atributos[campo.clave] = 'N/A';
          camposFaltantes.push(campo.clave);
        }
      }

      items.push({ fila: numeroFila, ...datos, valido: errores.length === 0, errores, camposFaltantes });
    });

    if (items.length > 0) {
      resultado.push({
        hoja: worksheet.name,
        categoria: claveCategoria,
        nombreCategoria: categoria.nombre,
        items: agruparPorCopias(items),
        camposDesconocidos,
      });
    }
  }

  return resultado;
}

module.exports = { previsualizarWorkbook, normalizarTexto };
