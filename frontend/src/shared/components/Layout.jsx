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

export default function Layout() {
  const { user, logout } = useAuth();
  const recordatorioRespaldo = useRecordatorioRespaldo(user?.rol);

  return (
    <CategoriesProvider>
      <div className="flex min-h-screen">
        <aside className="flex w-64 shrink-0 flex-col bg-primary-dark text-white">
          <div className="flex items-center gap-2 px-5 py-5 text-sm font-semibold">
            <Landmark size={22} />
            <span>Biblioteca USAC</span>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV_ITEMS.filter((item) => item.roles.includes(user?.rol)).map((item) =>
              item.external ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <item.icon size={18} />
                  <span className="flex-1">{item.label}</span>
                  <ExternalLink size={14} className="shrink-0 opacity-60" />
                </a>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <item.icon size={18} />
                  {item.label}
                </NavLink>
              )
            )}
          </nav>
          <div className="border-t border-white/10 px-3 py-4">
            <div className="mb-2 px-3">
              <p className="text-sm font-medium">{user?.nombre}</p>
              <p className="text-xs text-slate-400">{ROL_LABELS[user?.rol] || user?.rol}</p>
            </div>
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <LogOut size={18} />
              Cerrar sesion
            </button>
          </div>
        </aside>
        <main className="flex-1 bg-surface p-6">
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
