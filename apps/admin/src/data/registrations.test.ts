import { describe, expect, it } from 'vitest';
import type { HouseRegistration } from '@maxtown/shared';
import {
  approve,
  countByStatus,
  registrationChecks,
  reject,
  rejectionError,
  visibleRegistrations,
} from './registrations.ts';

function registration(id: string, overrides: Partial<HouseRegistration> = {}): HouseRegistration {
  return {
    id,
    address: 'ул. Лесная, 12',
    locality: 'Казань',
    garHouseGuid: `guid-${id}`,
    headman: { name: 'Марина Ковалёва', phone: '+7 917 000-00-00', apartment: '12' },
    submittedAt: '2026-09-24T10:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

const now = new Date('2026-09-25T12:00:00Z');

describe('registrationChecks', () => {
  it('passes a registration found in the address registry with a confirmed phone', () => {
    const checks = registrationChecks(registration('a'), [registration('a')]);
    expect(checks.map(({ state }) => state)).toEqual(['ok', 'ok', 'ok']);
  });

  it('asks for a manual check when the house is missing from the registry', () => {
    const checks = registrationChecks(registration('a', { garHouseGuid: undefined }), []);
    expect(checks[0]).toMatchObject({ state: 'warning' });
    // Без GUID повтор не проверить — не выдаём это за «норму».
    expect(checks[1]).toMatchObject({ state: 'warning', label: 'Повтор не проверить' });
  });

  it('flags a house that is already registered', () => {
    const approved = registration('b', { garHouseGuid: 'same', status: 'approved' });
    const checks = registrationChecks(registration('a', { garHouseGuid: 'same' }), [approved]);
    expect(checks[1]).toMatchObject({ state: 'problem', label: 'Этот Дом уже работает в MaxTown' });
  });

  it('notices a second pending registration of the same house', () => {
    const other = registration('b', { garHouseGuid: 'same' });
    const checks = registrationChecks(registration('a', { garHouseGuid: 'same' }), [other]);
    expect(checks[1]).toMatchObject({ state: 'warning' });
  });

  it('warns when the headman did not confirm a phone', () => {
    const checks = registrationChecks(registration('a', { headman: { name: 'А', apartment: '1' } }), []);
    expect(checks[2]).toMatchObject({ state: 'warning' });
  });
});

describe('decisions', () => {
  it('approves a pending registration', () => {
    expect(approve(registration('a'), now)).toMatchObject({ status: 'approved', decidedAt: now.toISOString() });
  });

  it('rejects with a trimmed reason', () => {
    expect(reject(registration('a'), now, '  Адрес не совпадает с документами  ')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Адрес не совпадает с документами',
    });
  });

  it('asks for a reason the headman will understand', () => {
    expect(rejectionError('')).toBe('Напишите причину: её увидит заявитель');
    expect(rejectionError('нет')).toBe('Слишком коротко: объясните, что исправить');
    expect(rejectionError('Адреса нет в ГАР, пришлите выписку')).toBeNull();
  });

  it('does not change a decided registration', () => {
    const done = registration('a', { status: 'approved' });
    expect(approve(done, now)).toBe(done);
    expect(reject(done, now, 'Причина достаточно длинная')).toBe(done);
  });
});

describe('queue', () => {
  const list = [
    registration('new', { submittedAt: '2026-09-25T09:00:00Z' }),
    registration('old', { submittedAt: '2026-09-20T09:00:00Z' }),
    registration('ok', { status: 'approved', decidedAt: '2026-09-22T09:00:00Z' }),
  ];

  it('counts by status', () => {
    expect(countByStatus(list)).toEqual({ pending: 2, approved: 1, rejected: 0 });
  });

  it('shows the longest waiting first among pending', () => {
    expect(visibleRegistrations(list, 'pending').map(({ id }) => id)).toEqual(['old', 'new']);
  });
});
