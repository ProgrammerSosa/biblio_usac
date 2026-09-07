import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Save, ArrowLeft, Loader2 } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ROLES } from '../../shared/constants';
import Button from '../../shared/components/Button';
import { Input, Select, Textarea } from '../../shared/components/FormField';
import AlertBanner from '../../shared/components/AlertBanner';

const CAMPOS_COMUNES_INICIALES = {
  categoria: '',
  noInventario: '',
  autor: '',
  titulo: '',
  idioma: '',
  anio: '',
  edicion: '',
  lugar: '',
  paginasImpresas: '',
  estadoFisico: '',
};

export default function CatalogFormPage() {
  const { id } = useParams();
  const esEdicion = !!id;
  const { user } = useAuth();
  const { categorias, camposDe, loading: cargandoCategorias } = useCategories();
  const navigate = useNavigate();

  const [form, setForm] = useState({ ...CAMPOS_COMUNES_INICIALES });
  const [atributos, setAtributos] = useState({});
  const [cargando, setCargando] = useState(esEdicion);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const categoriasDisponibles =
    user?.rol === ROLES.USER ? categorias.filter((c) => user.allowedCategories.includes(c.clave)) : categorias;
  const camposCondicionales = camposDe(form.categoria);

  useEffect(() => {
    if (!esEdicion) return;

    catalogApi
      .getById(id)
      .then((res) => {
        const item = res.data.data;
        setForm({
          categoria: item.categoria || '',
          noInventario: item.noInventario || '',
          autor: item.autor || '',
          titulo: item.titulo || '',
          idioma: item.idioma || '',
          anio: item.anio || '',
          edicion: item.edicion || '',
          lugar: item.lugar || '',
          paginasImpresas: item.paginasImpresas ?? '',
          estadoFisico: item.estadoFisico || '',
        });
        setAtributos(item.atributos || {});
      })
      .catch((err) => setError(getErrorMessage(err, 'No se pudo cargar el registro')))
      .finally(() => setCargando(false));
  }, [esEdicion, id]);

  function handleChange(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function handleChangeCategoria(nuevaCategoria) {
    setForm((prev) => ({ ...prev, categoria: nuevaCategoria }));
    // Al cambiar de categoria se descartan los atributos anteriores: pertenecen a otro conjunto de campos.
    setAtributos({});
  }

  function handleChangeAtributo(clave, valor) {
    setAtributos((prev) => ({ ...prev, [clave]: valor }));
  }

  function construirPayload() {
    const payload = { ...form };
    if (payload.paginasImpresas !== '') {
      payload.paginasImpresas = Number(payload.paginasImpresas);
    } else {
      delete payload.paginasImpresas;
    }

    payload.atributos = {};
    for (const campo of camposCondicionales) {
      payload.atributos[campo.clave] = atributos[campo.clave] || '';
    }

    return payload;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);

    try {
      const payload = construirPayload();
      if (esEdicion) {
        await catalogApi.update(id, payload);
      } else {
        await catalogApi.create(payload);
      }
      navigate('/catalogo', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo guardar el registro'));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando || cargandoCategorias) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        Cargando...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/catalogo" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
        <ArrowLeft size={16} />
        Volver al catalogo
      </Link>

      <div className="rounded-lg border border-border bg-white p-6">
        <h1 className="mb-6 text-lg font-semibold text-primary-dark">
          {esEdicion ? 'Editar material' : 'Registrar nuevo material'}
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Categoria"
              required
              value={form.categoria}
              onChange={(e) => handleChangeCategoria(e.target.value)}
            >
              <option value="" disabled>
                Selecciona una categoria
              </option>
              {categoriasDisponibles.map((cat) => (
                <option key={cat.clave} value={cat.clave}>
                  {cat.nombre}
                </option>
              ))}
            </Select>
            <Input
              label="No. de Inventario"
              required
              value={form.noInventario}
              onChange={(e) => handleChange('noInventario', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Autor" required value={form.autor} onChange={(e) => handleChange('autor', e.target.value)} />
            <Input label="Titulo" required value={form.titulo} onChange={(e) => handleChange('titulo', e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Idioma" value={form.idioma} onChange={(e) => handleChange('idioma', e.target.value)} />
            <Input label="Año" value={form.anio} onChange={(e) => handleChange('anio', e.target.value)} />
            <Input label="Edicion" value={form.edicion} onChange={(e) => handleChange('edicion', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Lugar" value={form.lugar} onChange={(e) => handleChange('lugar', e.target.value)} />
            <Input
              label="Paginas impresas"
              type="number"
              min="0"
              value={form.paginasImpresas}
              onChange={(e) => handleChange('paginasImpresas', e.target.value)}
            />
          </div>

          {camposCondicionales.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 rounded-md bg-surface p-4">
              {camposCondicionales.map((campo) => (
                <Input
                  key={campo.clave}
                  label={campo.etiqueta}
                  required={campo.requerido}
                  value={atributos[campo.clave] || ''}
                  onChange={(e) => handleChangeAtributo(campo.clave, e.target.value)}
                />
              ))}
            </div>
          ) : null}

          <Textarea
            label="Estado fisico"
            placeholder="Describe el estado del material, ej. Pasta dañada, manchas de humedad en portadas"
            value={form.estadoFisico}
            onChange={(e) => handleChange('estadoFisico', e.target.value)}
          />

          <AlertBanner>{error}</AlertBanner>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/catalogo')}>
              Cancelar
            </Button>
            <Button type="submit" icon={Save} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
