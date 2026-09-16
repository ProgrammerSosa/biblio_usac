import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, AlertTriangle, FileDown, Search, Layers, Send, FileSpreadsheet } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCategories } from '../../shared/hooks/useCategories';
import { ESTADOS_REVISION, ESTADO_REVISION_LABELS, ROLES, tieneDanoFisico, ORDEN_POR_DEFECTO, OPCIONES_ORDEN_CATALOGO } from '../../shared/constants';
import DataTable from '../../shared/components/DataTable';
import EstadoRevisionBadge from '../../shared/components/EstadoRevisionBadge';
import Badge from '../../shared/components/Badge';
import Button from '../../shared/components/Button';
import Pagination from '../../shared/components/Pagination';
import Modal from '../../shared/components/Modal';
import AlertBanner from '../../shared/components/AlertBanner';
import { Select } from '../../shared/components/FormField';
import CatalogDetailFields from './CatalogDetailFields';

const TONO_ESTADO = { PENDIENTE: 'neutral', APROBADO: 'success', RECHAZADO: 'danger' };

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

function normalizarParaComparar(valor) {
  // Datos escritos a mano (o importados de distintos Excel) casi nunca coinciden byte por
  // byte aunque sean "el mismo autor": espacios dobles, espacios al inicio/final, mayusculas
  // distintas, acentos puestos o no ("Garcia" vs "García"). Se normaliza antes de comparar
  // para que esas diferencias menores no partan en dos lo que en realidad es la misma obra.
  // Misma regla que usa el import de Excel (excelImport.js) para que ambos coincidan.
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Dos registros son "copias" del mismo material si TODO coincide - categoria, autor, titulo,
// idioma, anio, edicion, lugar, paginas y los atributos propios de la categoria (editorial,
// ISBN, etc.) - excepto el estado fisico y el No. de Inventario, los dos unicos datos que de
// verdad cambian entre copias fisicas del mismo libro.
function claveDeGrupo(item) {
  const camposBase = [item.categoria, item.autor, item.titulo, item.idioma, item.anio, item.edicion, item.lugar, item.paginasImpresas];
  const atributos = item.atributos || {};
  const atributosOrdenados = Object.keys(atributos)
    .sort()
    .map((clave) => `${clave}:${atributos[clave]}`);
  return [...camposBase, ...atributosOrdenados].map(normalizarParaComparar).join('|');
}

function agruparRegistros(registros) {
  const grupos = new Map();
  for (const item of registros) {
    const clave = claveDeGrupo(item);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(item);
  }
  return [...grupos.values()].map((copias) => ({ ...copias[0], copias }));
}

function nombreArchivoPdf() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const hora = `${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;
  return `catalogo-biblioteca-${fecha}_${hora}.pdf`;
}

function EstadoOBorrador({ item }) {
  if (!item.enviado) {
    return <Badge tone="warning">Borrador</Badge>;
  }
  return <EstadoRevisionBadge estado={item.estadoRevision} />;
}

function ResumenEstadoRevision({ copias }) {
  if (copias.length === 1) {
    return <EstadoOBorrador item={copias[0]} />;
  }

  const cuenta = {};
  copias.forEach((c) => {
    const clave = c.enviado ? c.estadoRevision : 'BORRADOR';
    cuenta[clave] = (cuenta[clave] || 0) + 1;
  });
  const distintos = Object.keys(cuenta);

  if (distintos.length === 1 && distintos[0] !== 'BORRADOR') {
    return <EstadoRevisionBadge estado={distintos[0]} />;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {distintos.map((estado) =>
        estado === 'BORRADOR' ? (
          <Badge key={estado} tone="warning">
            {cuenta[estado]} Borrador
          </Badge>
        ) : (
          <Badge key={estado} tone={TONO_ESTADO[estado] || 'neutral'}>
            {cuenta[estado]} {ESTADO_REVISION_LABELS[estado]}
          </Badge>
        )
      )}
    </div>
  );
}

function ListaCopias({ copias, puedeEditar, esManager, onEliminar, onEnviar }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">No. Inventario</th>
            <th className="px-3 py-2 font-semibold">Estado fisico</th>
            <th className="px-3 py-2 font-semibold">Estado</th>
            <th className="px-3 py-2 font-semibold">Registrado por</th>
            <th className="px-3 py-2 font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {copias.map((copia) => (
            <tr key={copia._id}>
              <td className="px-3 py-2 font-medium text-slate-700">{copia.noInventario || 'N/A'}</td>
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
  const [page, setPage] = useState(1);
  const [categoria, setCategoria] = useState('');
  const [estadoRevision, setEstadoRevision] = useState('');
  const [sort, setSort] = useState(ORDEN_POR_DEFECTO);
  const [buscarInput, setBuscarInput] = useState('');
  const [buscar, setBuscar] = useState('');
  const [soloMios, setSoloMios] = useState(user?.rol === ROLES.USER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [itemAEliminar, setItemAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [loteAbierto, setLoteAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 15, sort };
      if (categoria) params.categoria = categoria;
      if (estadoRevision) params.estadoRevision = estadoRevision;
      if (soloMios) params.registradoPor = user?.id;
      if (buscar.trim()) params.buscar = buscar.trim();
      const res = await catalogApi.list(params);
      setRegistros(res.data.data.registros);
      setTotalPages(res.data.data.totalPages);
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
  }, [page, categoria, estadoRevision, soloMios, buscar, sort]);

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
      const params = { sort };
      if (categoria) params.categoria = categoria;
      if (estadoRevision) params.estadoRevision = estadoRevision;
      if (soloMios) params.registradoPor = user?.id;
      if (buscar.trim()) params.buscar = buscar.trim();
      const res = await catalogApi.exportPdf(params);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = nombreArchivoPdf();
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo generar el PDF'));
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
      key: 'noInventario',
      header: 'No. Inv.',
      render: (row) =>
        row.copias.length > 1 ? (
          // El primer ejemplar no es "copia de si mismo" - se muestran las copias
          // adicionales (total menos el original), aunque los N registros existen igual.
          <Badge tone="primary" icon={Layers}>
            {row.copias.length - 1} {row.copias.length === 2 ? 'copia' : 'copias'}
          </Badge>
        ) : (
          row.noInventario || 'N/A'
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
          onEliminar={setItemAEliminar}
          onEnviar={enviarUno}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary-dark">Catalogo</h1>
        <div className="flex gap-2">
          <Link to="/catalogo/importar">
            <Button variant="secondary" icon={FileSpreadsheet}>
              Importar Excel
            </Button>
          </Link>
          <Button variant="secondary" icon={FileDown} onClick={handleExportar} disabled={exportando}>
            {exportando ? 'Generando...' : 'Exportar PDF'}
          </Button>
          <Link to="/catalogo/nuevo">
            <Button icon={Plus}>Registrar material</Button>
          </Link>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={buscarInput}
          onChange={(e) => setBuscarInput(e.target.value)}
          placeholder="Buscar por titulo, autor o no. de inventario..."
          className="w-full rounded-md border border-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex gap-3">
        <Select
          value={categoria}
          onChange={(e) => {
            setPage(1);
            setCategoria(e.target.value);
          }}
          className="max-w-xs"
        >
          <option value="">Todas las categorias</option>
          {categorias.map((cat) => (
            <option key={cat.clave} value={cat.clave}>
              {cat.nombre}
            </option>
          ))}
        </Select>
        <Select
          value={estadoRevision}
          onChange={(e) => {
            setPage(1);
            setEstadoRevision(e.target.value);
          }}
          className="max-w-xs"
        >
          <option value="">Todos los estados</option>
          {Object.values(ESTADOS_REVISION).map((estado) => (
            <option key={estado} value={estado}>
              {ESTADO_REVISION_LABELS[estado]}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => {
            setPage(1);
            setSort(e.target.value);
          }}
          className="max-w-xs"
        >
          {OPCIONES_ORDEN_CATALOGO.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              Ordenar por: {opcion.label}
            </option>
          ))}
        </Select>
        {user?.rol === ROLES.USER ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={soloMios}
              onChange={(e) => {
                setPage(1);
                setSoloMios(e.target.checked);
              }}
              className="rounded border-border text-primary focus:ring-primary/30"
            />
            Solo mis registros
          </label>
        ) : null}
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
          ¿Confirmas eliminar el registro <strong>{itemAEliminar?.titulo}</strong> (No. Inventario{' '}
          {itemAEliminar?.noInventario})? Esta accion quedara registrada en la auditoria.
        </p>
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
