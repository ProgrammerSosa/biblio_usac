import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, FileCheck2, ChevronDown, ChevronRight } from 'lucide-react';
import { catalogApi } from './catalogApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useCategories } from '../../shared/hooks/useCategories';
import Button from '../../shared/components/Button';
import Badge from '../../shared/components/Badge';
import AlertBanner from '../../shared/components/AlertBanner';

function claveItem(categoria, fila) {
  return `${categoria}-${fila}`;
}

export default function ImportPage() {
  const { etiquetaDe } = useCategories();
  const inputRef = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [hojas, setHojas] = useState(null);
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
          nuevaSeleccion[claveItem(hoja.categoria, item.fila)] = { incluir: item.valido, usarCopias: true };
        });
      });
      setHojas(res.data.data.hojas);
      setSeleccion(nuevaSeleccion);
      // Todas empiezan cerradas para que la pagina no se estire con archivos grandes;
      // se abren una por una segun lo que se quiera revisar.
      setColapsadas(todasColapsadas);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo leer el archivo'));
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
    hojas.forEach((hoja) => {
      hoja.items.forEach((item) => {
        const estado = seleccion[claveItem(hoja.categoria, item.fila)];
        if (!estado?.incluir) return;
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
      setResultado(res.data.data);
      setHojas(null);
      setArchivo(null);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo completar la importacion'));
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
        Sube el archivo con las hojas Libros, Revistas, Diccionarios, Enciclopedias, Folletos o Publicacion
        institucional. Primero te muestro lo que se detecto para que revises antes de guardar nada. Las copias se
        detectan solas: si dos filas tienen el mismo autor, titulo, edicion e idioma (sin importar el estado
        fisico), se cuentan como copias del mismo material.
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
          {resultado.errores.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-secondary">
                {resultado.errores.length} no se pudieron crear:
              </p>
              <ul className="flex flex-col gap-1 text-xs text-slate-600">
                {resultado.errores.map((e, idx) => (
                  <li key={idx}>
                    <strong>{e.titulo || 'Sin titulo'}</strong> ({e.noInventario || 'sin no. inventario'}): {e.error}
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
                          <th className="px-3 py-2 font-semibold">Titulo</th>
                          <th className="px-3 py-2 font-semibold">Autor</th>
                          <th className="px-3 py-2 font-semibold">No. Inventario</th>
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
                              <td className="max-w-xs truncate px-3 py-2" title={item.titulo}>
                                {item.titulo || 'N/A'}
                              </td>
                              <td className="max-w-[10rem] truncate px-3 py-2" title={item.autor}>
                                {item.autor || 'N/A'}
                              </td>
                              <td className="px-3 py-2">{item.noInventario || 'N/A'}</td>
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
