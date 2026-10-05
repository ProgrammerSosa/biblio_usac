import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, AlertTriangle, FileDown, Search, Layers, Send, FileSpreadsheet, Archive, X } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ESTADOS_REVISION, ESTADO_REVISION_LABELS, ROLES, tieneDanoFisico } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import EstadoRevisionBadge from '../../shared/components/EstadoRevisionBadge';
import Badge from '../../shared/components/Badge';
import Button from '../../shared/components/Button';
import Pagination from '../../shared/components/Pagination';
import Modal from '../../shared/components/Modal';
import AlertBanner from '../../shared/components/AlertBanner';
import { Textarea } from '../../shared/components/FormField';
import CatalogDetailFields from './CatalogDetailFields';
import FiltrosCatalogo from './FiltrosCatalogo';
import { filtrosIniciales, parametrosDeFiltros, placeholderBusqueda, resumenDeFiltros } from './catalogFiltros';
import { agruparRegistros } from '../../shared/utils/catalogGrouping';

const TONO_ESTADO = { PENDIENTE: 'neutral', APROBADO: 'success', RECHAZADO: 'danger' };

// Años para el filtro "Año de registro" (cuando se creo el registro, no el de publicacion):
// del año actual hacia atras, suficiente para cubrir el historial de la biblioteca sin tener
// que consultar al backend solo para saber que años existen.
const ANIO_ACTUAL = new Date().getFullYear();
const aniosRegistro = Array.from({ length: 15 }, (_, i) => ANIO_ACTUAL - i);

function RegistradoPor({ item }) {
  if (item.origenImportacion) {
    const nombre = item.registradoPor?.nombre || 'N/A';
    return (
      <span className="flex max-w-[6rem] flex-col" title={`Importado de ${item.origenImportacion} por ${nombre}`}>
        <span className="inline-flex items-center gap-1 text-slate-600">
          <FileSpreadsheet size={13} className="shrink-0 text-primary" />
          <span className="truncate">{item.origenImportacion}</span>
        </span>
        <span className="truncate text-[11px] text-slate-400">{nombre}</span>
      </span>
    );
  }
  return (
    <span className="block max-w-[6rem] truncate" title={item.registradoPor?.nombre}>
      {item.registradoPor?.nombre || 'N/A'}
    </span>
  );
}

function nombreArchivoPdf() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const hora = `${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;
  return `catalogo-biblioteca-${fecha}_${hora}.pdf`;
}

// El PDF se pide como "blob": si el servidor contesta con un error (ej. "No hay registros que
// coincidan con los filtros indicados"), el JSON llega dentro de ese blob y hay que leerlo para
// poder mostrar el mensaje real en vez de uno generico.
async function mensajeDeErrorPdf(err) {
  const cuerpo = err?.response?.data;
  if (cuerpo instanceof Blob) {
    try {
      const mensaje = JSON.parse(await cuerpo.text())?.error;
      if (mensaje) return mensaje;
    } catch {
      // El cuerpo no era JSON: se usa el mensaje generico.
    }
  }
  return getErrorMessage(err, 'No se pudo generar el PDF');
}

function EstadoOBorrador({ item }) {
  if (item.deBaja) {
    return (
      <Badge tone="neutral" icon={Archive}>
        De baja
      </Badge>
    );
  }
  if (!item.enviado) {
    return <Badge tone="warning">Borrador</Badge>;
  }
  return <EstadoRevisionBadge estado={item.estadoRevision} />;
}

// Solo tiene sentido dar de baja algo que de verdad estuvo en el inventario (Aprobado) y que
// todavia no este dado de baja - mismo criterio que valida el backend, para no ofrecer el
// boton en un caso que el servidor va a rechazar de todas formas.
function puedeDarDeBaja(item, rol) {
  return [ROLES.ADMIN, ROLES.MANAGER].includes(rol) && item.estadoRevision === ESTADOS_REVISION.APROBADO && !item.deBaja;
}

function ResumenEstadoRevision({ copias }) {
  if (copias.length === 1) {
    return <EstadoOBorrador item={copias[0]} />;
  }

  const cuenta = {};
  copias.forEach((c) => {
    const clave = c.deBaja ? 'DE_BAJA' : c.enviado ? c.estadoRevision : 'BORRADOR';
    cuenta[clave] = (cuenta[clave] || 0) + 1;
  });
  const distintos = Object.keys(cuenta);

  if (distintos.length === 1 && distintos[0] !== 'BORRADOR' && distintos[0] !== 'DE_BAJA') {
    return <EstadoRevisionBadge estado={distintos[0]} />;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {distintos.map((estado) => {
        if (estado === 'BORRADOR') {
          return (
            <Badge key={estado} tone="warning">
              {cuenta[estado]} Borrador
            </Badge>
          );
        }
        if (estado === 'DE_BAJA') {
          return (
            <Badge key={estado} tone="neutral" icon={Archive}>
              {cuenta[estado]} de baja
            </Badge>
          );
        }
        return (
          <Badge key={estado} tone={TONO_ESTADO[estado] || 'neutral'}>
            {cuenta[estado]} {ESTADO_REVISION_LABELS[estado]}
          </Badge>
        );
      })}
    </div>
  );
}

function ListaCopias({ copias, puedeEditar, esManager, rol, onEliminar, onEnviar, onDarDeBaja }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">ID</th>
            <th className="px-3 py-2 font-semibold">Estado fisico</th>
            <th className="px-3 py-2 font-semibold">Estado</th>
            <th className="px-3 py-2 font-semibold">Registrado por</th>
            <th className="px-3 py-2 font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {copias.map((copia) => (
            <tr key={copia._id}>
              <td className="px-3 py-2 font-medium text-slate-700">{copia.idInventario ?? 'N/A'}</td>
              <td className="px-3 py-2">
                {tieneDanoFisico(copia.estadoFisico) ? (
                  <Badge tone="danger" icon={AlertTriangle}>
                    {copia.estadoFisico}
                  </Badge>
                ) : (
                  <span className="block max-w-[14rem] truncate text-slate-500" title={copia.estadoFisico}>
                    {copia.estadoFisico || 'N/A'}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <EstadoOBorrador item={copia} />
                {copia.estadoRevision === ESTADOS_REVISION.RECHAZADO && copia.observaciones ? (
                  <p className="mt-1 text-xs text-secondary">{copia.observaciones}</p>
                ) : null}
                {copia.deBaja && copia.motivoBaja ? <p className="mt-1 text-xs text-slate-500">{copia.motivoBaja}</p> : null}
              </td>
              <td className="px-3 py-2">
                <RegistradoPor item={copia} />
              </td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  {!copia.enviado ? (
                    <button onClick={() => onEnviar(copia)} className="text-primary hover:text-primary-light" title="Enviar a revision">
                      <Send size={16} />
                    </button>
                  ) : null}
                  {puedeEditar(copia) ? (
                    <Link to={`/catalogo/${copia._id}/editar`} className="text-primary hover:text-primary-light" title="Editar">
                      <Pencil size={16} />
                    </Link>
                  ) : null}
                  {puedeDarDeBaja(copia, rol) ? (
                    <button onClick={() => onDarDeBaja(copia)} className="text-slate-500 hover:text-slate-700" title="Dar de baja">
                      <Archive size={16} />
                    </button>
                  ) : null}
                  {esManager ? (
                    <button onClick={() => onEliminar(copia)} className="text-secondary hover:text-red-700" title="Eliminar">
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CatalogListPage() {
  const { user } = useAuth();
  const { categorias, etiquetaDe } = useCategories();
  const [registros, setRegistros] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(null);
  const [page, setPage] = useState(1);
  // Todo lo que se marca en el panel de filtros (ver catalogFiltros.js), mas el texto de la barra.
  const [filtros, setFiltros] = useState(() => filtrosIniciales({ soloMios: user?.rol === ROLES.USER }));
  const [buscarInput, setBuscarInput] = useState('');
  const [buscar, setBuscar] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [itemAEliminar, setItemAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [loteAbierto, setLoteAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [itemDarDeBaja, setItemDarDeBaja] = useState(null);
  const [motivoBaja, setMotivoBaja] = useState('');
  const [darandoDeBaja, setDarandoDeBaja] = useState(false);
  const [errorBaja, setErrorBaja] = useState('');

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 15, ...parametrosDeFiltros(filtros, { buscar, userId: user?.id }) };
      const res = await catalogApi.list(params);
      setRegistros(res.data.data.registros);
      setTotalPages(res.data.data.totalPages);
      setTotal(res.data.data.total);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar el catalogo'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const temporizador = setTimeout(() => {
      setPage(1);
      setBuscar(buscarInput);
    }, 350);
    return () => clearTimeout(temporizador);
  }, [buscarInput]);

  useEffect(() => {
    cargar();
    setSeleccionados(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filtros, buscar]);

  // Cambiar cualquier filtro vuelve a la primera pagina del listado.
  function cambiarFiltros(cambios) {
    setPage(1);
    setFiltros((actuales) => ({ ...actuales, ...cambios }));
  }

  function limpiarFiltros() {
    setPage(1);
    setFiltros(filtrosIniciales());
  }

  async function confirmarEliminar() {
    if (!itemAEliminar) return;
    setEliminando(true);
    try {
      await catalogApi.remove(itemAEliminar._id);
      setItemAEliminar(null);
      await cargar();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo eliminar el registro'));
    } finally {
      setEliminando(false);
    }
  }

  function abrirDarDeBaja(item) {
    setItemDarDeBaja(item);
    setMotivoBaja('');
    setErrorBaja('');
  }

  async function confirmarDarDeBaja() {
    if (!itemDarDeBaja) return;
    if (!motivoBaja.trim()) {
      setErrorBaja('El motivo es obligatorio');
      return;
    }
    setDarandoDeBaja(true);
    setErrorBaja('');
    try {
      await catalogApi.darDeBaja(itemDarDeBaja._id, motivoBaja.trim());
      setItemDarDeBaja(null);
      setMensaje('Registro dado de baja correctamente');
      await cargar();
    } catch (err) {
      setErrorBaja(getErrorMessage(err, 'No se pudo dar de baja el registro'));
    } finally {
      setDarandoDeBaja(false);
    }
  }

  async function enviarVarios(items) {
    setError('');
    try {
      const res = await catalogApi.enviarLote(items.map((i) => i._id));
      setMensaje(`${res.data.data.enviados} registro(s) enviado(s) a revision`);
      await cargar();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo enviar el registro'));
    }
  }

  function enviarUno(item) {
    return enviarVarios([item]);
  }

  async function confirmarLote() {
    setEnviando(true);
    setError('');
    try {
      const res = await catalogApi.enviarLote([...seleccionados]);
      setMensaje(`${res.data.data.enviados} registro(s) enviado(s) a revision`);
      setSeleccionados(new Set());
      setLoteAbierto(false);
      await cargar();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo enviar el lote'));
    } finally {
      setEnviando(false);
    }
  }

  function toggleUno(id) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodos(borradores) {
    setSeleccionados((prev) => {
      const todosSeleccionados = borradores.length > 0 && borradores.every((b) => prev.has(b._id));
      return todosSeleccionados ? new Set() : new Set(borradores.map((b) => b._id));
    });
  }

  async function handleExportar() {
    setExportando(true);
    setError('');
    try {
      const res = await catalogApi.exportPdf(parametrosDeFiltros(filtros, { buscar, userId: user?.id }));
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = nombreArchivoPdf();
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(await mensajeDeErrorPdf(err));
    } finally {
      setExportando(false);
    }
  }

  function puedeEditar(item) {
    if (item.estadoRevision === ESTADOS_REVISION.APROBADO) {
      // Ya aprobado: solo la Manager lo puede corregir.
      return user?.rol === ROLES.MANAGER;
    }
    const esSupervisor = [ROLES.ADMIN, ROLES.MANAGER].includes(user?.rol);
    if (esSupervisor) return true;
    const esAutor = item.registradoPor?._id === user?.id;
    const estadoEditable = [ESTADOS_REVISION.PENDIENTE, ESTADOS_REVISION.RECHAZADO].includes(item.estadoRevision);
    return esAutor && estadoEditable;
  }

  const pastillas = resumenDeFiltros(filtros, { nombreDeCategoria: etiquetaDe, esUsuarioAuxiliar: user?.rol === ROLES.USER });

  const filas = agruparRegistros(registros);
  const borradoresEnPagina = filas.filter((f) => f.copias.length === 1 && !f.copias[0].enviado).map((f) => f.copias[0]);

  const columns = [
    ...(borradoresEnPagina.length > 0
      ? [
          {
            key: 'seleccion',
            header: (
              <input
                type="checkbox"
                checked={borradoresEnPagina.every((b) => seleccionados.has(b._id))}
                onChange={() => toggleTodos(borradoresEnPagina)}
                className="rounded border-border text-primary focus:ring-primary/30"
              />
            ),
            render: (row) =>
              row.copias.length === 1 && !row.copias[0].enviado ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(row.copias[0]._id)}
                    onChange={() => toggleUno(row.copias[0]._id)}
                    className="rounded border-border text-primary focus:ring-primary/30"
                  />
                </div>
              ) : null,
          },
        ]
      : []),
    {
      key: 'idInventario',
      header: 'ID',
      render: (row) =>
        row.copias.length > 1 ? (
          // El primer ejemplar (el que se ingreso primero) no es "copia de si mismo": se muestra su
          // ID y, al lado, cuantas copias adicionales tiene (total menos el original), aunque los N
          // registros existen igual. El ID de cada copia sale al desplegar la fila.
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-700">{row.idInventario ?? 'N/A'}</span>
            <Badge tone="primary" icon={Layers}>
              {row.copias.length - 1} {row.copias.length === 2 ? 'copia' : 'copias'}
            </Badge>
          </span>
        ) : (
          row.idInventario ?? 'N/A'
        ),
    },
    {
      key: 'categoria',
      header: 'Categoria',
      render: (row) => {
        const etiqueta = etiquetaDe(row.categoria);
        return (
          <span className="block max-w-[6rem] truncate" title={etiqueta}>
            {etiqueta}
          </span>
        );
      },
    },
    {
      key: 'titulo',
      header: 'Titulo',
      render: (row) => (
        <span className="block max-w-[9rem] truncate" title={row.titulo}>
          {row.titulo}
        </span>
      ),
    },
    {
      key: 'autor',
      header: 'Autor',
      render: (row) => (
        <span className="block max-w-[6rem] truncate" title={row.autor}>
          {row.autor}
        </span>
      ),
    },
    {
      key: 'estadoFisico',
      header: 'Estado fisico',
      render: (row) => {
        const conDano = row.copias.filter((c) => tieneDanoFisico(c.estadoFisico));
        if (conDano.length > 0) {
          return (
            <Badge tone="danger" icon={AlertTriangle}>
              {conDano.length} de {row.copias.length} con daño
            </Badge>
          );
        }
        const texto = row.copias[0].estadoFisico || 'N/A';
        return (
          <span className="block max-w-[8rem] truncate text-slate-500" title={texto}>
            {texto}
          </span>
        );
      },
    },
    { key: 'estadoRevision', header: 'Estado', render: (row) => <ResumenEstadoRevision copias={row.copias} /> },
    {
      key: 'registradoPor',
      header: 'Registrado por',
      render: (row) => {
        const claves = new Set(row.copias.map((c) => c.origenImportacion || c.registradoPor?.nombre || 'N/A'));
        return claves.size === 1 ? <RegistradoPor item={row.copias[0]} /> : 'Varios';
      },
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (row) => {
        if (row.copias.length > 1) {
          const pendientes = row.copias.filter((c) => !c.enviado);
          return (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-slate-400">Ver copias</span>
              {pendientes.length > 0 ? (
                <button
                  onClick={() => enviarVarios(pendientes)}
                  className="text-primary hover:text-primary-light"
                  title={`Enviar ${pendientes.length} a revision`}
                >
                  <Send size={16} />
                </button>
              ) : null}
            </div>
          );
        }
        const item = row.copias[0];
        return (
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {!item.enviado ? (
              <button onClick={() => enviarUno(item)} className="text-primary hover:text-primary-light" title="Enviar a revision">
                <Send size={16} />
              </button>
            ) : null}
            {puedeEditar(item) ? (
              <Link to={`/catalogo/${item._id}/editar`} className="text-primary hover:text-primary-light" title="Editar">
                <Pencil size={16} />
              </Link>
            ) : null}
            {puedeDarDeBaja(item, user?.rol) ? (
              <button onClick={() => abrirDarDeBaja(item)} className="text-slate-500 hover:text-slate-700" title="Dar de baja">
                <Archive size={16} />
              </button>
            ) : null}
            {user?.rol === ROLES.MANAGER ? (
              <button onClick={() => setItemAEliminar(item)} className="text-secondary hover:text-red-700" title="Eliminar">
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  function renderExpanded(row) {
    if (row.copias.length === 1) {
      return <CatalogDetailFields item={row.copias[0]} />;
    }
    return (
      <div className="flex flex-col gap-4">
        <CatalogDetailFields item={row.copias[0]} ocultarRevision />
        <ListaCopias
          copias={row.copias}
          puedeEditar={puedeEditar}
          esManager={user?.rol === ROLES.MANAGER}
          rol={user?.rol}
          onEliminar={setItemAEliminar}
          onEnviar={enviarUno}
          onDarDeBaja={abrirDarDeBaja}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-primary-dark">Catalogo</h1>
        <div className="flex gap-2">
          <Link to="/catalogo/importar">
            <Button variant="secondary" icon={FileSpreadsheet}>
              Importar Excel
            </Button>
          </Link>
          <Link to="/catalogo/nuevo">
            <Button icon={Plus}>Registrar material</Button>
          </Link>
        </div>
      </div>

      {/* Busqueda, filtros y PDF juntos: el PDF sale con exactamente lo que se ve filtrado. */}
      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={buscarInput}
              onChange={(e) => setBuscarInput(e.target.value)}
              placeholder={placeholderBusqueda(filtros)}
              className="h-10 w-full rounded-lg border border-border bg-slate-50 pl-10 pr-3 text-sm outline-none transition-colors focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <FiltrosCatalogo
            filtros={filtros}
            onCambiar={cambiarFiltros}
            onLimpiar={limpiarFiltros}
            categorias={categorias}
            aniosRegistro={aniosRegistro}
            mostrarSoloMios={user?.rol === ROLES.USER}
            cantidadActiva={pastillas.length}
            total={total}
            cargando={loading}
          />
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Button variant="secondary" icon={FileDown} className="h-10" onClick={handleExportar} disabled={exportando}>
            {exportando ? 'Generando...' : 'Exportar PDF'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-b-xl border-t border-border bg-slate-50/70 px-4 py-2.5">
          {pastillas.length === 0 ? (
            <span className="text-xs text-slate-500">Sin filtros: se muestra todo el catalogo.</span>
          ) : (
            <>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros</span>
              {pastillas.map((pastilla) => (
                <span
                  key={pastilla.id}
                  className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border border-primary/30 bg-white py-1 pl-2.5 pr-1 text-xs text-primary-dark"
                >
                  <span className="truncate">
                    {pastilla.grupo ? <span className="text-slate-500">{pastilla.grupo}: </span> : null}
                    <span className="font-medium">{pastilla.texto}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => cambiarFiltros(pastilla.quitar)}
                    aria-label={`Quitar filtro ${pastilla.texto}`}
                    className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <button type="button" onClick={limpiarFiltros} className="text-xs font-medium text-primary hover:underline">
                Limpiar
              </button>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            <FileDown size={13} className="shrink-0" />
            El PDF usa estos mismos filtros{total !== null ? ` · ${total} ${total === 1 ? 'material' : 'materiales'}` : ''}
          </span>
        </div>
      </div>

      <AlertBanner>{error}</AlertBanner>
      <AlertBanner type="success">{mensaje}</AlertBanner>

      {seleccionados.size > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-primary-dark">
            {seleccionados.size} borrador{seleccionados.size === 1 ? '' : 'es'} seleccionado{seleccionados.size === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSeleccionados(new Set())}>
              Cancelar seleccion
            </Button>
            <Button icon={Send} onClick={() => setLoteAbierto(true)}>
              Enviar a revision
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={filas}
        rowKey="_id"
        loading={loading}
        emptyMessage="No hay materiales registrados"
        renderExpanded={renderExpanded}
      />
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <Modal
        open={!!itemAEliminar}
        title="Eliminar registro"
        onClose={() => setItemAEliminar(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemAEliminar(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarEliminar} disabled={eliminando}>
              {eliminando ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          ¿Confirmas eliminar el registro <strong>{itemAEliminar?.titulo}</strong>
          {itemAEliminar?.idInventario ? ` (ID ${itemAEliminar.idInventario})` : ''}? Esta accion quedara registrada en
          la auditoria.
        </p>
      </Modal>

      <Modal
        open={!!itemDarDeBaja}
        title="Dar de baja"
        onClose={() => setItemDarDeBaja(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemDarDeBaja(null)}>
              Cancelar
            </Button>
            <Button variant="danger" icon={Archive} onClick={confirmarDarDeBaja} disabled={darandoDeBaja}>
              {darandoDeBaja ? 'Guardando...' : 'Dar de baja'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            Vas a dar de baja <strong>{itemDarDeBaja?.titulo}</strong>
            {itemDarDeBaja?.idInventario ? ` (ID ${itemDarDeBaja.idInventario})` : ''}. El registro se queda visible
            en el catalogo y en los reportes (marcado en gris) para dejar constancia de que existio - no se elimina.
          </p>
          <Textarea
            label="Motivo"
            required
            placeholder="Ej. Se perdio, se dono, se destruyo por daño irreparable..."
            value={motivoBaja}
            onChange={(e) => setMotivoBaja(e.target.value)}
          />
          <AlertBanner>{errorBaja}</AlertBanner>
        </div>
      </Modal>

      <Modal
        open={loteAbierto}
        title="Enviar a revision"
        onClose={() => setLoteAbierto(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLoteAbierto(false)}>
              Cancelar
            </Button>
            <Button icon={Send} onClick={confirmarLote} disabled={enviando}>
              {enviando ? 'Enviando...' : `Enviar ${seleccionados.size} registro(s)`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Vas a enviar <strong>{seleccionados.size}</strong> registro{seleccionados.size === 1 ? '' : 's'} a revision.
          Dejaran de ser borrador y Admin/Manager podran verlos y aprobarlos.
        </p>
      </Modal>
    </div>
  );
}
