# MaxTown project MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, read-only MaxTown MCP that exposes project rules, domain decisions, documentation search, and domain-language checks to Codex.

**Architecture:** Add `@maxtown/project-mcp` to the existing npm workspaces. It will use the official MCP TypeScript SDK over stdio, discover the repository root from its current directory, and read only the documentation allowlist from the spec. Pure document parsing/search functions stay separate from MCP registration so unit tests can exercise them without starting a server.

**Tech Stack:** Node.js >=24, TypeScript in Node's supported erasable syntax, npm workspaces, `@modelcontextprotocol/sdk` 1.x (`^1.29.0`), Zod, Vitest, Codex project configuration in `.codex/config.toml`.

**Spec:** `docs/superpowers/specs/2026-09-26-maxtown-project-mcp-design.md`

## Global Constraints

- Read-only; no file writes, Git changes, application/user data access, secrets, or network requests.
- Read only `CONTEXT.md`, `AGENTS.md`, `design/AGENTS.md`, Markdown files under `docs/adr/`, and Markdown files under `docs/research/`.
- `CONTEXT.md`, `docs/adr/`, `AGENTS.md`, and `design/AGENTS.md` remain their respective sources of truth.
- Use stdio only; protocol messages go to stdout and diagnostics go to stderr.
- Codex MCP registration is project scoped in `.codex/config.toml`, uses no credentials, and is loaded only for trusted projects.
- Preserve strict TypeScript settings, Node-compatible `.ts` relative imports, and no non-erasable TypeScript syntax.
- The glossary checker reports matches; it does not rewrite copy or inspect code-formatted text as interface copy.

## Review Focus

- Traversal-like query values and unexpected area values must not expand filesystem access; covered by document-loader allowlist and MCP schema tests.
- `CONTEXT.md` may contain malformed entries or repeated avoided terms; covered by parser diagnostics and duplicate-match tests.
- Cyrillic words and multiword avoided terms must match case-insensitively without matching inside larger words; covered by Unicode-boundary and case tests.
- Markdown code spans and fenced code may contain avoided words as identifiers; covered by checker tests that skip code-formatted text.
- Empty, whitespace-only, and no-result searches must return useful empty/validation results without broadening the search; covered by search tests.

---

### Task 1: Create the workspace package and server skeleton

**Files:**
- Create: `packages/project-mcp/package.json`
- Create: `packages/project-mcp/tsconfig.json`
- Create: `packages/project-mcp/src/index.ts`
- Modify: root `package.json`
- Modify: `package-lock.json`
- Test: `packages/project-mcp/src/index.test.ts`

**Interfaces:**
- Produces package name `@maxtown/project-mcp`, `start` and `typecheck` scripts, and root command `npm run mcp:project`.
- `src/index.ts` starts the server and does not print protocol-adjacent logs to stdout.

- [ ] **Step 1: Add a failing package entry-point smoke test**

  Add a Vitest test that spawns `node packages/project-mcp/src/index.ts` from a temporary MaxTown-shaped fixture root, connects an MCP client over stdio, and asserts that initialization succeeds, the server name/version are correct, and tools/resources capabilities are advertised.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- packages/project-mcp/src/index.test.ts`
  Expected: FAIL because the package entry point and MCP server do not exist yet.

- [ ] **Step 3: Add the workspace package and minimal stdio entry point**

  Add `@modelcontextprotocol/sdk@^1.29.0` and `zod` as runtime dependencies; extend `../../tsconfig.base.json` with NodeNext module settings and Node types. Set package scripts to `node src/index.ts` and `tsc -p tsconfig.json`. Add root script `mcp:project` delegating to the package. Use SDK `McpServer` with `{ capabilities: { tools: {}, resources: {} } }` and `StdioServerTransport`; route diagnostics through stderr.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `npm test -- packages/project-mcp/src/index.test.ts`
  Expected: PASS, with the expected server metadata and tools/resources capabilities returned over stdio.

- [ ] **Step 5: Commit the package skeleton**

  Commit message: `feat: scaffold MaxTown project MCP`.

### Task 2: Add allowlisted document loading and glossary parsing

**Files:**
- Create: `packages/project-mcp/src/documents.ts`
- Create: `packages/project-mcp/src/documents.test.ts`
- Create: `packages/project-mcp/src/glossary.ts`
- Create: `packages/project-mcp/src/glossary.test.ts`

**Interfaces:**
- `KnowledgeArea` is `'glossary' | 'decisions' | 'research' | 'rules'`.
- `ProjectDocument` is `{ path: string; area: KnowledgeArea; content: string }`; `DocumentDiagnostic` is `{ path: string; message: string }`.
- `loadProjectDocuments(startDir: string): Promise<ProjectDocuments>` discovers the nearest repository root whose `package.json` name is `maxtown`, then returns only the allowlisted Markdown sources with relative paths, document areas, and explicit load diagnostics.
- `parseGlossary(contextMarkdown: string): GlossaryParseResult` returns `{ entries: GlossaryEntry[]; diagnostics: GlossaryDiagnostic[] }`. Each entry has a canonical term, definition, and avoided terms; malformed entries are surfaced as diagnostics rather than guessed.

- [ ] **Step 1: Write failing loader and parser tests**

  Cover root discovery from a nested directory; inclusion of root rules, design rules, glossary, ADR Markdown, and research Markdown; exclusion of `.env`, source code, non-Markdown files, and files outside the root; symlinks resolving outside the root; missing/unreadable sources; canonical term/definition/Avoid extraction; malformed and duplicate entries.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `npm test -- packages/project-mcp/src/documents.test.ts packages/project-mcp/src/glossary.test.ts`
  Expected: FAIL because the document and glossary modules are absent.

- [ ] **Step 3: Implement root discovery, allowlisted loading, and glossary parsing**

  Define `ProjectDocuments` as `{ rootDir: string; documents: ProjectDocument[]; diagnostics: DocumentDiagnostic[] }` and `GlossaryEntry` as `{ term: string; definition: string; avoidedTerms: string[] }`. Keep source definitions and area mappings in `documents.ts`. Reject candidate paths outside the discovered root after real-path resolution. Parse the existing Markdown glossary format where a canonical term starts with `**term**:` and avoided alternatives follow `_Avoid_:`. Return diagnostics for entries that cannot be parsed or loaded.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `npm test -- packages/project-mcp/src/documents.test.ts packages/project-mcp/src/glossary.test.ts`
  Expected: PASS for allowlisting, root discovery, parsing, and diagnostics.

- [ ] **Step 5: Commit document loading and parsing**

  Commit message: `feat: read MaxTown project knowledge safely`.

### Task 3: Implement documentation search and terminology checks

**Files:**
- Create: `packages/project-mcp/src/search.ts`
- Create: `packages/project-mcp/src/search.test.ts`
- Create: `packages/project-mcp/src/language.ts`
- Create: `packages/project-mcp/src/language.test.ts`

**Interfaces:**
- `searchProjectKnowledge(documents: ProjectDocuments, query: string, areas?: KnowledgeArea[]): SearchMatch[]` searches literal terms case-insensitively and returns source path, one-based line, and excerpt.
- `checkDomainLanguage(glossary: GlossaryEntry[], text: string): LanguageMatch[]` returns each avoided term's match, canonical term, definition, and glossary path.

- [ ] **Step 1: Write failing search and language-check tests**

  Search tests cover multiple query terms on one line, area narrowing, stable path/line ordering, 20-result maximum, 240-character excerpt maximum, blank queries, no hits, and regex metacharacters treated literally. Language tests cover case-insensitive Cyrillic matches, multiword phrases, repeated avoided terms, Unicode letter/digit/underscore boundaries, inline backticks, and fenced code blocks.

- [ ] **Step 2: Run focused tests and verify they fail**

  Run: `npm test -- packages/project-mcp/src/search.test.ts packages/project-mcp/src/language.test.ts`
  Expected: FAIL because search and language modules are absent.

- [ ] **Step 3: Implement the pure search and checker functions**

  Require every normalized query token to appear on the same source line. Sort by relative path then line number, and return at most 20 results with excerpts capped at 240 characters. Match avoided phrases using Unicode-aware letter/digit/underscore boundaries. Ignore inline-code spans and fenced code blocks before matching.

- [ ] **Step 4: Run focused tests and verify they pass**

  Run: `npm test -- packages/project-mcp/src/search.test.ts packages/project-mcp/src/language.test.ts`
  Expected: PASS for search and terminology edge cases.

- [ ] **Step 5: Commit search and terminology tools' core logic**

  Commit message: `feat: search MaxTown docs and check domain terms`.

### Task 4: Register MCP resources and tools

**Files:**
- Create: `packages/project-mcp/src/server.ts`
- Create: `packages/project-mcp/src/server.test.ts`
- Modify: `packages/project-mcp/src/index.ts`

**Interfaces:**
- `createProjectMcpServer(rootDir: string): McpServer` registers the three resources and two tools from the spec.
- Resources: `maxtown://context/glossary`, `maxtown://project/rules`, and `maxtown://decisions`.
- Tools: `search_project_knowledge({ query: string, areas?: KnowledgeArea[] })` and `check_domain_language({ text: string })`.

- [ ] **Step 1: Write failing in-memory MCP client tests**

  Use `InMemoryTransport.createLinkedPair()` with the SDK `Client` and `McpServer`. Assert exact tool names and resource URIs; invoke search and checker tools against fixture docs; read each resource; assert source paths appear; assert missing docs return explicit errors and malformed glossary entries are reported as unavailable diagnostics without guessed terms.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- packages/project-mcp/src/server.test.ts`
  Expected: FAIL because the MCP registrations do not exist.

- [ ] **Step 3: Register resources and tools with runtime input schemas**

  Implement registrations with the SDK's `McpServer.registerResource` and `registerTool` APIs and Zod schemas. Use explicit enum validation for `areas`. Resources and handlers must call the document loader on demand; return source paths in metadata/text. Convert expected read/parse failures into clear tool errors.

- [ ] **Step 4: Run in-memory MCP tests and verify they pass**

  Run: `npm test -- packages/project-mcp/src/server.test.ts`
  Expected: PASS for discovery, resource reads, tool behavior, and error responses.

- [ ] **Step 5: Commit MCP resource and tool registrations**

  Commit message: `feat: expose MaxTown knowledge over MCP`.

### Task 5: Configure project-local Codex startup and smoke check

**Files:**
- Create: `.codex/config.toml`
- Create: `packages/project-mcp/src/stdio-smoke.test.ts`
- Modify: `packages/project-mcp/package.json`
- Modify: root `package.json`

**Interfaces:**
- Project config starts `npm run mcp:project` as a stdio server without secrets or network configuration.
- Root verification command `npm run smoke:mcp` runs the stdio smoke test.

- [ ] **Step 1: Write a failing stdio integration test**

  Spawn the real `src/index.ts` process with `StdioClientTransport`, initialize an MCP client, assert the resources/tools can be listed and one resource can be read, then close the transport and child cleanly.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- packages/project-mcp/src/stdio-smoke.test.ts`
  Expected: FAIL because the project server configuration and complete startup are absent.

- [ ] **Step 3: Add project-scoped configuration and smoke script**

  Set the `.codex/config.toml` stdio server's `command` to `npm` and `args` to `run`, `mcp:project`; rely on the server's upward root discovery instead of a machine-specific absolute working path. Add root script `smoke:mcp` to run the focused integration test. Keep stdout exclusively for the MCP protocol.

- [ ] **Step 4: Run the stdio integration test and verify it passes**

  Run: `npm run smoke:mcp`
  Expected: PASS after a fresh child process starts, responds to MCP discovery/read, and shuts down cleanly.

- [ ] **Step 5: Commit local Codex integration**

  Commit message: `feat: configure MaxTown MCP for Codex`.

### Task 6: Document operations and verify the full repository

**Files:**
- Create: `docs/agents/project-mcp.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- `docs/agents/project-mcp.md` explains install, trusted-project setup, available MCP resources/tools, and connection verification.
- `AGENTS.md` explains when to call project knowledge tools and tells the agent to fall back to source files when MCP is unavailable.
- `README.md` lists the project MCP command and smoke check.

- [ ] **Step 1: Write documentation assertions/checklist**

  Confirm docs cover `npm install`, trusting the repo in Codex, how to inspect MCP connection state, the exact resource/tool names, and the fallback behavior when unavailable.

- [ ] **Step 2: Update docs and verify all named paths and commands**

  Add concise setup/use instructions and link them from `AGENTS.md` and `README.md`. Check links, package/workspace names, and command spellings against the actual config.

- [ ] **Step 3: Run focused and repository-wide verification**

  Run: `npm run typecheck`
  Expected: PASS for all workspaces, including `@maxtown/project-mcp`.

  Run: `npm test`
  Expected: PASS for repository tests and MCP tests.

  Run: `npm run build`
  Expected: PASS for all workspaces that define a build command.

  Run: `npm run smoke:mcp`
  Expected: PASS against the actual stdio child process.

- [ ] **Step 4: Review security boundaries**

  Run the available Codex Security review against the completed patch; investigate and resolve validated findings that concern path access, unintended writes/network, or protocol output. Confirm no secrets or data outside the allowlist are read.

- [ ] **Step 5: Review the final diff and commit docs/verification changes**

  Confirm `git diff --check` passes, all spec acceptance criteria map to implemented tests or documented behavior, and the working tree contains no unrelated edits. Commit message: `docs: document MaxTown project MCP`.
