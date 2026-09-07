import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import Badge from './Badge';
import { ESTADO_REVISION_LABELS } from '../constants';

const CONFIG = {
  PENDIENTE_ADMIN: { tone: 'neutral', icon: Clock },
  PENDIENTE_MANAGER: { tone: 'warning', icon: Clock },
  APROBADO: { tone: 'success', icon: CheckCircle2 },
  RECHAZADO: { tone: 'danger', icon: XCircle },
};

export default function EstadoRevisionBadge({ estado }) {
  const config = CONFIG[estado] || CONFIG.PENDIENTE_ADMIN;
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {ESTADO_REVISION_LABELS[estado] || estado}
    </Badge>
  );
}
