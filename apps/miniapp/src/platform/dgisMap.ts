// Адаптер карты 2ГИС (MapGL JS): загрузка скрипта и ключ. Экраны получают
// готовый API или null — тогда карта не рисуется, а списки работают как
// раньше. Ключ карты виден в коде страницы по определению; в кабинете 2ГИС его
// ограничивают по домену (docs/adr/0008).

export type MapGLApi = Awaited<ReturnType<(typeof import('@2gis/mapgl'))['load']>>;
type MapOptions = ConstructorParameters<MapGLApi['Map']>[1];

/**
 * Хосты 2ГИС, которые нужны карте, по именам прокси: /dgis/<имя>/… на нашем
 * домене пересылается на хост как есть (Caddyfile, vite.config.ts).
 */
export const DGIS_MAP_HOSTS = {
  mapgl: 'mapgl.2gis.com',
  keys: 'keys.api.2gis.com',
  styles: 'styles.api.2gis.com',
  disk: 'disk.2gis.com',
  tile0: 'tile0.maps.2gis.com',
  tile1: 'tile1.maps.2gis.com',
  tile2: 'tile2.maps.2gis.com',
  tile3: 'tile3.maps.2gis.com',
} as const;

let loading: Promise<MapGLApi | null> | null = null;
/** Скрипт MapGL загрузился через наш прокси: тогда и тайлы берём через него. */
let loadedViaProxy = false;

/** Ключ карты из сборки; незаданный или нераскрытый «$DGIS_API_KEY» — нет ключа. */
export function mapKey(): string | null {
  const key = (import.meta.env.VITE_DGIS_API_KEY as string | undefined)?.trim();
  return key && !key.startsWith('$') ? key : null;
}

/**
 * Префикс прокси карты на нашем домене («/dgis») или null — тогда MapGL ходит
 * в 2ГИС напрямую. 2ГИС не отвечает иностранным IP, поэтому в продакшне карта
 * идёт через сервер: Жилец с VPN видит её так же, как без него.
 */
export function mapProxyPrefix(): string | null {
  const prefix = (import.meta.env.VITE_DGIS_MAP_PROXY as string | undefined)?.trim().replace(/\/+$/u, '');
  return prefix?.startsWith('/') ? prefix : null;
}

/**
 * Настройки MapGL с серверами через прокси. tileServer, styleServer и
 * остальные адреса MapGL понимает, но в своих типах не описывает; статистика
 * 2ГИС (bss) через прокси не идёт и выключена.
 */
export function withMapServers(options: MapOptions, location: Pick<Location, 'host' | 'origin' | 'protocol'> = window.location): MapOptions {
  const prefix = mapProxyPrefix();
  if (!prefix || !loadedViaProxy) return options;
  const base = `${location.origin}${prefix}`;
  return Object.assign({}, options, {
    tileServer: `${location.host}${prefix}/tile{subdomain}`,
    tileProtocol: location.protocol.replace(/:$/u, ''),
    subdomains: '0123',
    styleServer: `${base}/styles`,
    fontUrl: `${base}/mapgl/api/fonts`,
    iconUrl: `${base}/disk/styles/assets/icons`,
    modelUrl: `${base}/disk/styles/assets/models`,
    sharedModelsPath: `${base}/disk/shared-models/`,
    keyUrl: `${base}/keys/public/v1/keys/{keyID}/services/mapgl-js-api`,
    disableBssStatistics: true,
  });
}

/**
 * MapGL, если карту можно показать: есть ключ, скрипт загрузился, WebGL есть.
 * Скрипт грузится один раз и только когда карта впервые понадобилась.
 * Сначала через наш прокси; если он не ответил — напрямую из 2ГИС, чтобы
 * сломанный прокси не прятал карту у тех, кто без VPN.
 */
export function loadMapGL(): Promise<MapGLApi | null> {
  if (!mapKey()) return Promise.resolve(null);
  const prefix = mapProxyPrefix();
  loading ??= import('@2gis/mapgl')
    .then(async ({ load }) => {
      if (prefix) {
        try {
          const api = await load(`${prefix}/mapgl/api/js`);
          loadedViaProxy = true;
          return api;
        } catch {
          // Прокси не ответил — ниже пробуем 2ГИС напрямую.
        }
      }
      loadedViaProxy = false;
      return load();
    })
    .then((api) => (api.isSupported() ? api : null))
    .catch(() => {
      // Не загрузилось (нет сети, 2ГИС недоступен) — попробуем при следующем открытии.
      loading = null;
      return null;
    });
  return loading;
}
