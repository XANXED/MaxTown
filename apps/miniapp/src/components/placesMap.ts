import type { GeoPoint } from '@maxtown/shared';

// Чистые помощники карты: MapGL живёт в координатах [долгота, широта],
// у нас — { lat, lon }. Здесь же — границы, чтобы в кадр попали все метки.

export type LngLat = [number, number];

export function toLngLat(point: GeoPoint): LngLat {
  return [point.lon, point.lat];
}

/** Точка из центра карты; шесть знаков — около 10 см, точнее не нужно. */
export function fromLngLat([lon, lat]: number[]): GeoPoint {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return { lat: round(lat ?? 0), lon: round(lon ?? 0) };
}

/**
 * Прямоугольник вокруг точек или null, если точка одна или их нет: одну
 * точку показываем центром с обычным масштабом, а не максимальным приближением.
 */
export function boundsOf(points: GeoPoint[]): { southWest: LngLat; northEast: LngLat } | null {
  if (points.length < 2) return null;
  const lats = points.map(({ lat }) => lat);
  const lons = points.map(({ lon }) => lon);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  if (south === north && west === east) return null;
  return { southWest: [west, south], northEast: [east, north] };
}
