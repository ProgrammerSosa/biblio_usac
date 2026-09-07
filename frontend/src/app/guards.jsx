import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../shared/hooks/useAuth';

export function RequireAuth() {
  const { token } = useAuth();
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

export function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return roles.includes(user.rol) ? <Outlet /> : <Navigate to="/catalogo" replace />;
}

export function RootRedirect() {
  const { token } = useAuth();
  return <Navigate to={token ? '/catalogo' : '/login'} replace />;
}
