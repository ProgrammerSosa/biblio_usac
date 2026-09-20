const INTERVALO_MS = 12 * 60 * 1000; // 12 min, por debajo del limite de inactividad de Render (15 min)
const TIMEOUT_MS = 15 * 1000;

/**
 * En el plan gratuito de Render, el servicio se duerme tras 15 min sin peticiones entrantes.
 * Mientras el proceso siga vivo, se hace ping a su propia URL publica cada 10 min para que
 * nunca llegue a esos 15 min de inactividad. Solo se activa si RENDER_EXTERNAL_URL existe
 * (Render la define automaticamente) - en local o en otro proveedor no hace nada.
 */
function startKeepAlive() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) return null;

  const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
  let pingInFlight = false;

  const ping = async () => {
    if (pingInFlight) return;

    pingInFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetch(healthUrl, { signal: controller.signal });
    } catch {
      // Un ping fallido no es grave: el siguiente intento lo vuelve a hacer.
    } finally {
      clearTimeout(timeout);
      pingInFlight = false;
    }
  };

  const timer = setInterval(ping, INTERVALO_MS);
  timer.unref?.();

  console.log(`Keep-alive activo: ping a ${healthUrl} cada ${INTERVALO_MS / 60000} min`);
  return () => clearInterval(timer);
}

module.exports = { startKeepAlive };
