import { describe, expect, it } from 'vitest';
import type { RequestStatus } from './index.ts';
import {
  allowedRequestActions,
  canComment,
  canSupport,
  categoriesFor,
  findSubcategory,
  isHouseSystem,
  nextStatus,
  REQUEST_CATEGORIES,
  REQUEST_SUBCATEGORIES,
  requestTitle,
  subcategoriesFor,
  validateRequestKind,
} from './requests.ts';

const author = { author: true, processor: false };
const processor = { author: false, processor: true };
const neighbour = { author: false, processor: false };

describe('правила Заявки', () => {
  it.each<[RequestStatus, string[], string[]]>([
    ['new', ['cancel'], ['take', 'reject']],
    ['in-progress', ['cancel'], ['schedule-visit', 'complete', 'reject']],
    ['done', ['confirm', 'not-fixed'], []],
    ['closed', [], []],
    ['rejected', [], []],
    ['cancelled', [], []],
  ])('в статусе %s автору доступно %j, УК и Администратору — %j', (status, forAuthor, forProcessor) => {
    expect(allowedRequestActions({ status, place: 'apartment' }, author)).toEqual(forAuthor);
    expect(allowedRequestActions({ status, place: 'apartment' }, processor)).toEqual(forProcessor);
    expect(allowedRequestActions({ status, place: 'apartment' }, neighbour)).toEqual([]);
  });

  it('Визит назначают только по Заявке о Квартире', () => {
    expect(allowedRequestActions({ status: 'in-progress', place: 'common-property' }, processor)).toEqual(['complete', 'reject']);
  });

  it('Администратор, подавший Заявку сам, и автор, и Ответственный', () => {
    expect(allowedRequestActions({ status: 'new', place: 'apartment' }, { author: true, processor: true })).toEqual(['take', 'reject', 'cancel']);
  });

  it('переводит статусы по действиям и не пускает из чужих статусов', () => {
    expect(nextStatus('new', 'take')).toBe('in-progress');
    expect(nextStatus('in-progress', 'schedule-visit')).toBe('in-progress');
    expect(nextStatus('done', 'not-fixed')).toBe('in-progress');
    expect(nextStatus('done', 'confirm')).toBe('closed');
    expect(nextStatus('closed', 'take')).toBeNull();
    expect(nextStatus('done', 'cancel')).toBeNull();
  });

  it('«У меня тоже» — соседям, на открытой Заявке об Общем имуществе', () => {
    expect(canSupport({ status: 'new', place: 'common-property' }, neighbour)).toBe(true);
    expect(canSupport({ status: 'in-progress', place: 'common-property' }, processor)).toBe(true);
    expect(canSupport({ status: 'new', place: 'common-property' }, author)).toBe(false);
    expect(canSupport({ status: 'done', place: 'common-property' }, neighbour)).toBe(false);
    expect(canSupport({ status: 'new', place: 'apartment' }, neighbour)).toBe(false);
  });

  it('Комментарии — автору и Ответственным, пока Заявка не закрыта', () => {
    expect(canComment('rejected', author)).toBe(true);
    expect(canComment('new', neighbour)).toBe(false);
    expect(canComment('closed', processor)).toBe(false);
  });

  it('Системы — тоже Категории', () => {
    expect(isHouseSystem('Лифты')).toBe(true);
    expect(isHouseSystem('Уборка')).toBe(false);
  });
});

describe('заголовок Заявки из описания', () => {
  it.each([
    ['течёт кран на кухне. Подставили таз', 'Течёт кран на кухне'],
    ['Не работает лифт во втором подъезде!\nЗастряли соседи', 'Не работает лифт во втором подъезде'],
    ['  Мигает свет в подъезде  ', 'Мигает свет в подъезде'],
    ['На площадке пятого этажа второй день мигает лампа, вечером почти темно и страшно ходить', 'На площадке пятого этажа второй день мигает лампа, вечером…'],
    ['...', 'Заявка'],
  ])('%j → %j', (description, title) => {
    expect(requestTitle(description)).toBe(title);
  });
});

describe('Категории по месту и подкатегории', () => {
  it('в Квартире нет Лифтов, Домофона, Уборки и Интернета', () => {
    expect(categoriesFor('apartment')).toEqual(['Электричество', 'Вода', 'Отопление', 'Сантехника', 'Другое']);
    expect(categoriesFor('common-property')).toEqual([...REQUEST_CATEGORIES]);
  });

  it('в каждой Категории, кроме «Другое», есть подкатегории для каждого её места и последняя — «Другое»', () => {
    for (const place of ['apartment', 'common-property'] as const) {
      for (const category of categoriesFor(place)) {
        const options = subcategoriesFor(category, place);
        if (category === 'Другое') {
          expect(options).toEqual([]);
          continue;
        }
        expect(options.length, `${category} / ${place}`).toBeGreaterThan(1);
        expect(options.at(-1)?.id).toBe('other');
      }
    }
  });

  it('id подкатегорий уникальны и годятся для базы', () => {
    for (const [category, options] of Object.entries(REQUEST_SUBCATEGORIES)) {
      const ids = options.map(({ id }) => id);
      expect(new Set(ids).size, category).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
    }
  });

  it('отличает стояк от подводки и подводка бывает только в Квартире', () => {
    expect(findSubcategory('Вода', 'riser')?.label).toBe('Течёт стояк');
    expect(findSubcategory('Вода', 'supply')?.hint).toContain('Тонкая труба');
    expect(subcategoriesFor('Вода', 'common-property').map(({ id }) => id)).not.toContain('supply');
  });

  it('проверяет Категорию и подкатегорию для места', () => {
    expect(validateRequestKind('Лифты', 'apartment', 'lift-stopped')).toBe('category_not_for_place');
    expect(validateRequestKind('Кухня', 'apartment', null)).toBe('category_not_for_place');
    expect(validateRequestKind('Вода', 'apartment', null)).toBe('subcategory_required');
    expect(validateRequestKind('Вода', 'apartment', 'lift-stopped')).toBe('subcategory_invalid');
    expect(validateRequestKind('Вода', 'common-property', 'supply')).toBe('subcategory_invalid');
    expect(validateRequestKind('Другое', 'apartment', 'other')).toBe('subcategory_invalid');
    expect(validateRequestKind('Другое', 'apartment', null)).toBeNull();
    expect(validateRequestKind('Вода', 'apartment', 'riser')).toBeNull();
    expect(validateRequestKind('Лифты', 'common-property', 'other')).toBeNull();
  });
});
