import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, FileCheck2, ChevronDown, ChevronRight } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useCategories } from '../../shared/hooks/useCategories';
import Button from '../../shared/components/Button';
import Badge from '../../shared/components/Badge';
import AlertBanner from '../../shared/components/AlertBanner';

// Debe coincidir con LIMITE_ARCHIVO_MB del backend (utils/constants.js).
const LIMITE_MB = 20;

function claveItem(categoria, fila) {
  return `${categoria}-${fila}`;
}

function motivoNoImportado(item) {
  if (!item.valido) return item.errores.join(', ');
  if (item.camposFaltantes?.length > 0) {
    return `Faltaban campos obligatorios (${item.camposFaltantes.join(', ')}) y no la marcaste para importar`;
  }
  return 'La desmarcaste y no se importo';
}

// Cuando Render tumba la peticion (502 por falta de memoria con un Excel muy pesado) el navegador
// la reporta como error de red/CORS y no llega ninguna respuesta con mensaje - sin esto, el
// usuario solo veria "No se pudo leer el archivo" sin ninguna pista de que hacer.
function mensajeDeError(err, fallback) {
  if (!err.response || [502, 503, 504].includes(err.response.status)) {
    return `El servidor no pudo procesar el archivo. Suele pasar cuando el Excel es muy pesado o trae mucho formato (limite ${LIMITE_MB} MB): copia solo las filas con datos a un libro nuevo (Pegado especial > Valores) y vuelve a subirlo. Si el archivo ya es chico, el servidor pudo estar despertando: espera un minuto e intenta de nuevo.`;
  }
  return getErrorMessage(err, fallback);
}

export default function ImportPage() {
  const { etiquetaDe } = useCategories();
  const inputRef = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [hojas, setHojas] = useState(null);
  const [hojasOmitidas, setHojasOmitidas] = useState([]);
  const [seleccion, setSeleccion] = useState({});
  const [colapsadas, setColapsadas] = useState(new Set());
  const [analizando, setAnalizando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  function elegirArchivo(lista) {
    const nuevo = lista?.[0];
    if (!nuevo) return;
    const nombre = nuevo.name.toLowerCase();
    if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.xls')) {
      setError('El archivo debe ser un Excel (.xlsx o .xls)');
      return;
    }
    if (nuevo.size > LIMITE_MB * 1024 * 1024) {
      const mb = (nuevo.size / 1024 / 1024).toFixed(1);
      setError(
        `El archivo pesa ${mb} MB y el limite es ${LIMITE_MB} MB. Copia solo las filas con datos a un libro nuevo (Pegado especial > Valores) y vuelve a subirlo.`
      );
      return;
    }
    setError('');
    setArchivo(nuevo);
  }

  function handleDrop(e) {
    e.preventDefault();
    setArrastrando(false);
    elegirArchivo(e.dataTransfer.files);
  }

  async function handleAnalizar() {
    if (!archivo) return;
    setAnalizando(true);
    setError('');
    setResultado(null);
    try {
      const res = await catalogApi.importarPrevisualizar(archivo);
      const nuevaSeleccion = {};
      const todasColapsadas = new Set();
      res.data.data.hojas.forEach((hoja) => {
        todasColapsadas.add(hoja.categoria);
        hoja.items.forEach((item) => {
          // Una fila queda marcada para subir por defecto solo si esta 100% completa - ni le
          // falta autor/titulo (item.valido) ni un campo obligatorio de la categoria
          // (camposFaltantes, ej. "Notas" si la marcaste como obligatoria). Antes, una fila con
          // un campo obligatorio faltante se subia igual (con "N/A") aunque mostrara la
          // advertencia en rojo - habia que darse cuenta y desmarcarla a mano. Asi, si algo no
          // esta completo, toca revisarla y decidir a proposito: la incluyes con N/A o
          // cancelas, corriges el Excel y lo vuelves a subir.
          const completo = item.valido && (!item.camposFaltantes || item.camposFaltantes.length === 0);
          nuevaSeleccion[claveItem(hoja.categoria, item.fila)] = { incluir: completo, usarCopias: true };
        });
      });
      setHojas(res.data.data.hojas);
      setHojasOmitidas(res.data.data.hojasOmitidas || []);
      setSeleccion(nuevaSeleccion);
      // Todas empiezan cerradas para que la pagina no se estire con archivos grandes;
      // se abren una por una segun lo que se quiera revisar.
      setColapsadas(todasColapsadas);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo leer el archivo'));
    } finally {
      setAnalizando(false);
    }
  }

  function toggleIncluir(categoria, fila) {
    const clave = claveItem(categoria, fila);
    setSeleccion((prev) => ({ ...prev, [clave]: { ...prev[clave], incluir: !prev[clave].incluir } }));
  }

  function toggleUsarCopias(categoria, fila) {
    const clave = claveItem(categoria, fila);
    setSeleccion((prev) => ({ ...prev, [clave]: { ...prev[clave], usarCopias: !prev[clave].usarCopias } }));
  }

  function toggleColapsada(categoria) {
    setColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(categoria)) next.delete(categoria);
      else next.add(categoria);
      return next;
    });
  }

  async function handleConfirmar() {
    const items = [];
    const noImportados = [];
    hojas.forEach((hoja) => {
      hoja.items.forEach((item) => {
        const estado = seleccion[claveItem(hoja.categoria, item.fila)];
        if (!estado?.incluir) {
          noImportados.push({
            categoria: hoja.categoria,
            fila: item.fila,
            titulo: item.titulo,
            motivo: motivoNoImportado(item),
          });
          return;
        }
        items.push({ ...item, copias: estado.usarCopias ? item.copias : 1 });
      });
    });

    if (items.length === 0) {
      setError('No hay ningun material marcado para importar');
      return;
    }

    setConfirmando(true);
    setError('');
    try {
      const res = await catalogApi.importarConfirmar(items, archivo?.name);
      setResultado({ ...res.data.data, hojasOmitidas, noImportados });
      setHojas(null);
      setArchivo(null);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo completar la importacion'));
    } finally {
      setConfirmando(false);
    }
  }

  const totalSeleccionados = Object.values(seleccion).filter((s) => s.incluir).length;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/catalogo" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
        <ArrowLeft size={16} />
        Volver al catalogo
      </Link>

      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FileSpreadsheet size={17} />
        </div>
        <h1 className="text-xl font-semibold text-primary-dark">Importar desde Excel</h1>
      </div>
      <p className="max-w-2xl text-sm text-slate-500">
        Excel de maximo {LIMITE_MB} MB. Cada hoja debe llamarse como su categoria (ej. Libros, Tesis) y los
        encabezados van en la fila 1; solo se importan las hojas que coincidan. Cada fila necesita su ID (columna
        "ID", ej. 20F, 20F-C1) y no puede repetirse. Una fila = un ejemplar: las filas iguales se agrupan como
        copias. Antes de guardar revisas lo detectado.
      </p>

      <AlertBanner>{error}</AlertBanner>

      {resultado ? (
        <div className="rounded-lg border border-border bg-white p-6">
          <div className="mb-3 flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={20} />
            <h2 className="text-base font-semibold">Importacion completada</h2>
          </div>
          <p className="text-sm text-slate-600">
            Se crearon <strong>{resultado.creados}</strong> material(es). Quedaron como <strong>Pendientes</strong>,
            listos para que Admin o Manager los revisen en Aprobaciones (por si algo necesita correccion antes de
            darlos por buenos).
          </p>
          {resultado.hojasOmitidas?.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-secondary">
                {resultado.hojasOmitidas.length} hoja(s) del Excel no se importaron:
              </p>
              <ul className="flex flex-col gap-1 text-xs text-slate-600">
                {resultado.hojasOmitidas.map((h) => (
                  <li key={h.hoja}>
                    <strong>{h.hoja}</strong>: {h.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {resultado.noImportados?.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-secondary">
                {resultado.noImportados.length} material(es) no se importaron (los dejaste sin marcar):
              </p>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-xs text-slate-600">
                {resultado.noImportados.map((n) => (
                  <li key={`${n.categoria}-${n.fila}`}>
                    <strong>{etiquetaDe(n.categoria) || n.categoria}</strong>, fila {n.fila} - {n.titulo || 'Sin titulo'}: {n.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {resultado.errores.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-secondary">
                {resultado.errores.length} no se pudieron crear al guardar:
              </p>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-xs text-slate-600">
                {resultado.errores.map((e, idx) => (
                  <li key={idx}>
                    {e.categoria ? <strong>{etiquetaDe(e.categoria) || e.categoria}: </strong> : null}
                    <strong>{e.titulo || 'Sin titulo'}</strong>: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Link to="/catalogo">
              <Button>Ir al catalogo</Button>
            </Link>
            <Button variant="secondary" onClick={() => setResultado(null)}>
              Importar otro archivo
            </Button>
          </div>
        </div>
      ) : !hojas ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={handleDrop}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            arrastrando ? 'border-primary bg-primary/5' : 'border-border bg-white hover:bg-surface'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => elegirArchivo(e.target.files)}
            onClick={(e) => e.stopPropagation()}
            className="hidden"
          />
          {archivo ? (
            <div className="flex flex-col items-center gap-2 text-primary-dark">
              <FileCheck2 size={28} className="text-primary" />
              <p className="text-sm font-medium">{archivo.name}</p>
              <p className="text-xs text-slate-400">Haz clic aqui para elegir otro archivo</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <Upload size={28} />
              <p className="text-sm font-medium">Haz clic aqui o arrastra tu archivo Excel</p>
              <p className="text-xs text-slate-400">.xlsx o .xls</p>
            </div>
          )}
          <div className="mt-4" onClick={(e) => e.stopPropagation()}>
            <Button icon={Upload} onClick={handleAnalizar} disabled={!archivo || analizando}>
              {analizando ? 'Analizando...' : 'Analizar archivo'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium text-primary-dark">{totalSeleccionados} material(es) marcado(s) para importar</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setColapsadas(new Set())}>
                Abrir todas
              </Button>
              <Button variant="ghost" onClick={() => setColapsadas(new Set(hojas.map((h) => h.categoria)))}>
                Cerrar todas
              </Button>
              <Button variant="ghost" onClick={() => setHojas(null)}>
                Cancelar
              </Button>
              <Button onClick={handleConfirmar} disabled={confirmando || totalSeleccionados === 0}>
                {confirmando ? 'Importando...' : `Confirmar importacion (${totalSeleccionados})`}
              </Button>
            </div>
          </div>

          {hojasOmitidas.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              <strong>Hojas del Excel que no se importaron:</strong>
              <ul className="mt-1 list-disc pl-5">
                {hojasOmitidas.map((h) => (
                  <li key={h.hoja}>
                    <strong>{h.hoja}</strong>: {h.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Contenedor unico con su propio scroll: sin importar cuantas categorias se
              abran a la vez, la pagina en si nunca crece mas alla de la pantalla. */}
          <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          {hojas.map((hoja) => {
            const cerrada = colapsadas.has(hoja.categoria);
            return (
              <div key={hoja.categoria} className="overflow-hidden rounded-lg border border-border bg-white">
                <button
                  type="button"
                  onClick={() => toggleColapsada(hoja.categoria)}
                  className="flex w-full items-center gap-2 border-b border-border bg-surface px-4 py-2.5 text-left text-sm font-semibold text-primary-dark"
                >
                  {cerrada ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  {etiquetaDe(hoja.categoria) || hoja.nombreCategoria} ({hoja.items.length})
                </button>
                {cerrada ? null : (
                  <div className="max-h-96 overflow-y-auto overflow-x-auto">
                    {hoja.camposDesconocidos?.length > 0 ? (
                      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                        <strong>Columnas del Excel sin campo en esta categoria (no se importaron):</strong>{' '}
                        {hoja.camposDesconocidos.join(', ')}. Para capturarlas, primero hay que crear ese campo en
                        Gestion de Categorias.
                      </div>
                    ) : null}
                    <table className="w-full min-w-max text-left text-sm">
                      <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Incluir</th>
                          <th className="px-3 py-2 font-semibold">ID</th>
                          <th className="px-3 py-2 font-semibold">Titulo</th>
                          <th className="px-3 py-2 font-semibold">Autor</th>
                          <th className="px-3 py-2 font-semibold">Copias</th>
                          <th className="px-3 py-2 font-semibold">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {hoja.items.map((item) => {
                          const clave = claveItem(hoja.categoria, item.fila);
                          const estado = seleccion[clave] || { incluir: false, usarCopias: true };
                          return (
                            <tr key={clave} className={estado.incluir ? '' : 'opacity-50'}>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={estado.incluir}
                                  onChange={() => toggleIncluir(hoja.categoria, item.fila)}
                                  className="rounded border-border text-primary focus:ring-primary/30"
                                />
                              </td>
                              <td className="max-w-[10rem] truncate px-3 py-2 font-medium" title={(item.ids || []).join(', ')}>
                                {(item.ids || []).filter(Boolean).join(', ') || 'N/A'}
                              </td>
                              <td className="max-w-xs truncate px-3 py-2" title={item.titulo}>
                                {item.titulo || 'N/A'}
                              </td>
                              <td className="max-w-[10rem] truncate px-3 py-2" title={item.autor}>
                                {item.autor || 'N/A'}
                              </td>
                              <td className="px-3 py-2">
                                {item.copias > 1 ? (
                                  <label
                                    className="flex items-center gap-1.5 text-xs"
                                    title={`Filas del Excel agrupadas: ${item.filas?.join(', ')}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={estado.usarCopias}
                                      onChange={() => toggleUsarCopias(hoja.categoria, item.fila)}
                                      className="rounded border-border text-primary focus:ring-primary/30"
                                    />
                                    {/* item.copias sigue siendo el total real de registros a crear
                                        (eso no cambia) - aqui solo se resta 1 en el texto: el primer
                                        ejemplar no es "copia de si mismo", el resto son las copias. */}
                                    Crear {item.copias - 1} {item.copias === 2 ? 'copia adicional' : 'copias adicionales'}
                                  </label>
                                ) : (
                                  '1'
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {!item.valido ? (
                                  <Badge tone="danger" icon={AlertTriangle}>
                                    {item.errores.join(', ')}
                                  </Badge>
                                ) : item.camposFaltantes?.length > 0 ? (
                                  <Badge tone="danger" icon={AlertTriangle}>
                                    N/A: {item.camposFaltantes.join(', ')}
                                  </Badge>
                                ) : (
                                  <Badge tone="success">Listo</Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}
