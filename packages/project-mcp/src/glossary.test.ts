import { expect, test } from 'vitest';
import { parseGlossary } from './glossary.ts';

test('parses canonical terms, multiline definitions, and avoided alternatives', () => {
  const result = parseGlossary([
    '# Language',
    '',
    '**Жилец**:',
    'Человек, привязанный к Квартире.',
    'Он может быть собственником или арендатором.',
    '_Avoid_: пользователь, житель, резидент',
    '',
    '**Заявка**: Сообщение о неисправности.',
    '_Avoid_: обращение, тикет',
  ].join('\n'));

  expect(result).toEqual({
    entries: [
      {
        term: 'Жилец',
        definition: 'Человек, привязанный к Квартире. Он может быть собственником или арендатором.',
        avoidedTerms: ['пользователь', 'житель', 'резидент'],
      },
      {
        term: 'Заявка',
        definition: 'Сообщение о неисправности.',
        avoidedTerms: ['обращение', 'тикет'],
      },
    ],
    diagnostics: [],
  });
});

test('reports malformed and duplicate glossary entries without guessing', () => {
  const result = parseGlossary([
    '_Avoid_: orphan',
    '**Жилец**:',
    'Человек в квартире.',
    '_Avoid_: житель',
    '**Дом** без двоеточия',
    '**ЖИЛЕЦ**:',
    'Повторное описание.',
    '_Avoid_: пользователь',
  ].join('\n'));

  expect(result.entries).toEqual([
    { term: 'Жилец', definition: 'Человек в квартире.', avoidedTerms: ['житель'] },
  ]);
  expect(result.diagnostics).toEqual([
    { line: 1, message: 'Avoid list is not attached to a canonical term.' },
    { line: 5, term: 'Дом', message: 'Glossary entry is missing a colon after its canonical term.' },
    { line: 6, term: 'ЖИЛЕЦ', message: 'Duplicate canonical term.' },
  ]);
});
