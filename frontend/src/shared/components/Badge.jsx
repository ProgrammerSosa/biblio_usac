const TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-amber-100 text-amber-800',
  success: 'bg-emerald-100 text-emerald-800',
  danger: 'bg-red-100 text-secondary',
};

export default function Badge({ tone = 'neutral', children, icon: Icon }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>
      {Icon ? <Icon size={12} /> : null}
      {children}
    </span>
  );
}
