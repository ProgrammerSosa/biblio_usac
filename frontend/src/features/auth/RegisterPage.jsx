import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import axiosClient, { getErrorMessage } from '../../shared/api/axiosClient';
import Button from '../../shared/components/Button';
import { Input } from '../../shared/components/FormField';
import AlertBanner from '../../shared/components/AlertBanner';

function CenteredCard({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary-dark px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        {title ? <h1 className="mb-6 text-lg font-semibold text-primary-dark">{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirmar) {
      setError('Las Contraseña no coinciden');
      return;
    }

    setLoading(true);
    try {
      await axiosClient.post('/auth/register-invitation', { token, nombre, password });
      setExito(true);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo completar el registro'));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <CenteredCard title="Enlace invalido">
        <AlertBanner>Este enlace de invitacion no es valido o esta incompleto. Solicita uno nuevo a la Manager.</AlertBanner>
        <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
          Volver a iniciar sesion
        </Link>
      </CenteredCard>
    );
  }

  if (exito) {
    return (
      <CenteredCard title="Cuenta creada">
        <p className="mb-4 text-sm text-slate-600">Tu cuenta se creo correctamente. Ya puedes iniciar sesion.</p>
        <Button onClick={() => navigate('/login', { replace: true })}>Ir a iniciar sesion</Button>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title="Completa tu registro">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Nombre completo" required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Input
          label="Contraseña"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Confirmar Contraseña"
          type="password"
          required
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
        />
        <AlertBanner>{error}</AlertBanner>
        <Button type="submit" icon={UserPlus} disabled={loading}>
          {loading ? 'Creando cuenta...' : 'Crear cuenta'}
        </Button>
      </form>
    </CenteredCard>
  );
}
