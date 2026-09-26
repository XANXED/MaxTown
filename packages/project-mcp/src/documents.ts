import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type KnowledgeArea = 'glossary' | 'decisions' | 'research' | 'rules';

export interface ProjectDocument {
  path: string;
  area: KnowledgeArea;
  content: string;
}

export interface DocumentDiagnostic {
  path: string;
  message: string;
}

export interface ProjectDocuments {
  rootDir: string;
  documents: ProjectDocument[];
  diagnostics: DocumentDiagnostic[];
}

interface SourceDirectory {
  path: string;
  area: KnowledgeArea;
}

const rootFiles: ReadonlyArray<{ path: string; area: KnowledgeArea }> = [
  { path: 'AGENTS.md', area: 'rules' },
  { path: 'CONTEXT.md', area: 'glossary' },
  { path: 'design/AGENTS.md', area: 'rules' },
];

const sourceDirectories: ReadonlyArray<SourceDirectory> = [
  { path: 'docs/adr', area: 'decisions' },
  { path: 'docs/research', area: 'research' },
];

function toProjectPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const relativePath = relative(rootDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && relativePath !== '..'
    && !isAbsolute(relativePath));
}

async function findProjectRoot(startDir: string): Promise<string> {
  let currentDir = await realpath(resolve(startDir));

  try {
    if (!(await lstat(currentDir)).isDirectory()) currentDir = dirname(currentDir);
  } catch {
    throw new Error(`Start directory does not exist: ${startDir}`);
  }

  while (true) {
    try {
      const packageJson = JSON.parse(await readFile(join(currentDir, 'package.json'), 'utf8')) as { name?: unknown };
      if (packageJson.name === 'maxtown') return currentDir;
    } catch {
      // Keep walking up; a malformed or absent package file is not a project root.
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error(`MaxTown repository root not found from ${startDir}`);
}

async function readProjectFile(
  rootDir: string,
  projectPath: string,
  area: KnowledgeArea,
  documents: ProjectDocument[],
  diagnostics: DocumentDiagnostic[],
): Promise<void> {
  const absolutePath = join(rootDir, projectPath);

  try {
    const fileInfo = await lstat(absolutePath);
    const resolvedPath = await realpath(absolutePath);
    if (!isWithinRoot(rootDir, resolvedPath)) {
      diagnostics.push({ path: projectPath, message: 'Source resolves outside the project root.' });
      return;
    }
    if (fileInfo.isSymbolicLink()) {
      diagnostics.push({ path: projectPath, message: 'Symbolic links are not allowed as documentation sources.' });
      return;
    }
    if (!fileInfo.isFile()) {
      diagnostics.push({ path: projectPath, message: 'Documentation source is not a file.' });
      return;
    }

    documents.push({
      path: toProjectPath(projectPath),
      area,
      content: await readFile(absolutePath, 'utf8'),
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? ` (${error.code})`
      : '';
    diagnostics.push({ path: toProjectPath(projectPath), message: `Source could not be read${code}.` });
  }
}

async function collectMarkdownFiles(
  rootDir: string,
  projectDir: string,
  area: KnowledgeArea,
  documents: ProjectDocument[],
  diagnostics: DocumentDiagnostic[],
): Promise<void> {
  const absoluteDir = join(rootDir, projectDir);

  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? ` (${error.code})`
      : '';
    diagnostics.push({ path: toProjectPath(projectDir), message: `Documentation directory could not be read${code}.` });
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const projectPath = toProjectPath(join(projectDir, entry.name));
    const absolutePath = join(rootDir, projectPath);

    if (entry.isSymbolicLink()) {
      try {
        const resolvedPath = await realpath(absolutePath);
        diagnostics.push({
          path: projectPath,
          message: isWithinRoot(rootDir, resolvedPath)
            ? 'Symbolic links are not allowed as documentation sources.'
            : 'Source resolves outside the project root.',
        });
      } catch {
        diagnostics.push({ path: projectPath, message: 'Symbolic documentation source could not be resolved.' });
      }
      continue;
    }

    if (entry.isDirectory()) {
      await collectMarkdownFiles(rootDir, projectPath, area, documents, diagnostics);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      await readProjectFile(rootDir, projectPath, area, documents, diagnostics);
    }
  }
}

export async function loadProjectDocuments(startDir: string): Promise<ProjectDocuments> {
  const rootDir = await findProjectRoot(startDir);
  const documents: ProjectDocument[] = [];
  const diagnostics: DocumentDiagnostic[] = [];

  for (const source of rootFiles) {
    await readProjectFile(rootDir, source.path, source.area, documents, diagnostics);
  }
  for (const source of sourceDirectories) {
    await collectMarkdownFiles(rootDir, source.path, source.area, documents, diagnostics);
  }

  documents.sort((left, right) => left.path.localeCompare(right.path));
  diagnostics.sort((left, right) => left.path.localeCompare(right.path));
  return { rootDir, documents, diagnostics };
}
