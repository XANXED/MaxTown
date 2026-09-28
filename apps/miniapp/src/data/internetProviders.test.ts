import { describe, expect, it, vi } from 'vitest';
import { createInternetProvidersClient, formatInternetRating, tariffFreshness } from './internetProviders.ts';

describe('internet providers client', () => {
  it('uses House-scoped provider and rating routes', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ providers: [], rating: { average: 4.5, count: 2, myScore: 5 } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const client = createInternetProvidersClient(fetcher);
    await client.load('house 1');
    await client.save('house 1', {} as never);
    await client.save('house 1', {} as never, 'provider/2');
    await client.rate('house 1', 'provider/2', 5);
    await client.remove('house 1', 'provider/2');

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/houses/house%201/internet-providers', 'GET'],
      ['/api/houses/house%201/internet-providers', 'POST'],
      ['/api/houses/house%201/internet-providers/provider%2F2', 'PUT'],
      ['/api/houses/house%201/internet-providers/provider%2F2/rating', 'PUT'],
      ['/api/houses/house%201/internet-providers/provider%2F2', 'DELETE'],
    ]);
    expect(fetcher.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({ score: 5 }));
  });

  it('formats honest rating states and tariff freshness', () => {
    expect(formatInternetRating({ average: null, count: 0, myScore: null })).toBe('Пока нет оценок');
    expect(formatInternetRating({ average: 4.25, count: 1, myScore: 4 })).toBe('4,3 · 1 оценка');
    expect(formatInternetRating({ average: 3.5, count: 12, myScore: null })).toBe('3,5 · 12 оценок');
    expect(tariffFreshness({ checkedOn: '2026-09-20' }, '2026-09-28')).toBe('current');
    expect(tariffFreshness({ checkedOn: '2026-05-01' }, '2026-09-28')).toBe('stale');
  });
});
