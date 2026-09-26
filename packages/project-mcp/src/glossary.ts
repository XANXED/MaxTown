export interface GlossaryEntry {
  term: string;
  definition: string;
  avoidedTerms: string[];
}

export interface GlossaryDiagnostic {
  line: number;
  term?: string;
  message: string;
}

export interface GlossaryParseResult {
  entries: GlossaryEntry[];
  diagnostics: GlossaryDiagnostic[];
}

interface PendingEntry {
  term: string;
  definitionLines: string[];
  avoidedTerms: string[];
  line: number;
  hasAvoidList: boolean;
}

export function parseGlossary(contextMarkdown: string): GlossaryParseResult {
  const entries: GlossaryEntry[] = [];
  const diagnostics: GlossaryDiagnostic[] = [];
  const seenTerms = new Set<string>();
  let current: PendingEntry | undefined;

  const finishEntry = () => {
    if (!current) return;
    const normalizedTerm = current.term.toLocaleLowerCase('ru-RU');
    if (seenTerms.has(normalizedTerm)) {
      diagnostics.push({
        line: current.line,
        term: current.term,
        message: 'Duplicate canonical term.',
      });
    } else {
      seenTerms.add(normalizedTerm);
      entries.push({
        term: current.term,
        definition: current.definitionLines.join(' ').replace(/\s+/gu, ' ').trim(),
        avoidedTerms: current.avoidedTerms,
      });
    }
    current = undefined;
  };

  for (const [index, rawLine] of contextMarkdown.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    const canonicalMatch = /^\*\*(.+?)\*\*:\s*(.*)$/u.exec(line);

    if (canonicalMatch) {
      finishEntry();
      const term = canonicalMatch[1]?.trim();
      if (!term) {
        diagnostics.push({ line: lineNumber, message: 'Canonical term is empty.' });
        continue;
      }
      current = {
        term,
        definitionLines: canonicalMatch[2] ? [canonicalMatch[2]] : [],
        avoidedTerms: [],
        line: lineNumber,
        hasAvoidList: false,
      };
      continue;
    }

    const malformedCanonicalMatch = /^\*\*(.+?)\*\*(.*)$/u.exec(line);
    if (malformedCanonicalMatch) {
      finishEntry();
      diagnostics.push({
        line: lineNumber,
        term: malformedCanonicalMatch[1]?.trim(),
        message: 'Glossary entry is missing a colon after its canonical term.',
      });
      continue;
    }

    const avoidMatch = /^_Avoid_:\s*(.*)$/iu.exec(line);
    if (avoidMatch) {
      if (!current) {
        diagnostics.push({ line: lineNumber, message: 'Avoid list is not attached to a canonical term.' });
        continue;
      }
      if (current.hasAvoidList) {
        diagnostics.push({ line: lineNumber, term: current.term, message: 'Duplicate Avoid list.' });
        continue;
      }

      current.hasAvoidList = true;
      current.avoidedTerms = (avoidMatch[1] ?? '')
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      if (current.avoidedTerms.length === 0) {
        diagnostics.push({ line: lineNumber, term: current.term, message: 'Avoid list is empty.' });
      }
      continue;
    }

    if (line && current && !current.hasAvoidList) current.definitionLines.push(line);
  }

  finishEntry();
  return { entries, diagnostics };
}
