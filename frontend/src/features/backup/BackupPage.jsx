import { useRef, useState } from 'react';
import { HardDrive, Download, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { backupApi } from './backupApi';
import { getErrorMessage } from '../../shared/api/axiosClient';
import Button from '../../shared/components/Button';
import AlertBanner from '../../shared/components/AlertBanner';
import Modal from '../../shared/components/Modal';

function nombreArchivoRespaldo() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `respaldo-biblioteca-${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}.xlsx`;
}

export default function BackupPage() {
  const inputRef = useRef(null);
  const [exportando, setExportando] = useState(false);
  const [archivoElegido, setArchivoElegido] = useState(null);
  const [confirmacionAbierta, setConfirmacionAbierta] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  async function handleExportar() {
    setExportando(true);
    setError('');
    try {
      const res = await backupApi.exportar();
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = nombreArchivoRespaldo();
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo generar el respaldo'));
    } finally {
      setExportando(false);
    }
  }

  function elegirArchivo(lista) {
    const nuevo = lista?.[0];
    if (!nuevo) return;
    const nombre = nuevo.name.toLowerCase();
    if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.xls')) {
      setError('El archivo debe ser un Excel (.xlsx o .xls) - el mismo que se descarga con "Guardar respaldo"');
      return;
    }
    setError('');
    setResultado(null);
    setArchivoElegido(nuevo);
    setConfirmacionAbierta(true);
  }

  function cerrarConfirmacion() {
    setConfirmacionAbierta(false);
    setArchivoElegido(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function confirmarRestaurar() {
    setRestaurando(true);
    setError('');
    try {
      const res = await backupApi.restaurar(archivoElegido);
      setResultado(res.data.data);
      cerrarConfirmacion();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo restaurar el respaldo'));
    } finally {
      setRestaurando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <HardDrive size={17} />
        </div>
        <h1 className="text-xl font-semibold text-primary-dark">Respaldo</h1>
      </div>

      <AlertBanner>{error}</AlertBanner>

      {resultado ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={18} />
            <h2 className="text-sm font-semibold">Respaldo restaurado</h2>
          </div>
          <p className="text-sm text-slate-600">
            Categorias: <strong>{resultado.categoriasCreadas}</strong> nuevas, <strong>{resultado.categoriasActualizadas}</strong>{' '}
            actualizadas.
            <br />
            Catalogo: <strong>{resultado.catalogoCreados}</strong> nuevos, <strong>{resultado.catalogoActualizados}</strong>{' '}
            actualizados.
          </p>
          {resultado.errores?.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-sm font-medium text-secondary">{resultado.errores.length} con error:</p>
              <ul className="flex flex-col gap-1 text-xs text-slate-600">
                {resultado.errores.map((e, idx) => (
                  <li key={idx}>
                    <strong>{e.titulo}</strong>: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-primary-dark">Guardar respaldo</h2>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          Descarga un Excel con todo el catalogo y las categorias tal como estan ahora mismo. Guardalo en un lugar
          seguro (USB, Drive, correo, etc.) - no se guarda ninguna copia en el servidor ni en la base de datos, asi
          que si lo pierdes no hay forma de recuperarlo desde aqui. Nadie lo genera por ti ni en automatico: hazlo
          cuando quieras tener un punto al que volver.
        </p>
        <Button icon={Download} onClick={handleExportar} disabled={exportando}>
          {exportando ? 'Generando...' : 'Guardar respaldo (Excel)'}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-primary-dark">Restaurar respaldo</h2>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          Sube un Excel generado con "Guardar respaldo" para traer de vuelta ese catalogo y esas categorias. Un
          registro que ya exista se actualiza con los datos del archivo; uno que ya no exista se vuelve a crear tal
          como estaba, con su mismo ID. Usalo solo si algo se perdio o se dañó - no hace falta para el uso diario.
        </p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(e) => elegirArchivo(e.target.files)} className="hidden" />
        <Button variant="secondary" icon={Upload} onClick={() => inputRef.current?.click()}>
          Elegir archivo de respaldo...
        </Button>
      </div>

      <Modal open={confirmacionAbierta} title="Restaurar respaldo" onClose={cerrarConfirmacion} footer={
        <>
          <Button variant="secondary" onClick={cerrarConfirmacion}>
            Cancelar
          </Button>
          <Button variant="danger" icon={AlertTriangle} onClick={confirmarRestaurar} disabled={restaurando}>
            {restaurando ? 'Restaurando...' : 'Si, restaurar'}
          </Button>
        </>
      }>
        <p className="text-sm text-slate-600">
          Vas a restaurar <strong>{archivoElegido?.name}</strong>. Esto va a <strong>sobrescribir</strong> los
          registros existentes que coincidan con los del archivo, y va a volver a crear los que ya no existan. Esta
          accion no se puede deshacer. ¿Confirmas?
        </p>
      </Modal>
    </div>
  );
}
