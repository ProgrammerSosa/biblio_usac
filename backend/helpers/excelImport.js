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
  'estado fisico': 'estadoFisico',
};

// Respaldo para categorias SIN un atributo propio de notas: si el Excel trae una columna
// "Notas"/"Nota", su texto se pega al final de "Estado fisico" (ver mas abajo) en vez de
// perderse. Si la categoria SI tiene su propio campo (ej. un atributo llamado "Notas" creado
// en Gestion de Categorias), ese campo manda y esto no se usa - ver el orden de revision en
// el loop de celdas.
const CAMPOS_NOTAS = ['notas', 'nota'];

// Columnas que existen en los Excel reales de la biblioteca pero no son un dato del material:
// se ignoran sin avisar (no tiene sentido pedir que se "creen como atributo de categoria").
// El No. de Inventario tampoco se lee mas: ahora se asigna solo al aprobar (ver
// helpers/idInventario.js), asi que esa columna del Excel se ignora igual que "No." (que
// siempre fue solo el numero de fila/renglon del Excel, nunca un dato a guardar). "Copias"
// tambien se ignora a proposito: declarar una cantidad a mano genera confusion (¿es el total
// o lo adicional?) - las copias se detectan solas agrupando filas con los mismos datos (ver
// claveDeGrupo/agruparPorCopias mas abajo), asi que basta con pegar una fila por ejemplar
// fisico, igual que antes.
const CAMPOS_IGNORADOS = ['no.', 'no', '#', 'no. de inventario', 'no de inventario', 'copias', 'copia'];

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
  if (typeof cell === 'object') {
    // Texto con formato mixto dentro de una misma celda (ej. una palabra en negrita) - Excel
    // lo guarda como varios "runs" en vez de un solo texto pl. Sin esto, el objeto crudo
    // llega hasta la base de datos y se guarda literal como "[object Object]", o revienta la
    // validacion (los campos de texto no aceptan un objeto).
    if (Array.isArray(cell.richText)) return cell.richText.map((run) => run.text || '').join('');
    if (cell.text !== undefined) return cell.text;
    if (cell.result !== undefined) return cell.result;
    // Forma de celda que no se reconoce: mejor vacio que arriesgar guardar el objeto crudo.
    return '';
  }
  return cell;
}

function filaVacia(datos) {
  return !datos.autor?.toString().trim() && !datos.titulo?.toString().trim();
}

// Misma regla que la vista de catalogo (CatalogListPage): dos filas son "el mismo material"
// si TODO coincide 100% (normalizado - sin acentos, mayusculas ni espacios de mas) excepto
// el estado fisico y el No. de Inventario - los dos unicos datos que de verdad cambian entre
// copias fisicas del mismo libro. Ya no se declara un numero de copias a mano: si varias
// filas del Excel cumplen esto, se cuentan solas como copias del mismo registro.
function claveDeGrupo(datos) {
  const camposBase = [datos.categoria, datos.autor, datos.titulo, datos.idioma, datos.anio, datos.edicion, datos.lugar, datos.paginasImpresas];
  const atributos = datos.atributos || {};
  const atributosOrdenados = Object.keys(atributos)
    .sort()
    .map((clave) => `${clave}:${atributos[clave]}`);
  return [...camposBase, ...atributosOrdenados].map(normalizarTexto).join('|');
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
    const errores = [...new Set(grupo.flatMap((i) => i.errores))];
    const camposFaltantes = [...new Set(grupo.flatMap((i) => i.camposFaltantes))];
    // Cuantas copias en total representa este grupo: cuantas filas del Excel se fusionaron
    // aqui (una fila = un ejemplar fisico). No hace falta declarar ninguna cantidad a mano.
    const copias = grupo.length;

    return {
      ...base,
      filas: grupo.map((i) => i.fila),
      copias,
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

    // ALIAS_ATRIBUTOS es una tabla fija de todo el sistema (ej. "tipo de documento" ->
    // TIPO_DE_DOCUMENTO), pero no toda categoria tiene ese campo - si Folleto ya no lo tiene
    // (lo cambiaste por "Notas" en Gestion de Categorias, por ejemplo), un Excel que todavia
    // trae esa columna no debe intentar guardarla ahi: el modelo la rechazaria al confirmar
    // ("el campo no aplica para la categoria"), un error que la vista previa nunca alcanzaba a
    // mostrar. Por eso el alias solo cuenta cuando su clave de destino SI es un campo real de
    // ESTA categoria en este momento - si no, la columna cae en "camposDesconocidos" como
    // cualquier otra columna que no aplica, y se avisa en vez de fallar en silencio despues.
    const clavesValidas = new Set(categoria.campos.map((c) => c.clave));
    const aliasValidos = Object.fromEntries(Object.entries(ALIAS_ATRIBUTOS).filter(([, clave]) => clavesValidas.has(clave)));

    // Columnas del Excel que no caen en ningun campo conocido de esta categoria: se ignoran
    // al leer los datos, pero se avisan en la vista previa para que no se pierdan calladas -
    // el campo hay que crearlo primero en Gestion de Categorias si se quiere capturar.
    const conocidos = new Set([
      ...Object.keys(CAMPOS_COMUNES),
      ...CAMPOS_NOTAS,
      ...CAMPOS_IGNORADOS,
      ...clavesAtributos.keys(),
      ...Object.keys(aliasValidos),
    ]);
    const camposDesconocidos = [...new Set(Object.values(encabezados))].filter((h) => !conocidos.has(h));

    const items = [];
    worksheet.eachRow({ includeEmpty: false }, (row, numeroFila) => {
      if (numeroFila === 1) return; // encabezado

      const datos = {
        categoria: claveCategoria,
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

        // Si la categoria ya tiene su propio campo para esto (ej. definiste un atributo
        // llamado "Notas" en Gestion de Categorias), ese campo manda: el valor se guarda ahi,
        // estructurado, en vez de pegarse a ciegas al final de "Estado fisico". El pegado a
        // Estado fisico de abajo es solo el comportamiento de respaldo para categorias que
        // todavia NO tienen un campo propio para sus notas.
        const claveDesdeCategoria = clavesAtributos.get(encabezado) || aliasValidos[encabezado];
        if (claveDesdeCategoria) {
          datos.atributos[claveDesdeCategoria] = valor;
          return;
        }

        if (CAMPOS_NOTAS.includes(encabezado)) {
          notas = String(valor).trim();
          return;
        }
        if (CAMPOS_IGNORADOS.includes(encabezado)) {
          return;
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
