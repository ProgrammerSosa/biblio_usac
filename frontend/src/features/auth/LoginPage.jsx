import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import axiosClient, { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import Button from '../../shared/components/Button';
import { Input } from '../../shared/components/FormField';
import AlertBanner from '../../shared/components/AlertBanner';

export default function LoginPage() {
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      navigate('/catalogo', { replace: true });
    }
  }, [token, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axiosClient.post('/auth/login', { identificador, password });
      const { token: jwt, user } = res.data.data;
      login(jwt, user);
      navigate('/catalogo', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo iniciar sesion'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-dark px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-lg font-semibold text-primary-dark">Iniciar sesion</h1>
        <p className="mb-6 text-sm text-slate-500">Sistema de gestion bibliotecaria</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Nombre o correo"
            type="text"
            required
            autoFocus
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
          />
          <Input
            label="Contraseña"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <AlertBanner>{error}</AlertBanner>
          <Button type="submit" icon={LogIn} disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">
          ¿Tienes un enlace de invitacion?{' '}
          <Link to="/registro" className="text-primary hover:underline">
            Completa tu registro aqui
          </Link>
        </p>
      </div>
    </div>
  );
}
