import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X, Search, Tags, CircleDot, CalendarDays, UserRound, RotateCcw } from 'lucide-react';
import { CAMPOS_BUSQUEDA, OPCIONES_ESTADO_FILTRO, OPCIONES_ORDEN_CATALOGO } from '../../shared/constants';
import Button from '../../shared/components/Button';
import { Select } from '../../shared/components/FormField';

function alternar(lista, clave) {
  return lista.includes(clave) ? lista.filter((c) => c !== clave) : [...lista, clave];
}

// Casilla con forma de "pastilla": toda la pastilla se puede pulsar y, marcada, se pinta con el
// color de la institucion. El input real sigue ahi (teclado y lectores de pantalla funcionan igual).
function Casilla({ marcada, onChange, deshabilitada = false, compacta = false, title, className = '', children }) {
  const estado = marcada ? 'border-primary/60 bg-primary/5 text-primary-dark' : 'border-border bg-white text-slate-600';
  const interaccion = deshabilitada ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-primary/40 hover:bg-primary/5';
  return (
    <label
      title={title}
      className={`flex items-start gap-2.5 rounded-lg border px-3 ${compacta ? 'py-1.5' : 'py-2'} text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 ${estado} ${interaccion} ${className}`}
    >
      <input type="checkbox" checked={marcada} onChange={onChange} disabled={deshabilitada} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Seccion({ icono: Icono, titulo, accion, nota, children }) {
  return (
    <section className="flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Icono size={14} className="text-primary" />
          {titulo}
        </h3>
        {accion}
      </div>
      {children}
      {nota ? <p className="text-xs leading-relaxed text-slate-500">{nota}</p> : null}
    </section>
  );
}

function AccionTexto({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-medium text-primary hover:underline">
      {children}
    </button>
  );
}

/**
 * Boton "Filtros" con su panel flotante: ahi se marca, con casillas, en que campos buscar, de que
 * categorias y estados mostrar, etc. Todo se aplica al instante (el listado de atras se actualiza
 * mientras se marca) y el PDF usa exactamente lo mismo. Se cierra con Esc, con un clic afuera o
 * con el boton de abajo.
 */
export default function FiltrosCatalogo({
  filtros,
  onCambiar,
  onLimpiar,
  categorias,
  aniosRegistro,
  mostrarSoloMios,
  cantidadActiva,
  total,
  cargando,
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    function alPulsarFuera(evento) {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target)) setAbierto(false);
    }
    function alPulsarTecla(evento) {
      if (evento.key === 'Escape') setAbierto(false);
    }
    document.addEventListener('mousedown', alPulsarFuera);
    document.addEventListener('keydown', alPulsarTecla);
    return () => {
      document.removeEventListener('mousedown', alPulsarFuera);
      document.removeEventListener('keydown', alPulsarTecla);
    };
  }, [abierto]);

  const idMarcado = filtros.campos.includes('id');
  const todasMarcadas = categorias.length > 0 && filtros.categorias.length === categorias.length;

  function alternarCampo(clave) {
    const campos = alternar(filtros.campos, clave);
    if (campos.length === 0) return; // Siempre tiene que quedar al menos un campo donde buscar.
    onCambiar({ campos, ...(clave === 'id' && !campos.includes('id') ? { idExacto: false } : {}) });
  }

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors ${
          abierto || cantidadActiva > 0 ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <SlidersHorizontal size={16} />
        Filtros
        {cantidadActiva > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">
            {cantidadActiva}
          </span>
        ) : null}
      </button>

      {abierto ? (
        <div
          role="dialog"
          aria-label="Filtros del catalogo"
          className="panel-flotante fixed inset-x-4 top-28 z-30 overflow-hidden rounded-xl border border-border bg-white shadow-2xl shadow-slate-900/20 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[34rem]"
        >
          <header className="flex items-start justify-between gap-4 bg-primary-dark px-5 py-4 text-white">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10">
                <SlidersHorizontal size={16} />
              </span>
              <div>
                <p className="text-sm font-semibold">¿Como quieres filtrar?</p>
                <p className="text-xs text-slate-300">Marca lo que necesites. El listado y el PDF usan lo mismo.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar filtros"
              className="rounded-md p-1 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </header>

          <div className="max-h-[min(30rem,60vh)] divide-y divide-border overflow-y-auto px-5 py-4">
            <Seccion
              icono={Search}
              titulo="Buscar en"
              nota={
                idMarcado
                  ? 'Con ID marcado puedes buscar un sello o tipo completo: escribe SDE y salen todas las enciclopedias del sello Derecho.'
                  : 'Marca en que campos se busca lo que escribas en la barra.'
              }
            >
              <div className="grid grid-cols-3 gap-2">
                {CAMPOS_BUSQUEDA.map((campo) => {
                  const marcada = filtros.campos.includes(campo.clave);
                  const ultima = marcada && filtros.campos.length === 1;
                  return (
                    <Casilla
                      key={campo.clave}
                      marcada={marcada}
                      deshabilitada={ultima}
                      title={ultima ? 'Tiene que quedar al menos un campo marcado' : undefined}
                      onChange={() => alternarCampo(campo.clave)}
                    >
                      <span className="block font-medium">{campo.label}</span>
                      <span className="block text-[11px] text-slate-500">{campo.ayuda}</span>
                    </Casilla>
                  );
                })}
              </div>
              {idMarcado ? (
                <Casilla marcada={filtros.idExacto} onChange={() => onCambiar({ idExacto: !filtros.idExacto })}>
                  <span className="block font-medium">Solo el ID exacto</span>
                  <span className="block text-[11px] text-slate-500">Sin copias: 20F no trae 20F-C1</span>
                </Casilla>
              ) : null}
            </Seccion>

            <Seccion
              icono={Tags}
              titulo="Categoria"
              accion={
                <AccionTexto onClick={() => onCambiar({ categorias: todasMarcadas ? [] : categorias.map((cat) => cat.clave) })}>
                  {todasMarcadas ? 'Quitar todas' : 'Marcar todas'}
                </AccionTexto>
              }
              nota="Si no marcas ninguna, se muestran todas las categorias."
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {categorias.map((cat) => (
                  <Casilla
                    key={cat.clave}
                    compacta
                    marcada={filtros.categorias.includes(cat.clave)}
                    onChange={() => onCambiar({ categorias: alternar(filtros.categorias, cat.clave) })}
                  >
                    {cat.nombre}
                  </Casilla>
                ))}
              </div>
            </Seccion>

            <Seccion icono={CircleDot} titulo="Estado">
              <div className="flex flex-wrap gap-2">
                {OPCIONES_ESTADO_FILTRO.map((estado) => (
                  <Casilla
                    key={estado.clave}
                    compacta
                    marcada={filtros.estados.includes(estado.clave)}
                    onChange={() => onCambiar({ estados: alternar(filtros.estados, estado.clave) })}
                  >
                    {estado.label}
                  </Casilla>
                ))}
              </div>
            </Seccion>

            <Seccion icono={CalendarDays} titulo="Año y orden">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Año de registro" value={filtros.anioRegistro} onChange={(e) => onCambiar({ anioRegistro: e.target.value })}>
                  <option value="">Todos los años</option>
                  {aniosRegistro.map((anio) => (
                    <option key={anio} value={anio}>
                      {anio}
                    </option>
                  ))}
                </Select>
                <Select label="Ordenar por" value={filtros.sort} onChange={(e) => onCambiar({ sort: e.target.value })}>
                  {OPCIONES_ORDEN_CATALOGO.map((opcion) => (
                    <option key={opcion.value} value={opcion.value}>
                      {opcion.label}
                    </option>
                  ))}
                </Select>
              </div>
            </Seccion>

            {mostrarSoloMios ? (
              <Seccion icono={UserRound} titulo="Registros">
                <Casilla marcada={filtros.soloMios} onChange={() => onCambiar({ soloMios: !filtros.soloMios })}>
                  <span className="block font-medium">Solo mis registros</span>
                  <span className="block text-[11px] text-slate-500">Los que tu registraste</span>
                </Casilla>
              </Seccion>
            ) : null}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border bg-slate-50 px-5 py-3">
            <Button variant="ghost" icon={RotateCcw} onClick={onLimpiar} disabled={cantidadActiva === 0}>
              Limpiar todo
            </Button>
            <Button onClick={() => setAbierto(false)}>
              {cargando || total === null ? 'Listo' : `Ver ${total} ${total === 1 ? 'resultado' : 'resultados'}`}
            </Button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
