import { describe, expect, it } from 'vitest';
import { boundsOf, fromLngLat, toLngLat } from './placesMap.ts';

describe('places map helpers', () => {
  it('converts between our points and MapGL [lon, lat]', () => {
    expect(toLngLat({ lat: 60.013259, lon: 30.257439 })).toEqual([30.257439, 60.013259]);
    expect(fromLngLat([30.2574391234, 60.0132594321])).toEqual({ lat: 60.013259, lon: 30.257439 });
  });

  it('frames all points, but centres a single point instead of zooming into it', () => {
    expect(boundsOf([{ lat: 60.01, lon: 30.25 }, { lat: 60.03, lon: 30.21 }, { lat: 60.02, lon: 30.3 }])).toEqual({
      southWest: [30.21, 60.01],
      northEast: [30.3, 60.03],
    });
    expect(boundsOf([{ lat: 60.01, lon: 30.25 }])).toBeNull();
    expect(boundsOf([{ lat: 60.01, lon: 30.25 }, { lat: 60.01, lon: 30.25 }])).toBeNull();
    expect(boundsOf([])).toBeNull();
  });
});
