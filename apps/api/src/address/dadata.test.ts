import { describe, expect, it, vi } from 'vitest';
import {
  findHouseAddress,
  resolveHouseAddressFromTitle,
  suggestHouseAddresses,
  titleMatchesAddress,
} from './dadata.ts';

/** Дом, которого нет в ГАР: DaData отдаёт улицу с номером дома. */
function streetHouse(value: string, qcGeo: string) {
  return {
    value,
    data: {
      fias_level: '7',
      street_fias_id: 'street-guid',
      house_fias_id: null,
      house_type: 'д',
      house: '14',
      qc_geo: qcGeo,
      geo_lat: '59.9564542',
      geo_lon: '30.3086435',
      region_with_type: 'г Санкт-Петербург',
      city_with_type: 'г Санкт-Петербург',
    },
  };
}

function house(value: string, guid: string) {
  return {
    value,
    unrestricted_value: `${value}, Россия`,
    data: {
      fias_level: '8',
      house_fias_id: guid,
      region_with_type: 'г Москва',
      city_with_type: 'г Москва',
    },
  };
}

describe('адрес Дома через DaData', () => {
  it('принимает единственный точный дом из названия чата', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [house('г Москва, ул Лесная, д 12', 'guid-12')] }),
    );

    await expect(resolveHouseAddressFromTitle('key', 'Москва, Лесная 12', fetcher)).resolves.toEqual({
      value: 'г Москва, ул Лесная, д 12',
      locality: 'г Москва',
      addressId: 'guid-12',
      garHouseGuid: 'guid-12',
      point: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Token key' }),
        body: JSON.stringify({ query: 'Москва, Лесная 12', count: 10 }),
      }),
    );
  });

  it('не угадывает адрес при нескольких домах', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [house('ул Лесная, д 12', 'guid-12'), house('ул Лесная, д 14', 'guid-14')] }),
    );

    await expect(resolveHouseAddressFromTitle('key', 'Москва, Лесная', fetcher)).resolves.toBeNull();
  });

  it('выбирает один точный дом среди соседних подсказок', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        suggestions: [
          house('г Москва, ул Лесная, д 12', 'guid-12'),
          house('г Москва, ул Лесная, д 12А', 'guid-12a'),
          house('г Москва, ул Лесная, д 14', 'guid-14'),
        ],
      }),
    );

    await expect(resolveHouseAddressFromTitle('key', 'Москва, Лесная, 12', fetcher)).resolves.toEqual(
      expect.objectContaining({ garHouseGuid: 'guid-12' }),
    );
  });

  it('не принимает единственную подсказку из другого города за точный адрес', () => {
    expect(
      titleMatchesAddress('Самарская обл, г Тольятти, ул Победы, д 31', {
        value: 'Алтайский край, г Яровое, Б кв-л, д 31',
        locality: 'Алтайский край, г Яровое',
        addressId: 'wrong-guid',
      }),
    ).toBe(false);
  });

  it('узнаёт корпус, написанный слитно: «14к1» и «14 к1»', () => {
    const address = { value: 'г Санкт-Петербург, Комендантский пр-кт, д 14 к 1', locality: 'г Санкт-Петербург', addressId: 'gar-14-1' };
    expect(titleMatchesAddress('Санкт-Петербург, Комендантский проспект, 14к1', address)).toBe(true);
    expect(titleMatchesAddress('Санкт-Петербург, Комендантский 14 к1', address)).toBe(true);
    expect(titleMatchesAddress('Санкт-Петербург, Комендантский 14', address)).toBe(false);
  });

  it('не предлагает улицы без конкретного дома', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        suggestions: [
          { value: 'г Москва, ул Лесная', data: { fias_level: '7', street_fias_id: 'street-guid' } },
        ],
      }),
    );

    await expect(suggestHouseAddresses('key', 'Лесная', fetcher)).resolves.toEqual([]);
  });

  it('принимает адрес квартиры и возвращает GUID её Дома', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        suggestions: [
          {
            value: 'г Москва, ул Лесная, д 12, кв 42',
            data: {
              fias_level: '9',
              house_fias_id: 'guid-12',
              flat_fias_id: 'flat-42',
              region_with_type: 'г Москва',
              city_with_type: 'г Москва',
            },
          },
        ],
      }),
    );

    await expect(suggestHouseAddresses('key', 'Москва, Лесная 12 квартира 42', fetcher)).resolves.toEqual([
      expect.objectContaining({
        value: 'г Москва, ул Лесная, д 12, кв 42',
        garHouseGuid: 'guid-12',
      }),
    ]);
  });

  it('берёт точку Дома из geo_lat и geo_lon', async () => {
    const withPoint = house('г Москва, ул Лесная, д 12', 'guid-12');
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [{ ...withPoint, data: { ...withPoint.data, geo_lat: '55.7887', geo_lon: '37.5836' } }] }),
    );

    await expect(findHouseAddress('key', 'guid-12', fetcher)).resolves.toEqual(
      expect.objectContaining({ point: { lat: 55.7887, lon: 37.5836 } }),
    );
  });

  it('перепроверяет выбранный GUID через findById', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [house('г Москва, ул Лесная, д 12', 'guid-12')] }),
    );

    await expect(findHouseAddress('key', 'guid-12', fetcher)).resolves.toEqual(
      expect.objectContaining({ garHouseGuid: 'guid-12' }),
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/findById/address');
  });

  it('принимает дом без ГАР, если DaData знает его точные координаты', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [streetHouse('г Санкт-Петербург, ул Саблинская, д 14', '0')] }),
    );

    await expect(suggestHouseAddresses('key', 'Саблинская ул, 14', fetcher)).resolves.toEqual([{
      value: 'г Санкт-Петербург, ул Саблинская, д 14',
      locality: 'г Санкт-Петербург',
      addressId: 'street:street-guid:д 14',
      garHouseGuid: null,
      point: { lat: 59.9564542, lon: 30.3086435 },
    }]);
  });

  it('не принимает номер дома, для которого DaData знает только улицу', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [streetHouse('г Санкт-Петербург, ул Саблинская, д 999', '2')] }),
    );

    await expect(suggestHouseAddresses('key', 'Саблинская ул, 999', fetcher)).resolves.toEqual([]);
  });

  it('перепроверяет дом без ГАР по номеру в пределах улицы', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ suggestions: [streetHouse('г Санкт-Петербург, ул Саблинская, д 14', '0')] }),
    );

    await expect(findHouseAddress('key', 'street:street-guid:д 14', fetcher)).resolves.toEqual(
      expect.objectContaining({ addressId: 'street:street-guid:д 14', garHouseGuid: null }),
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/suggest/address');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      query: 'д 14',
      count: 10,
      locations: [{ street_fias_id: 'street-guid' }],
    });
  });
});
