const FIELD_CLASS =
  'w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-400';

function FieldWrapper({ label, required, error, children }) {
  return (
    <label className="flex flex-col gap-1">
      {label ? (
        <span className="text-sm font-medium text-slate-700">
          {label} {required ? <span className="text-secondary">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="text-xs text-secondary">{error}</span> : null}
    </label>
  );
}

export function Input({ label, required, error, className = '', ...props }) {
  return (
    <FieldWrapper label={label} required={required} error={error}>
      <input className={`${FIELD_CLASS} ${className}`} {...props} />
    </FieldWrapper>
  );
}

export function Textarea({ label, required, error, className = '', rows = 3, ...props }) {
  return (
    <FieldWrapper label={label} required={required} error={error}>
      <textarea rows={rows} className={`${FIELD_CLASS} resize-none ${className}`} {...props} />
    </FieldWrapper>
  );
}

export function Select({ label, required, error, className = '', children, ...props }) {
  return (
    <FieldWrapper label={label} required={required} error={error}>
      <select className={`${FIELD_CLASS} ${className}`} {...props}>
        {children}
      </select>
    </FieldWrapper>
  );
}
