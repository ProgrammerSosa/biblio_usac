import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, CheckSquare, ShieldCheck, Users, LogOut, Landmark, Tags, Activity } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ROL_LABELS } from '../constants';
import { CategoriesProvider } from '../CategoriesContext';

const NAV_ITEMS = [
  { to: '/catalogo', label: 'Catalogo', icon: BookOpen, roles: ['MANAGER', 'ADMIN', 'USER'] },
  { to: '/aprobaciones', label: 'Aprobaciones', icon: CheckSquare, roles: ['MANAGER', 'ADMIN'] },
  { to: '/equipo', label: 'Equipo', icon: Activity, roles: ['MANAGER', 'ADMIN'] },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, roles: ['MANAGER', 'ADMIN', 'USER'] },
  { to: '/categorias', label: 'Categorias', icon: Tags, roles: ['MANAGER'] },
  { to: '/personal', label: 'Personal', icon: Users, roles: ['MANAGER'] },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <CategoriesProvider>
      <div className="flex min-h-screen">
        <aside className="flex w-64 shrink-0 flex-col bg-primary-dark text-white">
          <div className="flex items-center gap-2 px-5 py-5 text-sm font-semibold">
            <Landmark size={22} />
            <span>Biblioteca USAC</span>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV_ITEMS.filter((item) => item.roles.includes(user?.rol)).map((item) => (
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
            ))}
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
          <Outlet />
        </main>
      </div>
    </CategoriesProvider>
  );
}
