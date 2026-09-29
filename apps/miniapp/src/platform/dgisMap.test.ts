import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Загрузчик MapGL подменяем: в тесте нет браузера, а важно, какой адрес
// скрипта он получил и что было, когда прокси не ответил.
const load = vi.fn();
vi.mock('@2gis/mapgl', () => ({ load }));

const location = { host: 'maxtown.ru', origin: 'https://maxtown.ru', protocol: 'https:' };
const base = { key: 'map-key', center: [30.3, 59.9], zoom: 16 };
const api = { isSupported: () => true };

async function freshModule() {
  vi.resetModules();
  return import('./dgisMap.ts');
}

describe('карта 2ГИС через прокси', () => {
  beforeEach(() => {
    load.mockReset();
    vi.stubEnv('VITE_DGIS_API_KEY', 'map-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('без префикса прокси грузит MapGL напрямую и не трогает серверы', async () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', '');
    load.mockResolvedValue(api);
    const { loadMapGL, mapProxyPrefix, withMapServers } = await freshModule();

    expect(mapProxyPrefix()).toBeNull();
    await expect(loadMapGL()).resolves.toBe(api);
    expect(load).toHaveBeenCalledWith();
    expect(withMapServers(base, location)).toBe(base);
  });

  it('через прокси направляет тайлы, стиль, шрифты, иконки и проверку ключа на свой домен', async () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', '/dgis/');
    load.mockResolvedValue(api);
    const { loadMapGL, withMapServers } = await freshModule();

    await expect(loadMapGL()).resolves.toBe(api);
    expect(load).toHaveBeenCalledWith('/dgis/mapgl/api/js');
    expect(withMapServers(base, location)).toEqual({
      ...base,
      tileServer: 'maxtown.ru/dgis/tile{subdomain}',
      tileProtocol: 'https',
      subdomains: '0123',
      styleServer: 'https://maxtown.ru/dgis/styles',
      fontUrl: 'https://maxtown.ru/dgis/mapgl/api/fonts',
      iconUrl: 'https://maxtown.ru/dgis/disk/styles/assets/icons',
      modelUrl: 'https://maxtown.ru/dgis/disk/styles/assets/models',
      sharedModelsPath: 'https://maxtown.ru/dgis/disk/shared-models/',
      keyUrl: 'https://maxtown.ru/dgis/keys/public/v1/keys/{keyID}/services/mapgl-js-api',
      disableBssStatistics: true,
    });
  });

  it('если прокси не ответил, берёт MapGL напрямую и тайлы тоже из 2ГИС', async () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', '/dgis');
    load.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(api);
    const { loadMapGL, withMapServers } = await freshModule();

    await expect(loadMapGL()).resolves.toBe(api);
    expect(load.mock.calls).toEqual([['/dgis/mapgl/api/js'], []]);
    expect(withMapServers(base, location)).toBe(base);
  });

  it('без ключа карты не грузит ничего', async () => {
    vi.stubEnv('VITE_DGIS_API_KEY', '');
    const { loadMapGL } = await freshModule();

    await expect(loadMapGL()).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('не принимает префикс без ведущего слэша за путь прокси', async () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', 'https://example.com');
    const { mapProxyPrefix } = await freshModule();

    expect(mapProxyPrefix()).toBeNull();
  });
});
