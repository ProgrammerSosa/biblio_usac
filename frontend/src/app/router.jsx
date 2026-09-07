import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth, RequireRole, RootRedirect } from './guards';
import Layout from '../shared/components/Layout';
import LoginPage from '../features/auth/LoginPage';
import RegisterPage from '../features/auth/RegisterPage';
import CatalogListPage from '../features/catalog/CatalogListPage';
import CatalogFormPage from '../features/catalog/CatalogFormPage';
import ApprovalsPage from '../features/approvals/ApprovalsPage';
import AuditPage from '../features/audit/AuditPage';
import PersonnelPage from '../features/users/PersonnelPage';
import CategoriesPage from '../features/categories/CategoriesPage';

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/registro', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/catalogo', element: <CatalogListPage /> },
          { path: '/catalogo/nuevo', element: <CatalogFormPage /> },
          { path: '/catalogo/:id/editar', element: <CatalogFormPage /> },
          {
            element: <RequireRole roles={['ADMIN', 'MANAGER']} />,
            children: [
              { path: '/aprobaciones', element: <ApprovalsPage /> },
              { path: '/auditoria', element: <AuditPage /> },
            ],
          },
          {
            element: <RequireRole roles={['MANAGER']} />,
            children: [
              { path: '/personal', element: <PersonnelPage /> },
              { path: '/categorias', element: <CategoriesPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
