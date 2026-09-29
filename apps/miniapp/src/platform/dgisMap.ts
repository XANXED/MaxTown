// Адаптер карты 2ГИС (MapGL JS): загрузка скрипта и ключ. Экраны получают
// готовый API или null — тогда карта не рисуется, а списки работают как
// раньше. Ключ карты виден в коде страницы по определению; в кабинете 2ГИС его
// ограничивают по домену (docs/adr/0008).

export type MapGLApi = Awaited<ReturnType<(typeof import('@2gis/mapgl'))['load']>>;

let loading: Promise<MapGLApi | null> | null = null;

/** Ключ карты из сборки; незаданный или нераскрытый «$DGIS_API_KEY» — нет ключа. */
export function mapKey(): string | null {
  const key = (import.meta.env.VITE_DGIS_API_KEY as string | undefined)?.trim();
  return key && !key.startsWith('$') ? key : null;
}

/**
 * MapGL, если карту можно показать: есть ключ, скрипт загрузился, WebGL есть.
 * Скрипт грузится один раз и только когда карта впервые понадобилась.
 */
export function loadMapGL(): Promise<MapGLApi | null> {
  if (!mapKey()) return Promise.resolve(null);
  loading ??= import('@2gis/mapgl')
    .then(({ load }) => load())
    .then((api) => (api.isSupported() ? api : null))
    .catch(() => {
      // Не загрузилось (нет сети, 2ГИС недоступен) — попробуем при следующем открытии.
      loading = null;
      return null;
    });
  return loading;
}
