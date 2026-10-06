import { Landmark } from 'lucide-react';

// Lomos de la repisa: altura y color de cada libro. Suben uno tras otro mientras carga.
const LOMOS = [
  { alto: 26, color: 'fill-primary' },
  { alto: 34, color: 'fill-secondary' },
  { alto: 22, color: 'fill-primary-light' },
  { alto: 30, color: 'fill-slate-500' },
  { alto: 36, color: 'fill-primary' },
  { alto: 24, color: 'fill-amber-500' },
  { alto: 32, color: 'fill-secondary' },
  { alto: 28, color: 'fill-primary-light' },
];

// Lineas de texto de las paginas del libro (solo decoracion).
const LINEAS = [50, 58, 66, 74, 82];

/**
 * Indicador de carga con tematica de biblioteca, a modo de pantalla de kiosco: un libro abierto que
 * pasa sus hojas y, debajo, una repisa cuyos lomos suben uno tras otro. Las animaciones estan en
 * index.css (kiosco-*) y se apagan si la persona pidio menos movimiento en su sistema.
 */
export default function CargandoBiblioteca({
  mensaje = 'Cargando',
  detalle = 'Un momento, estamos ordenando los libros...',
  className = '',
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mx-auto flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-border bg-white px-8 py-9 text-center shadow-lg shadow-slate-900/5 ${className}`}
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        <Landmark size={14} className="text-primary" />
        Biblioteca USAC
        <span className="h-3 w-px bg-border" aria-hidden="true" />
        Consulta
      </p>

      <svg viewBox="0 0 200 160" className="h-auto w-60" aria-hidden="true">
        {/* Sombra del libro sobre la mesa */}
        <ellipse cx="100" cy="106" rx="84" ry="6" className="fill-slate-200" />

        {/* Tapas del libro abierto */}
        <rect x="14" y="30" width="86" height="72" rx="5" className="fill-primary-dark" />
        <rect x="100" y="30" width="86" height="72" rx="5" className="fill-primary-dark" />

        {/* Hojas fijas, izquierda y derecha */}
        <rect x="20" y="36" width="78" height="62" rx="2" className="fill-white stroke-slate-300" strokeWidth="1" />
        <rect x="102" y="36" width="78" height="62" rx="2" className="fill-white stroke-slate-300" strokeWidth="1" />
        {LINEAS.map((y) => (
          <g key={y}>
            <rect x="28" y={y - 8} width={y % 16 === 0 ? 56 : 62} height="3" rx="1.5" className="fill-slate-200" />
            <rect x="110" y={y - 8} width={y % 16 === 0 ? 62 : 54} height="3" rx="1.5" className="fill-slate-200" />
          </g>
        ))}

        {/* Hojas que se voltean (de derecha a izquierda, una tras otra) */}
        {[0, 0.8, 1.6].map((retraso) => (
          <g key={retraso} className="kiosco-pagina" style={{ animationDelay: `${retraso}s` }}>
            <rect x="102" y="36" width="78" height="62" rx="2" className="fill-white stroke-slate-300" strokeWidth="1" />
            <rect x="110" y="44" width="58" height="3" rx="1.5" className="fill-slate-300" />
            <rect x="110" y="52" width="46" height="3" rx="1.5" className="fill-slate-200" />
            <rect x="110" y="60" width="54" height="3" rx="1.5" className="fill-slate-200" />
          </g>
        ))}

        {/* Lomo central y marcapaginas */}
        <rect x="97.5" y="32" width="5" height="68" rx="2" className="fill-primary" />
        <path d="M108 30 h6 v26 l-3 -3 l-3 3 Z" className="fill-secondary" />

        {/* Repisa con lomos de libros que suben uno tras otro */}
        <rect x="26" y="150" width="148" height="5" rx="2" className="fill-slate-300" />
        {LOMOS.map((lomo, i) => (
          <rect
            key={i}
            x={34 + i * 17}
            y={150 - lomo.alto}
            width="12"
            height={lomo.alto}
            rx="2"
            className={`kiosco-lomo ${lomo.color}`}
            style={{ animationDelay: `${i * 0.14}s` }}
          />
        ))}
      </svg>

      <div>
        <p className="text-lg font-semibold text-primary-dark">{mensaje}</p>
        <p className="mt-1 text-sm text-slate-500">{detalle}</p>
      </div>

      <div className="h-1.5 w-44 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="kiosco-barra h-full w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  );
}
