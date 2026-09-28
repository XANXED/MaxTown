import { describe, expect, it, vi } from 'vitest';
import { createDataMosContactSource, normalizeMoscowAddress } from './data-mos.ts';

function response(rows: unknown[]): Response {
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('data.mos.ru house contact source', () => {
  it('matches one managing organisation by normalized address and deduplicates phones', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => response([
      {
        global_id: 90210,
        Cells: {
          FullName: 'Общество с ограниченной ответственностью «Наш дом»',
          ShortName: 'ООО «Наш дом»',
          PublicPhone: [
            { PublicPhone: '+7 (495) 123-45-67' },
            { PublicPhone: '+7 (495) 123-45-67' },
            { PublicPhone: '+7 (495) 765-43-21' },
          ],
          MKD: [{ Address: 'город Москва, улица Лесная, дом 12' }],
        },
      },
    ]));
    const source = createDataMosContactSource({ apiKey: 'secret', fetchImpl });

    const result = await source.importForHouse({ address: 'ул. Лесная, 12', locality: 'Москва' });

    expect(result).toEqual({
      status: 'ready',
      contacts: [
        {
          externalKey: '90210:+74951234567',
          title: 'Управляющая организация',
          description: 'ООО «Наш дом»',
          phone: '+7 (495) 123-45-67',
        },
        {
          externalKey: '90210:+74957654321',
          title: 'Управляющая организация',
          description: 'ООО «Наш дом»',
          phone: '+7 (495) 765-43-21',
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('api_key=secret');
  });

  it('does not choose between multiple organisations for the same address', async () => {
    const rows = [1, 2].map((globalId) => ({
      global_id: globalId,
      Cells: {
        FullName: `Организация ${globalId}`,
        PublicPhone: [{ PublicPhone: `+7 495 000-00-0${globalId}` }],
        MKD: [{ Address: 'г. Москва, ул. Лесная, д. 12' }],
      },
    }));
    const source = createDataMosContactSource({ apiKey: 'secret', fetchImpl: async () => response(rows) });

    await expect(source.importForHouse({ address: 'ул Лесная 12', locality: 'Москва' }))
      .resolves.toEqual({ status: 'ambiguous', contacts: [] });
  });

  it('reads subsequent pages and rejects malformed upstream payloads', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      global_id: index,
      Cells: { FullName: `Организация ${index}`, PublicPhone: [], MKD: [] },
    }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([]));
    const source = createDataMosContactSource({ apiKey: 'secret', fetchImpl });

    await expect(source.importForHouse({ address: 'ул. Лесная, 12', locality: 'Москва' }))
      .resolves.toEqual({ status: 'not-found', contacts: [] });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('%24skip=1000');

    const broken = createDataMosContactSource({ apiKey: 'secret', fetchImpl: async () => response([null]) });
    await expect(broken.importForHouse({ address: 'ул. Лесная, 12', locality: 'Москва' }))
      .rejects.toThrow('Некорректный ответ data.mos.ru');
  });

  it('aborts a stalled source request', async () => {
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const source = createDataMosContactSource({ apiKey: 'secret', fetchImpl, timeoutMs: 5 });

    await expect(source.importForHouse({ address: 'ул. Лесная, 12', locality: 'Москва' }))
      .rejects.toThrow();
  });
});

describe('normalizeMoscowAddress', () => {
  it('normalizes common Moscow address spellings without fuzzy matching', () => {
    expect(normalizeMoscowAddress('город Москва, улица Лесная, дом 12')).toBe('ул лесная 12');
    expect(normalizeMoscowAddress('г. Москва, ул. Лесная, д. 12')).toBe('ул лесная 12');
  });
});
