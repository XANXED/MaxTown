import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HouseRepair, HouseRepairStatus } from '@maxtown/shared';
import { canManageHouseRepairs, createHouseRepair, houseRepairStatusLabel, loadHouseRepairHistory, loadHouseRepairs, splitHouseRepairs, updateHouseRepair } from './repairMode.ts';

const houseId = '11111111-1111-4111-8111-111111111111';
const repairId = '22222222-2222-4222-8222-222222222222';

afterEach(() => vi.unstubAllGlobals());

describe('house repair data API', () => {
  it('separates the active list from completed and cancelled archive records', () => {
    const items = (['planned', 'in_progress', 'paused', 'completed', 'cancelled'] as HouseRepairStatus[]).map((status, index): HouseRepair => ({
      id: String(index), houseId, title: 'Работы', description: 'Описание', location: null, status,
      startsAt: null, expectedCompletionAt: null, contractorName: null, contractorContact: null,
      residentImpact: null, instructions: null, createdAt: '', updatedAt: '',
    }));
    const { current, archive } = splitHouseRepairs(items);
    expect(current.map(({ status }) => status)).toEqual(['planned', 'in_progress', 'paused']);
    expect(archive.map(({ status }) => status)).toEqual(['completed', 'cancelled']);
    expect(houseRepairStatusLabel('paused')).toBe('Приостановлена');
  });

  it('grants Mini App repair controls only to the Headman and Responsible', () => {
    expect(canManageHouseRepairs('headman')).toBe(true);
    expect(canManageHouseRepairs('responsible')).toBe(true);
    expect(canManageHouseRepairs('resident')).toBe(false);
    expect(canManageHouseRepairs('concierge')).toBe(false);
    expect(canManageHouseRepairs(null)).toBe(false);
  });

  it('loads a house repair collection from the house-scoped endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ repairs: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadHouseRepairs(houseId)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/houses/${houseId}/repairs`, expect.any(Object));
  });

  it('creates, updates, and loads history using the repair identity', async () => {
    const repair = { id: repairId, houseId, title: 'Лифт', status: 'planned' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ repair }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ repair: { ...repair, status: 'in_progress' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ history: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHouseRepair(houseId, { title: 'Лифт', description: 'Ремонт', status: 'planned' });
    await updateHouseRepair(houseId, repairId, { status: 'in_progress' });
    await loadHouseRepairHistory(houseId, repairId);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/houses/${houseId}/repairs`,
      `/api/houses/${houseId}/repairs/${repairId}`,
      `/api/houses/${houseId}/repairs/${repairId}/history`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ title: 'Лифт', status: 'planned' });
  });

  it('surfaces a Russian connection error when the list request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(loadHouseRepairs(houseId)).rejects.toThrow('Не удалось загрузить ремонтные работы');
  });
});
