# MaxTown project MCP

## Goal

Give Codex project-specific, callable access to MaxTown's domain language and
decisions. The MCP must make it easier to find the right project rule and use
canonical terms while changing the product.

## Agreed constraints

- The server is specific to this repository and is launched locally by Codex.
- It reads project documentation only; it does not call external services.
- It does not write files, change Git state, or handle application data or
  secrets.
- `CONTEXT.md` remains the source of truth for domain terms. `docs/adr/`
  remains the source of truth for decisions. `AGENTS.md` and
  `design/AGENTS.md` remain the source of project and design rules.
- Official sources remain indexed in `docs/research/sources.md`; live external
  documentation lookup stays with existing web/Context7 tools.

## Proposed architecture

Add a small Node/TypeScript package at `packages/project-mcp/`, included by the
existing `packages/*` npm workspace. It exposes a local stdio MCP server and
reads the repository documents on each request so that edits appear without a
rebuild or remote indexing service. A project-level `.codex/config.toml`
registers the command. Codex loads this project configuration only when the
repository is trusted.

The process resolves the repository root from its configured working directory
and reads only the allowlisted files and directories named above. It returns
relative source paths with results. Missing or unreadable documents produce a
clear tool error naming the path; the server does not silently substitute
stale content.

## MCP surface

### Resources

- `maxtown://context/glossary` — current `CONTEXT.md` content.
- `maxtown://project/rules` — root `AGENTS.md` and `design/AGENTS.md` content.
- `maxtown://decisions` — index of ADRs with their titles and paths.

Resources are read-only and include source paths in their descriptions.

### Tools

- `search_project_knowledge(query, areas?)` — searches the allowlisted domain,
  ADR, research and rule documents; returns short matching excerpts and paths.
  `areas` can narrow the search to `glossary`, `decisions`, `research`, or
  `rules`.
- `check_domain_language(text)` — finds case-insensitive occurrences of terms
  explicitly listed under `Avoid` in `CONTEXT.md`, and returns the preferred
  term, source definition, and glossary path. It reports matches only; it does
  not rewrite text or treat ordinary code identifiers as interface copy.

The checker parses the glossary rather than maintaining a second vocabulary
table, so updates to `CONTEXT.md` are reflected automatically. If an entry
cannot be parsed, the checker reports that entry as unavailable instead of
guessing.

## Out of scope

- GitHub, MAX, GIS ЖКХ, ФИАС or other external API connections.
- Authentication, application data, user records, or access to `.env`.
- Writing or editing repository files.
- Replacing Context7, web search, code search, or project instructions.
- Automatic checks on every assistant response or automatic commits.

## Acceptance criteria

1. Opening a resource returns the current content from its documented source.
2. Search results identify their source file and do not search outside the
   allowlist.
3. The language checker catches glossary `Avoid` terms and proposes the
   corresponding canonical terms, without false matching inside larger words.
4. Missing files and malformed glossary entries return explicit diagnostics.
5. The MCP server uses stdio only, writes protocol output only to stdout, and
   makes no network requests.
6. The project-level Codex configuration starts the server using repository
   workspace commands and requires no credentials.
7. Automated tests cover source allowlisting, glossary parsing, case handling,
   word boundaries, and missing/malformed sources.

## Verification and operations

Implementation should add focused unit tests for parsing/search behavior and a
smoke check that starts the stdio server and discovers the declared resources
and tools. The repository's existing `npm run typecheck` and `npm test` remain
the overall checks. The project documentation should explain how to install
workspace dependencies, trust the repository in Codex, and confirm that the
server is connected.

## Open implementation choice

Choose the smallest maintained MCP TypeScript SDK compatible with the
repository's Node >=24 runtime during planning. Keep SDK-specific transport and
schema details inside `packages/project-mcp/` so the MCP surface above remains
stable.
