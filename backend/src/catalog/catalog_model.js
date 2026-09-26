const mongoose = require('mongoose');
const Category = require('./category_model');
const { ESTADOS_REVISION } = require('../../utils/constants');

const catalogSchema = new mongoose.Schema(
  {
    categoria: {
      type: String,
      required: [true, 'La categoria es obligatoria'],
      uppercase: true,
      trim: true,
    },
    // Ya no se escribe a mano: se asigna solo, en orden (10001, 10002, 10003...), la primera
    // vez que el registro queda Aprobado (ver helpers/idInventario.js) - un registro que
    // sigue Pendiente o fue Rechazado todavia no tiene. "sparse" permite que todos esos
    // queden sin valor a la vez, sin romper la unicidad entre los que si ya lo tienen.
    idInventario: {
      type: Number,
      unique: true,
      sparse: true,
    },
    autor: {
      type: String,
      required: [true, 'El autor es obligatorio'],
      trim: true,
    },
    titulo: {
      type: String,
      required: [true, 'El titulo es obligatorio'],
      trim: true,
    },
    idioma: { type: String, trim: true },
    anio: { type: String, trim: true },
    edicion: { type: String, trim: true },
    lugar: { type: String, trim: true },
    paginasImpresas: { type: Number },
    estadoFisico: { type: String, trim: true },

    // Campos propios de la categoria (definidos dinamicamente en Category.campos),
    // ej. { editorial: 'Porrua', isbn: '978-...' }
    atributos: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    estadoRevision: {
      type: String,
      enum: Object.values(ESTADOS_REVISION),
      default: ESTADOS_REVISION.PENDIENTE,
    },
    observaciones: { type: String, trim: true },

    // Quien registra puede ir armando su lista antes de mandarla a revision. Mientras
    // enviado sea false, el registro solo lo ve su autor (borrador personal); nadie mas,
    // incluyendo Admin/Manager, lo ve hasta que se envia.
    enviado: { type: Boolean, default: false },

    registradoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Nombre del archivo Excel de origen, solo cuando el registro vino de una importacion
    // (ver confirmarImportacion). registradoPor sigue siendo quien la ejecuto, pero en la
    // interfaz se prefiere mostrar de que archivo vino, para no confundirlo con que esa
    // persona lo capturo a mano.
    origenImportacion: { type: String, trim: true, default: null },
    revisadoPorAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    eliminado: { type: Boolean, default: false },

    // "Dar de baja" es distinto de eliminar: el registro se queda visible (en el catalogo y
    // en los reportes, marcado en gris) para dejar constancia de que ese ejemplar existio y
    // ya no esta disponible (se perdio, se dono, se destruyo, etc.) - eliminar en cambio lo
    // oculta de todo. Solo Admin/Manager pueden darlo de baja (ver catalog_controller.js).
    deBaja: { type: Boolean, default: false },
    motivoBaja: { type: String, trim: true },
    fechaBaja: { type: Date, default: null },
    dadoDeBajaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

catalogSchema.pre('validate', async function preValidate(next) {
  try {
    const categoria = await Category.findOne({ clave: this.categoria });

    if (!categoria) {
      this.invalidate('categoria', `La categoria '${this.categoria}' no existe`);
      return next();
    }

    const atributos = this.atributos && typeof this.atributos === 'object' ? this.atributos : {};
    const clavesPermitidas = categoria.campos.map((c) => c.clave);

    for (const campo of categoria.campos) {
      const tieneValor = atributos[campo.clave] !== undefined && atributos[campo.clave] !== null && atributos[campo.clave] !== '';
      if (campo.requerido && !tieneValor) {
        this.invalidate(`atributos.${campo.clave}`, `El campo '${campo.etiqueta}' es obligatorio para la categoria ${categoria.nombre}`);
      }
    }

    for (const clave of Object.keys(atributos)) {
      if (!clavesPermitidas.includes(clave)) {
        this.invalidate(`atributos.${clave}`, `El campo '${clave}' no aplica para la categoria ${categoria.nombre}`);
      }
    }

    if (this.estadoRevision === ESTADOS_REVISION.RECHAZADO && !this.observaciones) {
      this.invalidate('observaciones', 'Las observaciones son obligatorias al rechazar un registro');
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

module.exports = mongoose.model('Catalog', catalogSchema);
