import { expect, test } from 'vitest';
import type { ProjectDocuments } from './documents.ts';
import { searchProjectKnowledge } from './search.ts';

function knowledge(documents: ProjectDocuments['documents']): ProjectDocuments {
  return { rootDir: '/repo', documents, diagnostics: [] };
}

test('matches every query token on the same line and reports its source line', () => {
  const result = searchProjectKnowledge(knowledge([
    { path: 'docs/state.md', area: 'research', content: 'Вода доступна.\nОтключили воду и отопление.' },
  ]), 'воду отопление');

  expect(result).toEqual([
    { path: 'docs/state.md', line: 2, excerpt: 'Отключили воду и отопление.' },
  ]);
});

test('narrows results to the requested knowledge areas', () => {
  const result = searchProjectKnowledge(knowledge([
    { path: 'CONTEXT.md', area: 'glossary', content: 'ФИАС присваивает адрес.' },
    { path: 'docs/research/source.md', area: 'research', content: 'ФИАС содержит адрес.' },
  ]), 'ФИАС', ['research']);

  expect(result).toEqual([
    { path: 'docs/research/source.md', line: 1, excerpt: 'ФИАС содержит адрес.' },
  ]);
});

test('orders matches by source path and line and returns at most twenty', () => {
  const result = searchProjectKnowledge(knowledge([
    { path: 'docs/z.md', area: 'research', content: 'Авария в конце.' },
    { path: 'docs/a.md', area: 'decisions', content: Array.from({ length: 22 }, (_, i) => `Авария ${i + 1}`).join('\n') },
  ]), 'авария');

  expect(result).toHaveLength(20);
  expect(result[0]).toEqual({ path: 'docs/a.md', line: 1, excerpt: 'Авария 1' });
  expect(result.at(-1)).toEqual({ path: 'docs/a.md', line: 20, excerpt: 'Авария 20' });
});

test('caps long excerpts at 240 characters', () => {
  const line = `Авария ${'x'.repeat(300)}`;
  const result = searchProjectKnowledge(knowledge([
    { path: 'docs/state.md', area: 'research', content: line },
  ]), 'авария');

  expect(result[0]?.excerpt).toBe(`${line.slice(0, 237)}...`);
  expect(result[0]?.excerpt).toHaveLength(240);
});

test('returns no matches for a blank query or unknown terms', () => {
  const docs = knowledge([
    { path: 'CONTEXT.md', area: 'glossary', content: 'Дом и Заявка.' },
  ]);

  expect(searchProjectKnowledge(docs, '  \n  ')).toEqual([]);
  expect(searchProjectKnowledge(docs, 'неизвестный термин')).toEqual([]);
});

test('treats regular expression punctuation as literal text', () => {
  const result = searchProjectKnowledge(knowledge([
    { path: 'docs/query.md', area: 'research', content: 'Pattern a.*b is literal. Pattern axxxb is different.' },
  ]), 'a.*b');

  expect(result).toEqual([
    { path: 'docs/query.md', line: 1, excerpt: 'Pattern a.*b is literal. Pattern axxxb is different.' },
  ]);
});
