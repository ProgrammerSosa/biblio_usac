import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Save, ArrowLeft } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ROLES } from '../../shared/constants';
import Button from '../../shared/components/Button';
import { Input, Select, Textarea } from '../../shared/components/FormField';
import AlertBanner from '../../shared/components/AlertBanner';
import CargandoBiblioteca from '../../shared/components/CargandoBiblioteca';

const CAMPOS_COMUNES_INICIALES = {
  categoria: '',
  idInventario: '',
  autor: '',
  titulo: '',
  idioma: '',
  anio: '',
  edicion: '',
  lugar: '',
  paginasImpresas: '',
  estadoFisico: '',
};

// Bloque del formulario con su titulo: agrupa campos relacionados para que no se vea todo mezclado.
function SeccionFormulario({ titulo, children }) {
  return (
    <section className="flex flex-col gap-4 px-6 py-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h2>
      {children}
    </section>
  );
}

export default function CatalogFormPage() {
  const { id } = useParams();
  const esEdicion = !!id;
  const { user } = useAuth();
  const { categorias, camposDe, porClave, loading: cargandoCategorias } = useCategories();
  const navigate = useNavigate();

  const [form, setForm] = useState({ ...CAMPOS_COMUNES_INICIALES });
  const [atributos, setAtributos] = useState({});
  const [cargando, setCargando] = useState(esEdicion);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const categoriasDisponibles =
    user?.rol === ROLES.USER ? categorias.filter((c) => user.allowedCategories.includes(c.clave)) : categorias;
  const camposCondicionales = camposDe(form.categoria);
  const comunesDesactivados = porClave(form.categoria)?.camposComunesDesactivados || [];
  const comunHabilitado = (clave) => !comunesDesactivados.includes(clave);
  const grupo1Visibles = ['idioma', 'anio', 'edicion'].filter(comunHabilitado).length;
  const grupo2Visibles = ['lugar', 'paginasImpresas'].filter(comunHabilitado).length;

  useEffect(() => {
    if (!esEdicion) return;

    catalogApi
      .getById(id)
      .then((res) => {
        const item = res.data.data;
        setForm({
          categoria: item.categoria || '',
          idInventario: item.idInventario || '',
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
      <CargandoBiblioteca
        mensaje={esEdicion ? 'Abriendo el registro' : 'Preparando el formulario'}
        detalle="Un momento, estamos sacando el libro de la repisa..."
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/catalogo" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
        <ArrowLeft size={16} />
        Volver al catalogo
      </Link>

      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <h1 className="text-lg font-semibold text-primary-dark">
            {esEdicion ? 'Editar material' : 'Registrar nuevo material'}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">Los campos con <span className="text-secondary">*</span> son obligatorios.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col divide-y divide-border">
          <SeccionFormulario titulo="Identificacion">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Categoria" required value={form.categoria} onChange={(e) => handleChangeCategoria(e.target.value)}>
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
                label="ID"
                required
                placeholder="Ej. 1L, 20F, 20F-C1"
                value={form.idInventario}
                onChange={(e) => handleChange('idInventario', e.target.value)}
              />
            </div>
          </SeccionFormulario>

          <SeccionFormulario titulo="Datos del material">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Autor" required value={form.autor} onChange={(e) => handleChange('autor', e.target.value)} />
              <Input label="Titulo" required value={form.titulo} onChange={(e) => handleChange('titulo', e.target.value)} />
            </div>

            {grupo1Visibles > 0 && (
              <div
                className={`grid gap-4 ${
                  grupo1Visibles === 3 ? 'sm:grid-cols-3' : grupo1Visibles === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'
                }`}
              >
                {comunHabilitado('idioma') ? (
                  <Input label="Idioma" value={form.idioma} onChange={(e) => handleChange('idioma', e.target.value)} />
                ) : null}
                {comunHabilitado('anio') ? (
                  <Input label="Año" value={form.anio} onChange={(e) => handleChange('anio', e.target.value)} />
                ) : null}
                {comunHabilitado('edicion') ? (
                  <Input label="Edicion" value={form.edicion} onChange={(e) => handleChange('edicion', e.target.value)} />
                ) : null}
              </div>
            )}

            {grupo2Visibles > 0 && (
              <div className={`grid gap-4 ${grupo2Visibles === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
                {comunHabilitado('lugar') ? (
                  <Input label="Lugar" value={form.lugar} onChange={(e) => handleChange('lugar', e.target.value)} />
                ) : null}
                {comunHabilitado('paginasImpresas') ? (
                  <Input
                    label="Paginas impresas"
                    type="number"
                    min="0"
                    value={form.paginasImpresas}
                    onChange={(e) => handleChange('paginasImpresas', e.target.value)}
                  />
                ) : null}
              </div>
            )}
          </SeccionFormulario>

          {camposCondicionales.length > 0 ? (
            <SeccionFormulario titulo={`Datos propios de ${porClave(form.categoria)?.nombre || 'la categoria'}`}>
              <div className="grid gap-4 sm:grid-cols-2">
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
            </SeccionFormulario>
          ) : null}

          {comunHabilitado('estadoFisico') ? (
            <SeccionFormulario titulo="Estado fisico">
              <Textarea
                placeholder="Describe el estado del material, ej. Pasta dañada, manchas de humedad en portadas"
                value={form.estadoFisico}
                onChange={(e) => handleChange('estadoFisico', e.target.value)}
              />
            </SeccionFormulario>
          ) : null}

          <div className="flex flex-col gap-3 rounded-b-xl bg-slate-50 px-6 py-4">
            <AlertBanner>{error}</AlertBanner>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => navigate('/catalogo')}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
