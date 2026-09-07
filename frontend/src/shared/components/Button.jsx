const VARIANTS = {
  primary: 'bg-primary text-white hover:bg-primary-light disabled:bg-slate-300',
  secondary: 'bg-white text-primary border border-primary hover:bg-primary/5 disabled:text-slate-400 disabled:border-slate-300',
  danger: 'bg-secondary text-white hover:bg-red-700 disabled:bg-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
};

export default function Button({ variant = 'primary', className = '', children, icon: Icon, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}
