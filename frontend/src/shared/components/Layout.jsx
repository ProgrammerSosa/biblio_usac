import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BookOpen,
  CheckSquare,
  ShieldCheck,
  Users,
  LogOut,
  Landmark,
  Tags,
  Activity,
  BookMarked,
  ExternalLink,
  HardDrive,
  CalendarClock,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ROL_LABELS } from '../constants';
import { CategoriesProvider } from '../CategoriesContext';

const MANUAL_SISTEMA_URL = 'https://claude.ai/artifact/5wi8JDk8GmNKjJdzVxumKP';

const NAV_ITEMS = [
  { to: '/catalogo', label: 'Catalogo', icon: BookOpen, roles: ['MANAGER', 'ADMIN', 'USER'] },
  { to: '/aprobaciones', label: 'Aprobaciones', icon: CheckSquare, roles: ['MANAGER', 'ADMIN'] },
  { to: '/equipo', label: 'Equipo', icon: Activity, roles: ['MANAGER', 'ADMIN'] },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, roles: ['MANAGER', 'ADMIN', 'USER'] },
  { to: '/categorias', label: 'Categorias', icon: Tags, roles: ['MANAGER'] },
  { to: '/personal', label: 'Personal', icon: Users, roles: ['MANAGER'] },
  { to: '/respaldo', label: 'Respaldo', icon: HardDrive, roles: ['MANAGER'] },
  {
    href: MANUAL_SISTEMA_URL,
    label: 'Manual del sistema Generado por IA',
    icon: BookMarked,
    roles: ['MANAGER', 'ADMIN', 'USER'],
    external: true,
  },
];

// Recordatorio de "hazte un respaldo" los viernes - nada mas, nada de proceso automatico ni
// en el servidor: solo un aviso que se calcula en el navegador (dia de la semana) y se puede
// descartar por hoy. Vuelve a salir el viernes siguiente aunque se haya descartado este.
function useRecordatorioRespaldo(rol) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (rol !== 'MANAGER') return;
    const esViernes = new Date().getDay() === 5;
    if (!esViernes) return;

    const clave = `respaldo-recordatorio-${new Date().toISOString().slice(0, 10)}`;
    try {
      if (localStorage.getItem(clave)) return;
    } catch {
      // Si localStorage falla (modo privado, etc.) no hay forma de recordar que ya se
      // descarto hoy - se muestra igual, no es motivo para ocultar el aviso.
    }
    setVisible(true);
  }, [rol]);

  function descartar() {
    setVisible(false);
    try {
      const clave = `respaldo-recordatorio-${new Date().toISOString().slice(0, 10)}`;
      localStorage.setItem(clave, '1');
    } catch {
      // No pasa nada si no se pudo guardar - el aviso solo volveria a salir hoy si recarga.
    }
  }

  return { visible, descartar };
}

// Menu lateral desplegable: abierto (con los nombres) o recogido (solo los iconos). Se recuerda la
// ultima eleccion en este navegador; si nunca se eligio, arranca recogido en pantallas angostas.
const CLAVE_MENU_RECOGIDO = 'menu-lateral-recogido';

function useMenuRecogido() {
  const [recogido, setRecogido] = useState(() => {
    try {
      const guardado = localStorage.getItem(CLAVE_MENU_RECOGIDO);
      if (guardado !== null) return guardado === '1';
    } catch {
      // Sin localStorage (modo privado, etc.) simplemente no se recuerda la eleccion.
    }
    return window.innerWidth < 768;
  });

  function alternar() {
    setRecogido((actual) => {
      const siguiente = !actual;
      try {
        localStorage.setItem(CLAVE_MENU_RECOGIDO, siguiente ? '1' : '0');
      } catch {
        // No pasa nada si no se pudo guardar.
      }
      return siguiente;
    });
  }

  return { recogido, alternar };
}

export default function Layout() {
  const { user, logout } = useAuth();
  const recordatorioRespaldo = useRecordatorioRespaldo(user?.rol);
  const { recogido, alternar } = useMenuRecogido();

  // Recogido, cada opcion es solo su icono (el nombre queda como tooltip y para lectores de pantalla).
  const claseItem = `flex items-center rounded-md py-2.5 text-sm font-medium transition-colors ${
    recogido ? 'justify-center px-0' : 'gap-3 px-3'
  }`;

  return (
    <CategoriesProvider>
      <div className="flex min-h-screen">
        <aside
          className={`flex shrink-0 flex-col bg-primary-dark text-white transition-[width] duration-200 ${recogido ? 'w-[4.5rem]' : 'w-64'}`}
        >
          <div className={`flex items-center py-4 ${recogido ? 'flex-col gap-3 px-2' : 'justify-between gap-2 px-4'}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Landmark size={22} className="shrink-0" />
              {recogido ? null : <span>Biblioteca USAC</span>}
            </div>
            <button
              type="button"
              onClick={alternar}
              aria-label={recogido ? 'Desplegar el menu' : 'Recoger el menu'}
              aria-expanded={!recogido}
              title={recogido ? 'Desplegar el menu' : 'Recoger el menu'}
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              {recogido ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV_ITEMS.filter((item) => item.roles.includes(user?.rol)).map((item) =>
              item.external ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={recogido ? item.label : undefined}
                  className={`${claseItem} text-slate-300 hover:bg-white/5 hover:text-white`}
                >
                  <item.icon size={18} className="shrink-0" />
                  <span className={recogido ? 'sr-only' : 'flex-1'}>{item.label}</span>
                  {recogido ? null : <ExternalLink size={14} className="shrink-0 opacity-60" />}
                </a>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={recogido ? item.label : undefined}
                  className={({ isActive }) =>
                    `${claseItem} ${isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`
                  }
                >
                  <item.icon size={18} className="shrink-0" />
                  <span className={recogido ? 'sr-only' : undefined}>{item.label}</span>
                </NavLink>
              )
            )}
          </nav>
          <div className="border-t border-white/10 px-3 py-4">
            {recogido ? null : (
              <div className="mb-2 px-3">
                <p className="text-sm font-medium">{user?.nombre}</p>
                <p className="text-xs text-slate-400">{ROL_LABELS[user?.rol] || user?.rol}</p>
              </div>
            )}
            <button
              onClick={logout}
              title={recogido ? `Cerrar sesion (${user?.nombre})` : undefined}
              className={`${claseItem} w-full text-slate-300 hover:bg-white/5 hover:text-white`}
            >
              <LogOut size={18} className="shrink-0" />
              <span className={recogido ? 'sr-only' : undefined}>Cerrar sesion</span>
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 bg-surface p-6">
          {recordatorioRespaldo.visible ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <span className="flex items-center gap-2">
                <CalendarClock size={16} className="shrink-0" />
                Hoy es viernes - ¿ya hiciste tu respaldo de esta semana?
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <NavLink to="/respaldo" className="font-medium underline hover:no-underline">
                  Ir a Respaldo
                </NavLink>
                <button onClick={recordatorioRespaldo.descartar} className="text-amber-500 hover:text-amber-700" aria-label="Descartar aviso">
                  <X size={16} />
                </button>
              </div>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </CategoriesProvider>
  );
}
