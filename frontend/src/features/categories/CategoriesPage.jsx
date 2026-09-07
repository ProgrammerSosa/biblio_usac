import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, X, Tags } from 'lucide-react';
import { categoriesApi } from './categoriesApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useCategories } from '../../shared/hooks/useCategories';
import DataTable from '../../shared/components/DataTable';
import Badge from '../../shared/components/Badge';
import Button from '../../shared/components/Button';
import Modal from '../../shared/components/Modal';
import AlertBanner from '../../shared/components/AlertBanner';
import { Input } from '../../shared/components/FormField';

const CAMPO_VACIO = () => ({ etiqueta: '', requerido: true });

export default function CategoriesPage() {
  const { recargar } = useCategories();
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [nombre, setNombre] = useState('');
  const [campos, setCampos] = useState([CAMPO_VACIO()]);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  const [categoriaAConfirmar, setCategoriaAConfirmar] = useState(null);
  const [usoCategoria, setUsoCategoria] = useState(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const res = await categoriesApi.list(true);
      setCategorias(res.data.data);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar las categorias'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirNueva() {
    setEditando(null);
    setNombre('');
    setCampos([CAMPO_VACIO()]);
    setErrorModal('');
    setModalAbierto(true);
  }

  function abrirEditar(categoria) {
    setEditando(categoria);
    setNombre(categoria.nombre);
    setCampos(categoria.campos.length > 0 ? categoria.campos.map((c) => ({ ...c })) : [CAMPO_VACIO()]);
    setErrorModal('');
    setModalAbierto(true);
  }

  function actualizarCampo(index, cambios) {
    setCampos((prev) => prev.map((c, i) => (i === index ? { ...c, ...cambios } : c)));
  }

  function agregarCampo() {
    setCampos((prev) => [...prev, CAMPO_VACIO()]);
  }

  function quitarCampo(index) {
    setCampos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleGuardar(e) {
    e.preventDefault();
    setErrorModal('');

    if (!nombre.trim()) {
      setErrorModal('El nombre de la categoria es obligatorio');
      return;
    }

    const camposValidos = campos.filter((c) => c.etiqueta.trim());

    setGuardando(true);
    try {
      if (editando) {
        await categoriesApi.update(editando._id, { nombre, campos: camposValidos });
      } else {
        await categoriesApi.create({ nombre, campos: camposValidos });
      }
      setModalAbierto(false);
      await cargar();
      await recargar();
    } catch (err) {
      setErrorModal(getErrorMessage(err, 'No se pudo guardar la categoria'));
    } finally {
      setGuardando(false);
    }
  }

  async function abrirConfirmacionEstado(categoria) {
    setCategoriaAConfirmar(categoria);
    setUsoCategoria(null);
    if (categoria.activo) {
      try {
        const res = await categoriesApi.uso(categoria._id);
        setUsoCategoria(res.data.data.total);
      } catch {
        setUsoCategoria(null);
      }
    }
  }

  async function confirmarCambioEstado() {
    if (!categoriaAConfirmar) return;
    setCambiandoEstado(true);
    setError('');
    try {
      await categoriesApi.setEstado(categoriaAConfirmar._id, !categoriaAConfirmar.activo);
      setCategoriaAConfirmar(null);
      await cargar();
      await recargar();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo actualizar el estado de la categoria'));
    } finally {
      setCambiandoEstado(false);
    }
  }

  const columns = [
    { key: 'nombre', header: 'Nombre' },
    { key: 'clave', header: 'Clave', render: (row) => <code className="text-xs text-slate-500">{row.clave}</code> },
    {
      key: 'campos',
      header: 'Campos propios',
      render: (row) =>
        row.campos.length > 0 ? (
          <span className="text-slate-600">{row.campos.map((c) => c.etiqueta).join(', ')}</span>
        ) : (
          <span className="text-slate-400">Ninguno</span>
        ),
    },
    {
      key: 'activo',
      header: 'Estado',
      render: (row) => (row.activo ? <Badge tone="success">Activa</Badge> : <Badge tone="danger">Desactivada</Badge>),
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <div className="flex gap-2">
          <button onClick={() => abrirEditar(row)} className="text-primary hover:text-primary-light" title="Editar">
            <Pencil size={16} />
          </button>
          <button
            onClick={() => abrirConfirmacionEstado(row)}
            className={row.activo ? 'text-secondary hover:text-red-700' : 'text-emerald-600 hover:text-emerald-700'}
            title={row.activo ? 'Desactivar' : 'Activar'}
          >
            {row.activo ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Tags size={17} />
          </div>
          <h1 className="text-xl font-semibold text-primary-dark">Categorias del catalogo</h1>
        </div>
        <Button icon={Plus} onClick={abrirNueva}>
          Nueva categoria
        </Button>
      </div>

      <p className="max-w-2xl text-sm text-slate-500">
        Cada categoria define sus propios campos adicionales (por ejemplo ISBN para Libro, o Tomos para Enciclopedia).
        Los campos comunes (autor, titulo, idioma, año, edicion, lugar, paginas, estado fisico) aplican siempre.
      </p>

      <AlertBanner>{error}</AlertBanner>

      <DataTable columns={columns} rows={categorias} rowKey="_id" loading={loading} emptyMessage="Aun no hay categorias" />

      <Modal
        open={modalAbierto}
        title={editando ? `Editar categoria: ${editando.nombre}` : 'Nueva categoria'}
        onClose={() => setModalAbierto(false)}
      >
        <form onSubmit={handleGuardar} className="flex flex-col gap-4">
          <Input label="Nombre" required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
          {editando ? (
            <p className="-mt-2 text-xs text-slate-400">
              Clave interna: <code>{editando.clave}</code> (no cambia aunque edites el nombre)
            </p>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Campos propios de esta categoria</span>
              <Button type="button" variant="secondary" icon={Plus} onClick={agregarCampo}>
                Agregar campo
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {campos.map((campo, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Ej. Numero de serie"
                    value={campo.etiqueta}
                    onChange={(e) => actualizarCampo(index, { etiqueta: e.target.value })}
                    className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={campo.requerido}
                      onChange={(e) => actualizarCampo(index, { requerido: e.target.checked })}
                      className="rounded border-border text-primary focus:ring-primary/30"
                    />
                    Obligatorio
                  </label>
                  <button
                    type="button"
                    onClick={() => quitarCampo(index)}
                    className="text-slate-400 hover:text-secondary"
                    title="Quitar campo"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              {campos.length === 0 ? <p className="text-xs text-slate-400">Esta categoria no tendra campos propios.</p> : null}
            </div>
          </div>

          <AlertBanner>{errorModal}</AlertBanner>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!categoriaAConfirmar}
        title={categoriaAConfirmar?.activo ? 'Desactivar categoria' : 'Activar categoria'}
        onClose={() => setCategoriaAConfirmar(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCategoriaAConfirmar(null)}>
              Cancelar
            </Button>
            <Button
              variant={categoriaAConfirmar?.activo ? 'danger' : 'primary'}
              onClick={confirmarCambioEstado}
              disabled={cambiandoEstado}
            >
              {cambiandoEstado ? 'Guardando...' : categoriaAConfirmar?.activo ? 'Desactivar' : 'Activar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {categoriaAConfirmar?.activo ? (
            <>
              <strong>{categoriaAConfirmar?.nombre}</strong> dejara de aparecer como opcion al registrar material nuevo.
              {usoCategoria !== null ? (
                <>
                  {' '}
                  Actualmente tiene <strong>{usoCategoria}</strong> registro(s) en el catalogo, que no se modifican.
                </>
              ) : null}
            </>
          ) : (
            <>
              <strong>{categoriaAConfirmar?.nombre}</strong> volvera a estar disponible para registrar material nuevo.
            </>
          )}
        </p>
      </Modal>
    </div>
  );
}
