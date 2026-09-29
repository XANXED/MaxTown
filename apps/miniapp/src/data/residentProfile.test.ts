import { afterEach, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../auth/session.ts';
import { saveResidentHouseProfile } from './residentProfile.ts';

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

it('saves the House profile through the authenticated API', async () => {
  const token = 'Q'.repeat(43);
  setSession(token);
  const response = { resident: { id: 'resident' }, memberships: [{ houseId: 'house', profileCompleted: true }] };
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const fetchMock = async (input: RequestInfo | URL, request?: RequestInit) => {
    calls.push([input, request]);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  vi.stubGlobal('fetch', fetchMock);
  const input = {
    apartmentNumber: '42А',
    phoneVisibleToNeighbors: false,
    neighborApartments: { left: '41', right: '43', below: null, above: null },
  };

  await expect(saveResidentHouseProfile('house-id', input)).resolves.toEqual(response);
  const [url, request] = calls[0]!;
  expect(url).toBe('/api/me/houses/house-id/profile');
  expect(request?.method).toBe('PUT');
  expect(new Headers(request?.headers).get('authorization')).toBe(`Bearer ${token}`);
  expect(JSON.parse(String(request?.body))).toEqual(input);
});
