const mongoose = require('mongoose');

const campoSchema = new mongoose.Schema(
  {
    clave: { type: String, required: true, trim: true },
    etiqueta: { type: String, required: true, trim: true },
    requerido: { type: Boolean, default: true },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    clave: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    nombre: {
      type: String,
      required: [true, 'El nombre de la categoria es obligatorio'],
      trim: true,
    },
    campos: {
      type: [campoSchema],
      default: [],
    },
    camposComunesDesactivados: {
      type: [String],
      default: [],
    },
    activo: {
      type: Boolean,
      default: true,
    },
    // En que orden aparece esta categoria en el reporte PDF (menor primero). Categorias con el
    // mismo orden (ej. todas en 0 por defecto) se desempatan por nombre, para que el orden no
    // quede indefinido hasta que la Manager lo configure.
    orden: {
      type: Number,
      default: 0,
    },
    // Cuando esta activo, las FILAS de esta categoria en el reporte PDF no van en el orden
    // normal - se reordenan segun el valor de su campo "Tipo de documento" (Libro, Revista,
    // Folleto, Publicaciones Institucionales, ese orden fijo - ver ORDEN_TIPO_DOCUMENTO en
    // export_controller.js). Pensado para categorias "variante" (ej. materiales con un sello
    // especial) que agrupan libros/revistas/folletos/publicaciones bajo una sola categoria y
    // quieren que el reporte los muestre agrupados por que tipo de material son en realidad.
    ordenarPorTipoDocumento: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
