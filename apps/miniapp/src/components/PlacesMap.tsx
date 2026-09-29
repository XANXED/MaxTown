import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { House } from '@phosphor-icons/react';
import type { GeoPoint } from '@maxtown/shared';
import { loadMapGL, mapKey, withMapServers, type MapGLApi } from '../platform/dgisMap.ts';
import { boundsOf, fromLngLat, toLngLat } from './placesMap.ts';
import type { IconComponent, TileColor } from './ui.tsx';

// Карта 2ГИС для Мест рядом: Дом и метки мест. Метки — HtmlMarker с нашими
// плитками (React-портал в элемент метки), поэтому цвета берутся из токенов,
// а не зашиваются в картинки. Атрибуцию 2ГИС карта рисует сама — не скрываем.

export type MapMarker = {
  id: string;
  point: GeoPoint;
  label: string;
  icon: IconComponent;
  tone: 'neutral' | TileColor;
};

type PlacesMapProps = {
  /** Подпись карты для чтения с экрана. */
  label: string;
  house?: GeoPoint | null;
  markers: MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Режим выбора точки: прицел в центре, центр карты сообщается после каждого сдвига. */
  onCenterChange?: (point: GeoPoint) => void;
  /** Где начать, если нет Дома и меток — например, уже сохранённая точка. */
  initialCenter?: GeoPoint | null;
};

type MapInstance = InstanceType<MapGLApi['Map']>;
type HtmlMarkerInstance = InstanceType<MapGLApi['HtmlMarker']>;

const DEFAULT_ZOOM = 16;
/** Отступ кадра от краёв карты в пикселях, чтобы метки не прилипали к рамке. */
const FIT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/** Карта или ничего: без ключа, WebGL или сети списки работают сами по себе. */
export function PlacesMap({ label, house, markers, selectedId, onSelect, onCenterChange, initialCenter }: PlacesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<MapGLApi | null>(null);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [unavailable, setUnavailable] = useState(() => mapKey() === null);
  const [elements, setElements] = useState<Array<{ id: string; element: HTMLElement }>>([]);
  const centerChange = useRef(onCenterChange);
  centerChange.current = onCenterChange;

  // При выборе точки начинаем с уже отмеченной, иначе — с Дома.
  const start = (onCenterChange ? (initialCenter ?? house) : (house ?? initialCenter)) ?? markers[0]?.point ?? null;

  useEffect(() => {
    let cancelled = false;
    void loadMapGL().then((loaded) => {
      if (cancelled) return;
      if (loaded) setApi(loaded);
      else setUnavailable(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Карта создаётся один раз, когда есть API, контейнер и точка старта.
  const hasStart = start !== null;
  useEffect(() => {
    if (!api || !containerRef.current || !start) return;
    const instance = new api.Map(containerRef.current, withMapServers({
      key: mapKey() ?? undefined,
      center: toLngLat(start),
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      lang: 'ru',
    }));
    const reportCenter = () => centerChange.current?.(fromLngLat(instance.getCenter()));
    instance.on('moveend', reportCenter);
    reportCenter();
    setMap(instance);
    return () => {
      setMap(null);
      instance.destroy();
    };
    // start нужен только при создании; дальше карту двигают Жилец и fitBounds.
  }, [api, hasStart]);

  // Метки пересоздаются при смене набора; выделение меняет только портал.
  const markerKey = markers.map(({ id, point }) => `${id}:${point.lat},${point.lon}`).join('|') + `|house:${house?.lat},${house?.lon}`;
  useEffect(() => {
    if (!api || !map) return;
    const created: HtmlMarkerInstance[] = [];
    const nextElements: Array<{ id: string; element: HTMLElement }> = [];
    const place = (id: string, point: GeoPoint, zIndex: number) => {
      const element = document.createElement('div');
      element.className = 'map-marker-anchor';
      created.push(new api.HtmlMarker(map, { coordinates: toLngLat(point), html: element, zIndex }));
      nextElements.push({ id, element });
    };
    if (house) place('__house', house, 2);
    for (const marker of markers) place(marker.id, marker.point, 1);
    setElements(nextElements);

    // В режиме выбора точки кадр не трогаем: Администратор Дома двигает карту сам.
    if (!onCenterChange) {
      const points = [...(house ? [house] : []), ...markers.map(({ point }) => point)];
      const bounds = boundsOf(points);
      if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING });
      else if (points[0]) map.setCenter(toLngLat(points[0]));
    }
    return () => {
      for (const marker of created) marker.destroy();
      setElements([]);
    };
  }, [api, map, markerKey]);

  // Нет ключа, WebGL или точки, от которой начать, — карты нет, списки остаются.
  if (unavailable || !start) return null;

  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  return (
    <div className="places-map" role="region" aria-label={label}>
      <div className="places-map__canvas" ref={containerRef} />
      {onCenterChange ? <span className="places-map__crosshair" aria-hidden /> : null}
      {elements.map(({ id, element }) => {
        if (id === '__house') {
          return createPortal(
            <span className="map-marker map-marker--house" role="img" aria-label="Ваш Дом">
              <House className="icon icon--small" weight="fill" aria-hidden />
            </span>,
            element,
            id,
          );
        }
        const marker = byId.get(id);
        if (!marker) return null;
        const Icon = marker.icon;
        const selected = selectedId === id;
        return createPortal(
          <button
            className={`map-marker icon-tile icon-tile--${marker.tone}${selected ? ' map-marker--selected' : ''}`}
            type="button"
            aria-label={marker.label}
            aria-pressed={selected}
            onClick={() => onSelect?.(id)}
          >
            <Icon className="icon icon--small" weight="fill" aria-hidden />
          </button>,
          element,
          id,
        );
      })}
    </div>
  );
}
