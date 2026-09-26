import type { KnowledgeArea, ProjectDocuments } from './documents.ts';

export interface SearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

const MAX_RESULTS = 20;
const MAX_EXCERPT_LENGTH = 240;

function makeExcerpt(line: string): string {
  if (line.length <= MAX_EXCERPT_LENGTH) return line;

  let excerpt = '';
  for (const character of line) {
    if (excerpt.length + character.length > MAX_EXCERPT_LENGTH - 3) break;
    excerpt += character;
  }
  return `${excerpt}...`;
}

export function searchProjectKnowledge(
  project: ProjectDocuments,
  query: string,
  areas?: KnowledgeArea[],
): SearchMatch[] {
  const terms = query.toLocaleLowerCase('ru-RU').trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [];

  const selectedAreas = areas === undefined ? undefined : new Set(areas);
  const matches: SearchMatch[] = [];
  for (const document of project.documents) {
    if (selectedAreas && !selectedAreas.has(document.area)) continue;

    const lines = document.content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const normalizedLine = line.toLocaleLowerCase('ru-RU');
      if (terms.every((term) => normalizedLine.includes(term))) {
        matches.push({ path: document.path, line: index + 1, excerpt: makeExcerpt(line) });
      }
    }
  }

  matches.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  return matches.slice(0, MAX_RESULTS);
}
