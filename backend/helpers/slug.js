const RANGO_DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

function generarClave(nombre) {
  return nombre
    .normalize('NFD')
    .replace(RANGO_DIACRITICOS, '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

module.exports = { generarClave };
