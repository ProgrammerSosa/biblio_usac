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
    noInventario: {
      type: String,
      required: [true, 'El numero de inventario es obligatorio'],
      unique: true,
      trim: true,
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

    registradoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    revisadoPorAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    eliminado: { type: Boolean, default: false },
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
