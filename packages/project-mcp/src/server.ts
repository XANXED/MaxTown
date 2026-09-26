import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadProjectDocuments, type KnowledgeArea } from './documents.ts';
import { parseGlossary } from './glossary.ts';
import { checkDomainLanguage } from './language.ts';
import { searchProjectKnowledge } from './search.ts';

const knowledgeAreas = ['glossary', 'decisions', 'research', 'rules'] as const satisfies readonly KnowledgeArea[];

function formatDiagnostics(diagnostics: Array<{ path: string; message: string }>): string {
  return diagnostics.map(({ path, message }) => `${path}: ${message}`).join('\n');
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(text: string) {
  return { ...textResult(text), isError: true };
}

export function createProjectMcpServer(rootDir: string): McpServer {
  const server = new McpServer(
    { name: 'maxtown-project', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerResource('glossary', 'maxtown://context/glossary', {
    title: 'Словарь терминов MaxTown', description: 'Канонические термины и избегаемые формулировки из CONTEXT.md.', mimeType: 'text/markdown',
  }, async () => {
    const project = await loadProjectDocuments(rootDir);
    const doc = project.documents.find(({ path }) => path === 'CONTEXT.md');
    if (!doc) return { contents: [{ uri: 'maxtown://context/glossary', mimeType: 'text/plain', text: `Не удалось прочитать CONTEXT.md.\n${formatDiagnostics(project.diagnostics)}` }] };
    return { contents: [{ uri: 'maxtown://context/glossary', mimeType: 'text/markdown', text: `Источник: ${doc.path}\n\n${doc.content}` }] };
  });

  server.registerResource('project-rules', 'maxtown://project/rules', {
    title: 'Правила проекта', description: 'Корневые правила MaxTown и правила оформления.', mimeType: 'text/markdown',
  }, async () => {
    const project = await loadProjectDocuments(rootDir);
    const docs = project.documents.filter(({ area }) => area === 'rules');
    const text = docs.map(({ path, content }) => `Источник: ${path}\n\n${content}`).join('\n\n---\n\n');
    return { contents: [{ uri: 'maxtown://project/rules', mimeType: 'text/markdown', text: text || `Правила недоступны.\n${formatDiagnostics(project.diagnostics)}` }] };
  });

  server.registerResource('decisions', 'maxtown://decisions', {
    title: 'Архитектурные решения', description: 'Решения проекта из docs/adr/.', mimeType: 'text/markdown',
  }, async () => {
    const project = await loadProjectDocuments(rootDir);
    const docs = project.documents.filter(({ area }) => area === 'decisions');
    const text = docs.map(({ path, content }) => `Источник: ${path}\n\n${content}`).join('\n\n---\n\n');
    return { contents: [{ uri: 'maxtown://decisions', mimeType: 'text/markdown', text: text || `Решения не найдены.\n${formatDiagnostics(project.diagnostics)}` }] };
  });

  server.registerTool('search_project_knowledge', {
    title: 'Поиск по знаниям MaxTown',
    description: 'Ищет буквальные термины в разрешённых проектных документах и возвращает источники и строки.',
    inputSchema: z.object({ query: z.string(), areas: z.array(z.enum(knowledgeAreas)).optional() }),
  }, async ({ query, areas }) => {
    try {
      const project = await loadProjectDocuments(rootDir);
      const matches = searchProjectKnowledge(project, query, areas);
      return textResult(JSON.stringify({ matches, diagnostics: project.diagnostics }, null, 2));
    } catch (error) {
      return errorResult(`Не удалось выполнить поиск по знаниям MaxTown: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
    }
  });

  server.registerTool('check_domain_language', {
    title: 'Проверка терминологии MaxTown',
    description: 'Находит избегаемые слова и предлагает канонические термины из CONTEXT.md.',
    inputSchema: z.object({ text: z.string() }),
  }, async ({ text }) => {
    try {
      const project = await loadProjectDocuments(rootDir);
      const glossaryDoc = project.documents.find(({ path }) => path === 'CONTEXT.md');
      if (!glossaryDoc) return errorResult(`Словарь недоступен.\n${formatDiagnostics(project.diagnostics)}`);
      const glossary = parseGlossary(glossaryDoc.content);
      if (glossary.diagnostics.length > 0) {
        const diagnostics = glossary.diagnostics.map(({ line, term, message }) => `CONTEXT.md:${line}${term ? ` (${term})` : ''}: ${message}`);
        return errorResult(`Словарь недоступен из-за ошибок формата; термины не угадывались.\n${diagnostics.join('\n')}`);
      }
      return textResult(JSON.stringify({ matches: checkDomainLanguage(glossary.entries, text), sourcePath: glossaryDoc.path, diagnostics: project.diagnostics }, null, 2));
    } catch (error) {
      return errorResult(`Не удалось проверить терминологию: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
    }
  });

  return server;
}
