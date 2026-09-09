import { ESTADOS_REVISION } from '../../shared/constants';
import { useCategories } from '../../shared/hooks/useCategories';

function DetalleCampo({ label, valor, destacado }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={destacado ? 'text-sm text-secondary' : 'text-sm text-slate-700'}>{valor || 'N/A'}</p>
    </div>
  );
}

export default function CatalogDetailFields({ item, ocultarRevision = false }) {
  const { camposDe } = useCategories();
  const camposCategoria = camposDe(item.categoria);

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
      <DetalleCampo label="Idioma" valor={item.idioma} />
      <DetalleCampo label="Edicion" valor={item.edicion} />
      <DetalleCampo label="Lugar" valor={item.lugar} />
      <DetalleCampo label="Paginas impresas" valor={item.paginasImpresas} />
      {camposCategoria.map((campo) => (
        <DetalleCampo key={campo.clave} label={campo.etiqueta} valor={item.atributos?.[campo.clave]} />
      ))}
      {!ocultarRevision ? (
        <>
          <DetalleCampo label="Revisado por" valor={item.revisadoPorAdmin?.nombre} />
          {item.estadoRevision === ESTADOS_REVISION.RECHAZADO ? (
            <div className="col-span-full">
              <DetalleCampo label="Motivo de rechazo" valor={item.observaciones} destacado />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
