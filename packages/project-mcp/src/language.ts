import type { GlossaryEntry } from './glossary.ts';

export interface LanguageMatch {
  avoidedTerm: string;
  canonicalTerm: string;
  definition: string;
  sourcePath: 'CONTEXT.md';
  offset: number;
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' ';
  }
}

function maskMarkdownCode(text: string): string {
  const characters = text.split('');
  let offset = 0;
  let fence: { character: '`' | '~'; length: number } | undefined;

  for (const line of text.split(/(?<=\n)/u)) {
    const content = line.endsWith('\n') ? line.slice(0, -1).replace(/\r$/u, '') : line.replace(/\r$/u, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content);

    if (fence) {
      maskRange(characters, offset, offset + line.length);
      if (fenceMatch) {
        const marker = fenceMatch[1] ?? '';
        if (marker[0] === fence.character && marker.length >= fence.length && (fence.character !== '`' || !fenceMatch[2]?.includes('`'))) {
          fence = undefined;
        }
      }
      offset += line.length;
      continue;
    }

    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      fence = { character: marker[0] as '`' | '~', length: marker.length };
      maskRange(characters, offset, offset + line.length);
      offset += line.length;
      continue;
    }

    const inlineCode = /(`+)([^`\r\n]*?)\1/gu;
    for (const match of content.matchAll(inlineCode)) {
      if (match.index === undefined) continue;
      maskRange(characters, offset + match.index, offset + match.index + match[0].length);
    }
    offset += line.length;
  }

  return characters.join('');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function makeAvoidPattern(term: string): RegExp | undefined {
  const words = term.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return undefined;
  const phrase = words.map(escapeRegExp).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_])`, 'giu');
}

export function checkDomainLanguage(glossary: GlossaryEntry[], text: string): LanguageMatch[] {
  const searchableText = maskMarkdownCode(text);
  const matches: LanguageMatch[] = [];

  for (const entry of glossary) {
    for (const avoidedTerm of entry.avoidedTerms) {
      const pattern = makeAvoidPattern(avoidedTerm);
      if (!pattern) continue;
      for (const match of searchableText.matchAll(pattern)) {
        if (match.index === undefined) continue;
        matches.push({
          avoidedTerm,
          canonicalTerm: entry.term,
          definition: entry.definition,
          sourcePath: 'CONTEXT.md',
          offset: match.index,
        });
      }
    }
  }

  return matches.sort((left, right) => left.offset - right.offset
    || left.canonicalTerm.localeCompare(right.canonicalTerm)
    || left.avoidedTerm.localeCompare(right.avoidedTerm));
}
