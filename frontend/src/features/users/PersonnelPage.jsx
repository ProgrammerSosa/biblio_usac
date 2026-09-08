import { useEffect, useState } from 'react';
import { UserPlus, Copy, Check, UserX, UserCheck, Users, Mail } from 'lucide-react';
import { usersApi } from './usersApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ROLES, ROL_LABELS } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import Badge from '../../shared/components/Badge';
import Button from '../../shared/components/Button';
import Modal from '../../shared/components/Modal';
import AlertBanner from '../../shared/components/AlertBanner';
import { Input, Select } from '../../shared/components/FormField';

function CopyLinkButton({ link }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <Button variant="secondary" icon={copiado ? Check : Copy} onClick={copiar}>
      {copiado ? 'Copiado' : 'Copiar enlace directo'}
    </Button>
  );
}

function SectionHeader({ icon: Icon, title, count }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon size={15} />
      </div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {count !== undefined ? <span className="text-xs text-slate-400">({count})</span> : null}
    </div>
  );
}

export default function PersonnelPage() {
  const { user: usuarioActual } = useAuth();
  const { categorias, etiquetaDe } = useCategories();
  const [usuarios, setUsuarios] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalAbierto, setModalAbierto] = useState(false);
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState(ROLES.USER);
  const [categoriasSeleccionadas, setCategoriasSeleccionadas] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [errorModal, setErrorModal] = useState('');
  const [enlaceGenerado, setEnlaceGenerado] = useState('');
  const [emailEnviado, setEmailEnviado] = useState(false);

  const [usuarioAConfirmar, setUsuarioAConfirmar] = useState(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const [resUsuarios, resInvitaciones] = await Promise.all([usersApi.list(), usersApi.listInvitations()]);
      setUsuarios(resUsuarios.data.data);
      setInvitaciones(resInvitaciones.data.data);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar el personal'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirModal() {
    setEmail('');
    setRol(ROLES.USER);
    setCategoriasSeleccionadas([]);
    setErrorModal('');
    setEnlaceGenerado('');
    setEmailEnviado(false);
    setModalAbierto(true);
  }

  function toggleCategoria(cat) {
    setCategoriasSeleccionadas((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  function toggleTodasCategorias() {
    setCategoriasSeleccionadas((prev) => (prev.length === categorias.length ? [] : categorias.map((c) => c.clave)));
  }

  async function handleInvitar(e) {
    e.preventDefault();
    setErrorModal('');
    setEnviando(true);
    try {
      const res = await usersApi.invite({
        email,
        rol,
        allowedCategories: rol === ROLES.USER ? categoriasSeleccionadas : [],
      });
      setEnlaceGenerado(res.data.data.invitationLink);
      setEmailEnviado(res.data.data.emailEnviado);
      await cargar();
    } catch (err) {
      setErrorModal(getErrorMessage(err, 'No se pudo crear la invitacion'));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarCambioEstado() {
    if (!usuarioAConfirmar) return;
    setCambiandoEstado(true);
    setError('');
    try {
      await usersApi.setEstado(usuarioAConfirmar._id, !usuarioAConfirmar.activo);
      setUsuarioAConfirmar(null);
      await cargar();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo actualizar el estado de la cuenta'));
    } finally {
      setCambiandoEstado(false);
    }
  }

  const columnasUsuarios = [
    { key: 'nombre', header: 'Nombre' },
    { key: 'email', header: 'Correo' },
    { key: 'rol', header: 'Rol', render: (row) => <Badge tone="primary">{ROL_LABELS[row.rol]}</Badge> },
    {
      key: 'allowedCategories',
      header: 'Categorias asignadas',
      render: (row) => (row.allowedCategories?.length ? row.allowedCategories.map((c) => etiquetaDe(c)).join(', ') : 'N/A'),
    },
    {
      key: 'activo',
      header: 'Estado',
      render: (row) => (row.activo ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Desactivado</Badge>),
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) =>
        row._id === usuarioActual?.id ? (
          <span className="text-xs text-slate-400">Tu cuenta</span>
        ) : row.activo ? (
          <Button variant="secondary" icon={UserX} onClick={() => setUsuarioAConfirmar(row)}>
            Desactivar
          </Button>
        ) : (
          <Button variant="secondary" icon={UserCheck} onClick={() => setUsuarioAConfirmar(row)}>
            Activar
          </Button>
        ),
    },
  ];

  const columnasInvitaciones = [
    { key: 'email', header: 'Correo' },
    { key: 'rol', header: 'Rol', render: (row) => ROL_LABELS[row.rol] },
    {
      key: 'estado',
      header: 'Estado',
      render: (row) => (
        <Badge tone={row.estado === 'PENDIENTE' ? 'warning' : row.estado === 'ACEPTADA' ? 'success' : 'neutral'}>
          {row.estado}
        </Badge>
      ),
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (row.estado === 'PENDIENTE' ? <CopyLinkButton link={row.invitationLink} /> : null),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary-dark">Personal</h1>
        <Button icon={UserPlus} onClick={abrirModal}>
          Invitar colaborador
        </Button>
      </div>

      <AlertBanner>{error}</AlertBanner>

      <section className="flex flex-col gap-3">
        <SectionHeader icon={Users} title="Cuentas" count={usuarios.length} />
        <DataTable columns={columnasUsuarios} rows={usuarios} rowKey="_id" loading={loading} emptyMessage="Aun no hay personal registrado" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader icon={Mail} title="Invitaciones" count={invitaciones.length} />
        <DataTable
          columns={columnasInvitaciones}
          rows={invitaciones}
          rowKey="_id"
          loading={loading}
          emptyMessage="Aun no se han generado invitaciones"
        />
      </section>

      <Modal open={modalAbierto} title="Invitar colaborador" onClose={() => setModalAbierto(false)}>
        {enlaceGenerado ? (
          <div className="flex flex-col gap-4">
            <AlertBanner type="success">
              {emailEnviado
                ? 'Invitacion creada y correo enviado correctamente.'
                : 'Invitacion creada, pero no se pudo enviar el correo automaticamente.'}
            </AlertBanner>
            <p className="text-sm text-slate-600">
              {emailEnviado
                ? 'Tambien puedes compartir este enlace directamente:'
                : 'Comparte este enlace manualmente con la persona invitada:'}
            </p>
            <div className="rounded-md bg-surface p-3 text-xs break-all text-slate-600">{enlaceGenerado}</div>
            <div className="flex justify-end gap-2">
              <CopyLinkButton link={enlaceGenerado} />
              <Button onClick={() => setModalAbierto(false)}>Cerrar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleInvitar} className="flex flex-col gap-4">
            <Input label="Correo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Select label="Rol" value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value={ROLES.USER}>Auxiliar</option>
              <option value={ROLES.ADMIN}>Admin</option>
              <option value={ROLES.MANAGER}>Manager</option>
            </Select>

            {rol === ROLES.USER ? (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Categorias permitidas</span>
                  <label className="flex items-center gap-2 text-xs font-medium text-primary">
                    <input
                      type="checkbox"
                      checked={categorias.length > 0 && categoriasSeleccionadas.length === categorias.length}
                      onChange={toggleTodasCategorias}
                      className="rounded border-border text-primary focus:ring-primary/30"
                    />
                    Seleccionar todas
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {categorias.map((cat) => (
                    <label key={cat.clave} className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={categoriasSeleccionadas.includes(cat.clave)}
                        onChange={() => toggleCategoria(cat.clave)}
                        className="rounded border-border text-primary focus:ring-primary/30"
                      />
                      {cat.nombre}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <AlertBanner>{errorModal}</AlertBanner>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setModalAbierto(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? 'Creando...' : 'Crear invitacion'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!usuarioAConfirmar}
        title={usuarioAConfirmar?.activo ? 'Desactivar cuenta' : 'Activar cuenta'}
        onClose={() => setUsuarioAConfirmar(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUsuarioAConfirmar(null)}>
              Cancelar
            </Button>
            <Button
              variant={usuarioAConfirmar?.activo ? 'danger' : 'primary'}
              onClick={confirmarCambioEstado}
              disabled={cambiandoEstado}
            >
              {cambiandoEstado ? 'Guardando...' : usuarioAConfirmar?.activo ? 'Desactivar' : 'Activar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {usuarioAConfirmar?.activo ? (
            <>
              <strong>{usuarioAConfirmar?.nombre}</strong> no podra iniciar sesion hasta que reactives su cuenta. Sus
              registros existentes en el catalogo no se modifican.
            </>
          ) : (
            <>
              <strong>{usuarioAConfirmar?.nombre}</strong> podra volver a iniciar sesion normalmente.
            </>
          )}
        </p>
      </Modal>
    </div>
  );
}
