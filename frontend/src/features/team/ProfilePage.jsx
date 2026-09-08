import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Trophy, CalendarDays, BookCopy, Loader2 } from 'lucide-react';
import { teamApi } from './teamApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { ROL_LABELS, ESTADO_REVISION_LABELS } from '../../shared/constants';
import Badge from '../../shared/components/Badge';
import AlertBanner from '../../shared/components/AlertBanner';

function StatTile({ icon: Icon, label, value, detalle }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-white p-5">
      <div className="mb-2 flex items-center gap-2 text-primary">
        <Icon size={18} />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-primary-dark">{value}</p>
      {detalle ? <p className="mt-1 text-xs text-slate-400">{detalle}</p> : null}
    </div>
  );
}

function formatearFecha(fechaIso) {
  if (!fechaIso) return null;
  const [anio, mes, dia] = fechaIso.split('-');
  return new Date(Number(anio), Number(mes) - 1, Number(dia)).toLocaleDateString('es-GT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function ProfilePage() {
  const { id } = useParams();
  const [perfil, setPerfil] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    teamApi
      .getPerfil(id)
      .then((res) => setPerfil(res.data.data))
      .catch((err) => setError(getErrorMessage(err, 'No se pudo cargar el perfil')))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/equipo" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
        <ArrowLeft size={16} />
        Volver al equipo
      </Link>

      <AlertBanner>{error}</AlertBanner>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={18} />
          Cargando perfil...
        </div>
      ) : perfil ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-border bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-primary-dark">{perfil.usuario.nombre}</h1>
                <p className="text-sm text-slate-500">{perfil.usuario.email}</p>
              </div>
              <Badge tone="primary">{ROL_LABELS[perfil.usuario.rol]}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile icon={BookCopy} label="Total registrado" value={perfil.total} detalle="materiales en el catalogo" />
            <StatTile icon={CalendarDays} label="Hoy" value={perfil.hoy} detalle="registrados en el dia de hoy" />
            <StatTile
              icon={Trophy}
              label="Mejor dia"
              value={perfil.mejorDia ? perfil.mejorDia.cantidad : '-'}
              detalle={perfil.mejorDia ? formatearFecha(perfil.mejorDia.fecha) : 'Aun sin registros'}
            />
          </div>

          <div className="rounded-lg border border-border bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Estado de sus registros</h2>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">
                {ESTADO_REVISION_LABELS.PENDIENTE_ADMIN}: {perfil.porEstado.PENDIENTE_ADMIN || 0}
              </Badge>
              <Badge tone="warning">
                {ESTADO_REVISION_LABELS.PENDIENTE_MANAGER}: {perfil.porEstado.PENDIENTE_MANAGER || 0}
              </Badge>
              <Badge tone="success">
                {ESTADO_REVISION_LABELS.APROBADO}: {perfil.porEstado.APROBADO || 0}
              </Badge>
              <Badge tone="danger">
                {ESTADO_REVISION_LABELS.RECHAZADO}: {perfil.porEstado.RECHAZADO || 0}
              </Badge>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
