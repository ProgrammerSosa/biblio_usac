import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
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
  { value: ESTADOS_REVISION.PENDIENTE_ADMIN, label: 'Pendiente Admin', filtro: ROLES.ADMIN },
  { value: ESTADOS_REVISION.PENDIENTE_MANAGER, label: 'Pendiente Manager', filtro: ROLES.MANAGER },
  { value: ESTADOS_REVISION.APROBADO, label: 'Aprobado', filtro: null },
];

export default function ApprovalsPage() {
  const { user } = useAuth();
  const { etiquetaDe } = useCategories();
  const [activeTab, setActiveTab] = useState(
    user?.rol === ROLES.ADMIN ? ESTADOS_REVISION.PENDIENTE_ADMIN : ESTADOS_REVISION.PENDIENTE_MANAGER
  );
  const [registros, setRegistros] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [itemEnRevision, setItemEnRevision] = useState(null);
  const [decision, setDecision] = useState('APROBAR');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  const tabActual = TABS.find((t) => t.value === activeTab);
  const puedeActuar = tabActual?.filtro === user?.rol;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, page]);

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
      if (user.rol === ROLES.ADMIN) {
        await catalogApi.revisar(itemEnRevision._id, payload);
      } else {
        await catalogApi.aprobar(itemEnRevision._id, payload);
      }
      setItemEnRevision(null);
      await cargar();
    } catch (err) {
      setErrorModal(getErrorMessage(err, 'No se pudo procesar la decision'));
    } finally {
      setEnviando(false);
    }
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

      <Tabs
        tabs={TABS}
        active={activeTab}
        onChange={(value) => {
          setActiveTab(value);
          setPage(1);
        }}
      />

      <AlertBanner>{error}</AlertBanner>

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
    </div>
  );
}
