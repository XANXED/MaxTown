import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapProxyPrefix, withMapServers } from './dgisMap.ts';

const location = { host: 'maxtown.ru', origin: 'https://maxtown.ru', protocol: 'https:' };
const base = { key: 'map-key', center: [30.3, 59.9], zoom: 16 };

describe('карта 2ГИС через прокси', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('без префикса прокси оставляет серверы 2ГИС по умолчанию', () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', '');

    expect(mapProxyPrefix()).toBeNull();
    expect(withMapServers(base, location)).toBe(base);
  });

  it('направляет тайлы, стиль, шрифты, иконки и проверку ключа на свой домен', () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', '/dgis/');

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

  it('не принимает префикс без ведущего слэша за путь прокси', () => {
    vi.stubEnv('VITE_DGIS_MAP_PROXY', 'https://example.com');

    expect(mapProxyPrefix()).toBeNull();
  });
});
