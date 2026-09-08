import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, ClipboardCheck, ListChecks } from 'lucide-react';
import { catalogApi } from '../catalog/catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ESTADOS_REVISION, ROLES, tieneDanoFisico } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import Badge from '../../shared/components/Badge';
import Tabs from '../../shared/components/Tabs';
import Button from '../../shared/components/Button';
import Pagination from '../../shared/components/Pagination';
import Modal from '../../shared/components/Modal';
import AlertBanner from '../../shared/components/AlertBanner';
import { Textarea } from '../../shared/components/FormField';
import CatalogDetailFields from '../catalog/CatalogDetailFields';

const TABS = [
  { value: ESTADOS_REVISION.PENDIENTE, label: 'Pendientes' },
  { value: ESTADOS_REVISION.APROBADO, label: 'Aprobados' },
];

export default function ApprovalsPage() {
  const { user } = useAuth();
  const { etiquetaDe } = useCategories();
  const [activeTab, setActiveTab] = useState(ESTADOS_REVISION.PENDIENTE);
  const [registros, setRegistros] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [itemEnRevision, setItemEnRevision] = useState(null);
  const [decision, setDecision] = useState('APROBAR');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorModal, setErrorModal] = useState('');
  const [loteAbierto, setLoteAbierto] = useState(false);
  const [aprobandoLote, setAprobandoLote] = useState(false);
  const [errorLote, setErrorLote] = useState('');

  const esAdmin = user?.rol === ROLES.ADMIN;
  const puedeActuar = esAdmin && activeTab === ESTADOS_REVISION.PENDIENTE;

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const res = await catalogApi.list({ estadoRevision: activeTab, page, limit: 10 });
      setRegistros(res.data.data.registros);
      setTotalPages(res.data.data.totalPages);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar el listado'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    setSeleccionados(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, page]);

  function toggleUno(id) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodos() {
    setSeleccionados((prev) => {
      const todosSeleccionados = registros.length > 0 && registros.every((r) => prev.has(r._id));
      return todosSeleccionados ? new Set() : new Set(registros.map((r) => r._id));
    });
  }

  function abrirRevision(item) {
    setItemEnRevision(item);
    setDecision('APROBAR');
    setObservaciones('');
    setErrorModal('');
  }

  async function confirmarDecision() {
    if (decision === 'RECHAZAR' && !observaciones.trim()) {
      setErrorModal('Las observaciones son obligatorias al rechazar');
      return;
    }

    setEnviando(true);
    setErrorModal('');
    try {
      const payload = { decision, observaciones: observaciones.trim() || undefined };
      await catalogApi.revisar(itemEnRevision._id, payload);
      setItemEnRevision(null);
      setMensaje(decision === 'APROBAR' ? 'Registro aprobado correctamente' : 'Registro rechazado correctamente');
      await cargar();
    } catch (err) {
      setErrorModal(getErrorMessage(err, 'No se pudo procesar la decision'));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarLote() {
    setAprobandoLote(true);
    setErrorLote('');
    try {
      const res = await catalogApi.aprobarLote([...seleccionados]);
      setMensaje(`${res.data.data.aprobados} registro(s) aprobado(s) correctamente`);
      setSeleccionados(new Set());
      setLoteAbierto(false);
      await cargar();
    } catch (err) {
      setErrorLote(getErrorMessage(err, 'No se pudo aprobar el lote'));
    } finally {
      setAprobandoLote(false);
    }
  }

  const columns = [
    ...(puedeActuar
      ? [
          {
            key: 'seleccion',
            header: (
              <input
                type="checkbox"
                checked={registros.length > 0 && registros.every((r) => seleccionados.has(r._id))}
                onChange={toggleTodos}
                className="rounded border-border text-primary focus:ring-primary/30"
              />
            ),
            render: (row) => (
              <div onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={seleccionados.has(row._id)}
                  onChange={() => toggleUno(row._id)}
                  className="rounded border-border text-primary focus:ring-primary/30"
                />
              </div>
            ),
          },
        ]
      : []),
    { key: 'noInventario', header: 'No. Inventario' },
    { key: 'categoria', header: 'Categoria', render: (row) => etiquetaDe(row.categoria) },
    { key: 'titulo', header: 'Titulo' },
    { key: 'autor', header: 'Autor' },
    {
      key: 'estadoFisico',
      header: 'Estado fisico',
      render: (row) =>
        tieneDanoFisico(row.estadoFisico) ? <Badge tone="danger">{row.estadoFisico}</Badge> : row.estadoFisico || '-',
    },
    { key: 'registradoPor', header: 'Registrado por', render: (row) => row.registradoPor?.nombre || '-' },
    ...(puedeActuar
      ? [
          {
            key: 'acciones',
            header: 'Acciones',
            render: (row) => (
              <Button
                variant="secondary"
                icon={ClipboardCheck}
                onClick={(e) => {
                  e.stopPropagation();
                  abrirRevision(row);
                }}
              >
                Revisar
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-primary-dark">Aprobaciones</h1>
      {!esAdmin ? (
        <p className="text-sm text-slate-500">
          Solo el Admin aprueba materiales. Aqui puedes ver el estado de la cola de revision; si algo esta mal puedes
          corregirlo directamente desde el Catalogo.
        </p>
      ) : null}

      <Tabs
        tabs={TABS}
        active={activeTab}
        onChange={(value) => {
          setActiveTab(value);
          setPage(1);
        }}
      />

      <AlertBanner>{error}</AlertBanner>
      <AlertBanner type="success">{mensaje}</AlertBanner>

      {puedeActuar && seleccionados.size > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-primary-dark">
            {seleccionados.size} registro{seleccionados.size === 1 ? '' : 's'} seleccionado
            {seleccionados.size === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSeleccionados(new Set())}>
              Cancelar seleccion
            </Button>
            <Button icon={ListChecks} onClick={() => setLoteAbierto(true)}>
              Aprobar seleccionados
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={registros}
        rowKey="_id"
        loading={loading}
        emptyMessage="No hay registros en este filtro"
        renderExpanded={(row) => <CatalogDetailFields item={row} />}
      />
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <Modal
        open={!!itemEnRevision}
        title={`Revisar: ${itemEnRevision?.titulo || ''}`}
        onClose={() => setItemEnRevision(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemEnRevision(null)}>
              Cancelar
            </Button>
            <Button
              variant={decision === 'RECHAZAR' ? 'danger' : 'primary'}
              onClick={confirmarDecision}
              disabled={enviando}
            >
              {enviando ? 'Enviando...' : decision === 'RECHAZAR' ? 'Rechazar registro' : 'Aprobar registro'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDecision('APROBAR')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                decision === 'APROBAR' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-slate-500'
              }`}
            >
              <CheckCircle2 size={16} />
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => setDecision('RECHAZAR')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                decision === 'RECHAZAR' ? 'border-secondary bg-secondary-light text-secondary' : 'border-border text-slate-500'
              }`}
            >
              <XCircle size={16} />
              Rechazar
            </button>
          </div>

          {decision === 'RECHAZAR' ? (
            <Textarea
              label="Observaciones"
              required
              placeholder="Explica que se debe corregir"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          ) : null}

          <AlertBanner>{errorModal}</AlertBanner>
        </div>
      </Modal>

      <Modal
        open={loteAbierto}
        title="Aprobar registros seleccionados"
        onClose={() => setLoteAbierto(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLoteAbierto(false)}>
              Cancelar
            </Button>
            <Button icon={CheckCircle2} onClick={confirmarLote} disabled={aprobandoLote}>
              {aprobandoLote ? 'Aprobando...' : `Aprobar ${seleccionados.size} registro(s)`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            Vas a aprobar <strong>{seleccionados.size}</strong> registro{seleccionados.size === 1 ? '' : 's'} de una
            vez. Quedaran marcados como Aprobados y saldran de la cola de pendientes.
          </p>
          <AlertBanner>{errorLote}</AlertBanner>
        </div>
      </Modal>
    </div>
  );
}
