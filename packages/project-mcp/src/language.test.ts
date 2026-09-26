import { expect, test } from 'vitest';
import type { GlossaryEntry } from './glossary.ts';
import { checkDomainLanguage } from './language.ts';

test('matches Cyrillic avoided terms case-insensitively', () => {
  const result = checkDomainLanguage([
    { term: 'Жилец', definition: 'Человек, привязанный к Квартире.', avoidedTerms: ['пользователь'] },
  ], 'ПОЛЬЗОВАТЕЛЬ оставил сообщение.');

  expect(result).toEqual([
    {
      avoidedTerm: 'пользователь',
      canonicalTerm: 'Жилец',
      definition: 'Человек, привязанный к Квартире.',
      sourcePath: 'CONTEXT.md',
      offset: 0,
    },
  ]);
});

test('matches multiword avoided phrases and reports their preferred term', () => {
  const result = checkDomainLanguage([
    { term: 'Запрос на вступление', definition: 'Просьба стать жильцом квартиры.', avoidedTerms: ['заявка на вступление'] },
  ], 'Заявка на вступление доступна здесь.');

  expect(result).toEqual([
    {
      avoidedTerm: 'заявка на вступление',
      canonicalTerm: 'Запрос на вступление',
      definition: 'Просьба стать жильцом квартиры.',
      sourcePath: 'CONTEXT.md',
      offset: 0,
    },
  ]);
});

test('reports every repeated occurrence in text order', () => {
  const entry: GlossaryEntry = {
    term: 'Событие дома',
    definition: 'То, что видят жильцы.',
    avoidedTerms: ['новость'],
  };
  const result = checkDomainLanguage([entry], 'Новость и новость');

  expect(result.map(({ offset }) => offset)).toEqual([0, 10]);
});

test('uses Unicode word boundaries for Cyrillic terms and underscores', () => {
  const result = checkDomainLanguage([
    { term: 'Жилец', definition: 'Человек дома.', avoidedTerms: ['житель'] },
  ], 'жительский ЖИТЕЛЬ_админ житель');

  expect(result.map(({ offset }) => offset)).toEqual([24]);
});

test('ignores avoided words in inline and fenced code', () => {
  const text = [
    '`пользователь`',
    '```tsx',
    'const пользователь = 1;',
    '```',
    'житель отправил сообщение',
  ].join('\n');
  const result = checkDomainLanguage([
    { term: 'Жилец', definition: 'Человек дома.', avoidedTerms: ['пользователь', 'житель'] },
  ], text);

  expect(result.map(({ avoidedTerm, offset }) => ({ avoidedTerm, offset }))).toEqual([
    { avoidedTerm: 'житель', offset: text.lastIndexOf('житель') },
  ]);
});
