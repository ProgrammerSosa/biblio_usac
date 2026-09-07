import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function AlertBanner({ type = 'error', children }) {
  if (!children) return null;

  const isError = type === 'error';
  const Icon = isError ? AlertTriangle : CheckCircle2;
  const classes = isError ? 'bg-red-50 text-secondary border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200';

  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${classes}`}>
      <Icon size={16} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}
