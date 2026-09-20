require('./setupEnv');

const { startKeepAlive } = require('../helpers/keepAlive');

describe('keepAlive', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    delete process.env.RENDER_EXTERNAL_URL;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  test('no programa nada si RENDER_EXTERNAL_URL no esta definida (entorno local)', () => {
    global.fetch = jest.fn();

    startKeepAlive();
    jest.advanceTimersByTime(60 * 60 * 1000);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('hace ping a su propia URL cada 10 minutos cuando corre en Render', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://biblioteca-usac.onrender.com';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    startKeepAlive();

    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('https://biblioteca-usac.onrender.com/health');

    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('si un ping falla, no lanza excepcion ni detiene los siguientes', async () => {
    process.env.RENDER_EXTERNAL_URL = 'https://biblioteca-usac.onrender.com';
    global.fetch = jest.fn().mockRejectedValue(new Error('conexion rechazada'));

    startKeepAlive();

    jest.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
