import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, AlertTriangle, FileDown, Search } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ESTADOS_REVISION, ESTADO_REVISION_LABELS, ROLES, tieneDanoFisico } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import EstadoRevisionBadge from '../../shared/components/EstadoRevisionBadge';
import Badge from '../../shared/components/Badge';
import Button from '../../shared/components/Button';
import Pagination from '../../shared/components/Pagination';
import Modal from '../../shared/components/Modal';
import AlertBanner from '../../shared/components/AlertBanner';
import { Select } from '../../shared/components/FormField';
import CatalogDetailFields from './CatalogDetailFields';

export default function CatalogListPage() {
  const { user } = useAuth();
  const { categorias, etiquetaDe } = useCategories();
  const [registros, setRegistros] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [categoria, setCategoria] = useState('');
  const [estadoRevision, setEstadoRevision] = useState('');
  const [buscarInput, setBuscarInput] = useState('');
  const [buscar, setBuscar] = useState('');
  const [soloMios, setSoloMios] = useState(user?.rol === ROLES.USER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [itemAEliminar, setItemAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [exportando, setExportando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 10 };
      if (categoria) params.categoria = categoria;
      if (estadoRevision) params.estadoRevision = estadoRevision;
      if (soloMios) params.registradoPor = user?.id;
      if (buscar.trim()) params.buscar = buscar.trim();
      const res = await catalogApi.list(params);
      setRegistros(res.data.data.registros);
      setTotalPages(res.data.data.totalPages);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar el catalogo'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const temporizador = setTimeout(() => {
      setPage(1);
      setBuscar(buscarInput);
    }, 350);
    return () => clearTimeout(temporizador);
  }, [buscarInput]);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, categoria, estadoRevision, soloMios, buscar]);

  async function confirmarEliminar() {
    if (!itemAEliminar) return;
    setEliminando(true);
    try {
      await catalogApi.remove(itemAEliminar._id);
      setItemAEliminar(null);
      await cargar();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo eliminar el registro'));
    } finally {
      setEliminando(false);
    }
  }

  async function handleExportar() {
    setExportando(true);
    setError('');
    try {
      const params = {};
      if (categoria) params.categoria = categoria;
      if (estadoRevision) params.estadoRevision = estadoRevision;
      const res = await catalogApi.exportPdf(params);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'catalogo-biblioteca.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo generar el PDF'));
    } finally {
      setExportando(false);
    }
  }

  function puedeEditar(item) {
    const esAutor = item.registradoPor?._id === user?.id;
    const estadoEditable = [ESTADOS_REVISION.PENDIENTE, ESTADOS_REVISION.RECHAZADO].includes(item.estadoRevision);
    return esAutor && estadoEditable;
  }

  const columns = [
    { key: 'noInventario', header: 'No. Inventario' },
    { key: 'categoria', header: 'Categoria', render: (row) => etiquetaDe(row.categoria) },
    { key: 'titulo', header: 'Titulo' },
    { key: 'autor', header: 'Autor' },
    {
      key: 'estadoFisico',
      header: 'Estado fisico',
      render: (row) =>
        tieneDanoFisico(row.estadoFisico) ? (
          <Badge tone="danger" icon={AlertTriangle}>
            {row.estadoFisico}
          </Badge>
        ) : (
          <span className="text-slate-500">{row.estadoFisico || '-'}</span>
        ),
    },
    { key: 'estadoRevision', header: 'Estado', render: (row) => <EstadoRevisionBadge estado={row.estadoRevision} /> },
    { key: 'registradoPor', header: 'Registrado por', render: (row) => row.registradoPor?.nombre || '-' },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {puedeEditar(row) ? (
            <Link to={`/catalogo/${row._id}/editar`} className="text-primary hover:text-primary-light" title="Editar">
              <Pencil size={16} />
            </Link>
          ) : null}
          {user?.rol === ROLES.MANAGER ? (
            <button onClick={() => setItemAEliminar(row)} className="text-secondary hover:text-red-700" title="Eliminar">
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  function renderExpanded(row) {
    return <CatalogDetailFields item={row} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary-dark">Catalogo</h1>
        <div className="flex gap-2">
          {user?.rol === ROLES.ADMIN || user?.rol === ROLES.MANAGER ? (
            <Button variant="secondary" icon={FileDown} onClick={handleExportar} disabled={exportando}>
              {exportando ? 'Generando...' : 'Exportar PDF'}
            </Button>
          ) : null}
          <Link to="/catalogo/nuevo">
            <Button icon={Plus}>Registrar material</Button>
          </Link>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={buscarInput}
          onChange={(e) => setBuscarInput(e.target.value)}
          placeholder="Buscar por titulo, autor o no. de inventario..."
          className="w-full rounded-md border border-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex gap-3">
        <Select
          value={categoria}
          onChange={(e) => {
            setPage(1);
            setCategoria(e.target.value);
          }}
          className="max-w-xs"
        >
          <option value="">Todas las categorias</option>
          {categorias.map((cat) => (
            <option key={cat.clave} value={cat.clave}>
              {cat.nombre}
            </option>
          ))}
        </Select>
        <Select
          value={estadoRevision}
          onChange={(e) => {
            setPage(1);
            setEstadoRevision(e.target.value);
          }}
          className="max-w-xs"
        >
          <option value="">Todos los estados</option>
          {Object.values(ESTADOS_REVISION).map((estado) => (
            <option key={estado} value={estado}>
              {ESTADO_REVISION_LABELS[estado]}
            </option>
          ))}
        </Select>
        {user?.rol === ROLES.USER ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={soloMios}
              onChange={(e) => {
                setPage(1);
                setSoloMios(e.target.checked);
              }}
              className="rounded border-border text-primary focus:ring-primary/30"
            />
            Solo mis registros
          </label>
        ) : null}
      </div>

      <AlertBanner>{error}</AlertBanner>

      <DataTable
        columns={columns}
        rows={registros}
        rowKey="_id"
        loading={loading}
        emptyMessage="No hay materiales registrados"
        renderExpanded={renderExpanded}
      />
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <Modal
        open={!!itemAEliminar}
        title="Eliminar registro"
        onClose={() => setItemAEliminar(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemAEliminar(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarEliminar} disabled={eliminando}>
              {eliminando ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          ¿Confirmas eliminar el registro <strong>{itemAEliminar?.titulo}</strong> (No. Inventario{' '}
          {itemAEliminar?.noInventario})? Esta accion quedara registrada en la auditoria.
        </p>
      </Modal>
    </div>
  );
}
