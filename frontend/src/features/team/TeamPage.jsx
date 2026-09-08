import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, UserRound } from 'lucide-react';
import { teamApi } from './teamApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { ROL_LABELS, ESTADO_REVISION_LABELS } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import Badge from '../../shared/components/Badge';
import AlertBanner from '../../shared/components/AlertBanner';

export default function TeamPage() {
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    teamApi
      .listEstadisticas()
      .then((res) => setFilas(res.data.data.map((fila) => ({ ...fila, id: fila.usuario.id }))))
      .catch((err) => setError(getErrorMessage(err, 'No se pudo cargar el panel de actividad')))
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      key: 'nombre',
      header: 'Persona',
      render: (fila) => (
        <div>
          <p className="font-medium text-slate-800">{fila.usuario.nombre}</p>
          <p className="text-xs text-slate-400">{fila.usuario.email}</p>
        </div>
      ),
    },
    { key: 'rol', header: 'Rol', render: (fila) => <Badge tone="primary">{ROL_LABELS[fila.usuario.rol]}</Badge> },
    { key: 'total', header: 'Total registrado', render: (fila) => <span className="font-semibold text-slate-800">{fila.total}</span> },
    { key: 'hoy', header: 'Hoy', render: (fila) => fila.hoy },
    {
      key: 'pendiente',
      header: 'Pendientes',
      render: (fila) => (fila.porEstado.PENDIENTE_ADMIN || 0) + (fila.porEstado.PENDIENTE_MANAGER || 0),
    },
    {
      key: 'aprobado',
      header: ESTADO_REVISION_LABELS.APROBADO,
      render: (fila) => <span className="text-emerald-700">{fila.porEstado.APROBADO || 0}</span>,
    },
    {
      key: 'rechazado',
      header: ESTADO_REVISION_LABELS.RECHAZADO,
      render: (fila) => <span className="text-secondary">{fila.porEstado.RECHAZADO || 0}</span>,
    },
    {
      key: 'acciones',
      header: '',
      render: (fila) => (
        <Link
          to={`/equipo/${fila.usuario.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <UserRound size={13} />
          Ver perfil
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Activity size={17} />
        </div>
        <h1 className="text-xl font-semibold text-primary-dark">Actividad del equipo</h1>
      </div>
      <p className="max-w-2xl text-sm text-slate-500">
        Cuanto ha registrado cada persona a tu cargo, ordenado de mayor a menor actividad. Haz clic en "Ver perfil"
        para ver su detalle, su mejor dia y cuanto lleva hoy.
      </p>

      <AlertBanner>{error}</AlertBanner>

      <DataTable columns={columns} rows={filas} rowKey="id" loading={loading} emptyMessage="Aun no hay actividad registrada" />
    </div>
  );
}
