import { describe, expect, it } from 'vitest';
import { OTHER_SUBCATEGORY_ID, REQUEST_SUBCATEGORIES } from '@maxtown/shared/requests';
import { hasScene, REQUEST_SCENES } from './requestIllustrations.tsx';

describe('иллюстрации подкатегорий', () => {
  const ids = Object.values(REQUEST_SUBCATEGORIES).flat().map(({ id }) => id).filter((id) => id !== OTHER_SUBCATEGORY_ID);

  it('у каждой подкатегории, кроме «Другое», есть своя сцена', () => {
    expect(ids.filter((id) => !hasScene(id))).toEqual([]);
  });

  it('id подкатегорий уникальны во всём справочнике: сцена выбирается по id', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('нет лишних сцен, которых нет в справочнике', () => {
    expect(Object.keys(REQUEST_SCENES).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it('у «Другое» сцены нет — вместо неё значок Категории', () => {
    expect(hasScene(OTHER_SUBCATEGORY_ID)).toBe(false);
  });
});
