const INTERVALO_MS = 10 * 60 * 1000; // 10 min, por debajo del limite de inactividad de Render (15 min)

/**
 * En el plan gratuito de Render, el servicio se duerme tras 15 min sin peticiones entrantes.
 * Mientras el proceso siga vivo, se hace ping a su propia URL publica cada 10 min para que
 * nunca llegue a esos 15 min de inactividad. Solo se activa si RENDER_EXTERNAL_URL existe
 * (Render la define automaticamente) - en local o en otro proveedor no hace nada.
 */
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;

  setInterval(() => {
    fetch(`${url}/health`).catch(() => {
      // Un ping fallido no es grave: el siguiente intento lo vuelve a hacer.
    });
  }, INTERVALO_MS);

  console.log(`Keep-alive activo: ping a ${url}/health cada ${INTERVALO_MS / 60000} min`);
}

module.exports = { startKeepAlive };
