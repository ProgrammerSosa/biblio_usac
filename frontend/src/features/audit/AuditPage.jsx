import { useEffect, useState } from 'react';
import { auditApi } from './auditApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { ACCIONES_AUDITORIA, ACCION_LABELS, ACCION_TONOS, ROL_LABELS } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import Badge from '../../shared/components/Badge';
import Pagination from '../../shared/components/Pagination';
import AlertBanner from '../../shared/components/AlertBanner';
import { Select } from '../../shared/components/FormField';

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' });
}

function resumenDetalles(detalles) {
  if (!detalles || Object.keys(detalles).length === 0) return '-';
  return Object.entries(detalles)
    .map(([clave, valor]) => `${clave}: ${valor}`)
    .join(' · ');
}

export default function AuditPage() {
  const [registros, setRegistros] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [accion, setAccion] = useState('');
  const [usuario, setUsuario] = useState('');
  const [usuariosFiltrables, setUsuariosFiltrables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 15 };
      if (accion) params.accion = accion;
      if (usuario) params.usuario = usuario;
      const res = await auditApi.list(params);
      setRegistros(res.data.data.registros);
      setTotalPages(res.data.data.totalPages);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar la auditoria'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    auditApi
      .listUsuarios()
      .then((res) => setUsuariosFiltrables(res.data.data))
      .catch(() => setUsuariosFiltrables([]));
  }, []);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, accion, usuario]);

  const columns = [
    { key: 'fecha', header: 'Fecha', render: (row) => formatearFecha(row.fecha) },
    { key: 'usuario', header: 'Usuario', render: (row) => row.usuario?.nombre || 'Sistema' },
    {
      key: 'accion',
      header: 'Accion',
      render: (row) => <Badge tone={ACCION_TONOS[row.accion] || 'neutral'}>{ACCION_LABELS[row.accion] || row.accion}</Badge>,
    },
    { key: 'entidad', header: 'Entidad' },
    { key: 'detalles', header: 'Detalles', render: (row) => <span className="text-xs text-slate-500">{resumenDetalles(row.detalles)}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-primary-dark">Auditoria</h1>

      <div className="flex gap-3">
        <Select
          value={usuario}
          onChange={(e) => {
            setPage(1);
            setUsuario(e.target.value);
          }}
          className="max-w-xs"
        >
          <option value="">Todo el personal a mi alcance</option>
          {usuariosFiltrables.map((u) => (
            <option key={u._id} value={u._id}>
              {u.nombre} ({ROL_LABELS[u.rol]})
            </option>
          ))}
        </Select>
        <Select
          value={accion}
          onChange={(e) => {
            setPage(1);
            setAccion(e.target.value);
          }}
          className="max-w-xs"
        >
          <option value="">Todas las acciones</option>
          {ACCIONES_AUDITORIA.map((a) => (
            <option key={a} value={a}>
              {ACCION_LABELS[a]}
            </option>
          ))}
        </Select>
      </div>

      <AlertBanner>{error}</AlertBanner>

      <DataTable columns={columns} rows={registros} rowKey="_id" loading={loading} emptyMessage="No hay actividad registrada" />
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
