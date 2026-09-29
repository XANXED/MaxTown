import { describe, expect, it } from 'vitest';
import { filterServiceGroups, serviceGroups } from './services.ts';

const titles = (query: string) =>
  filterServiceGroups(serviceGroups, query).flatMap((group) => group.services.map((service) => service.title));

describe('filterServiceGroups', () => {
  it('returns everything for an empty query', () => {
    expect(filterServiceGroups(serviceGroups, '   ')).toBe(serviceGroups);
  });

  it('matches title, description and keywords case-insensitively', () => {
    expect(titles('ЗАЯВК')).toEqual(['Подать заявку', 'Мои заявки']);
    expect(titles('МФЦ')).toEqual(['Места рядом']);
    expect(titles('позвонить')).toEqual(['Контакты']);
  });

  it('treats ё and е as the same letter', () => {
    expect(titles('счетчики')).toEqual(['Передать показания']);
  });

  it('requires every word and drops empty groups', () => {
    const groups = filterServiceGroups(serviceGroups, 'вода показания');
    expect(groups.map((group) => group.title)).toEqual(['Дом']);
    expect(titles('несуществующий сервис')).toEqual([]);
  });

  it('makes the house community discoverable from the service directory', () => {
    expect(titles('чат дома')).toEqual(['Чат Дома']);
  });

  it('makes house repair works discoverable from the service directory', () => {
    expect(titles('ремонтные работы')).toEqual(['Ремонтные работы']);
  });
});
