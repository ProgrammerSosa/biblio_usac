import { ArrowUpDown } from 'lucide-react';
import { OPCIONES_ORDEN_CATALOGO } from '../constants';

// Selector de orden para las listas de materiales (Aprobaciones): una sola pieza con su icono y el
// texto completo de la opcion visible, sin salirse de la pantalla en ventanas angostas.
export default function SelectorOrden({ value, onChange }) {
  return (
    <label className="flex max-w-full items-center gap-2 text-sm text-slate-500">
      <ArrowUpDown size={15} className="shrink-0 text-primary" />
      <span className="shrink-0">Ordenar</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-64 max-w-full min-w-0 rounded-lg border border-border bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        {OPCIONES_ORDEN_CATALOGO.map((opcion) => (
          <option key={opcion.value} value={opcion.value}>
            {opcion.label}
          </option>
        ))}
      </select>
    </label>
  );
}
