# Contribution conventions

## Scope and safety

- This is a PUBLIC repository. Never add API keys, tokens, personal coursework, real authenticated response dumps, local configuration, or user-specific paths.
- Build a standalone, read-only Nebula REST MCP server. Do not install or change Claude Code, Pi, dotfiles, or other clients.
- Do not call mutation endpoints, execute arbitrary URLs, accept raw MongoDB operators, or scrape RateMyProfessors.
- Log diagnostics only to stderr. Stdout is reserved for MCP protocol messages.
- Keep dependencies minimal, typed inputs strict, and responses bounded. API fields and routes must be grounded in upstream production documentation/source.

## Commits

Use Conventional Commits: `type(scope): imperative summary`, such as `feat(api): add bounded Nebula client` or `test(mcp): cover stdio tool calls`.

Commit cohesive, independently understandable boundaries regularly:

1. Project scaffold and interface/design documentation.
2. API client, validation, and transport/error tests.
3. Domain tools and compact presentation with tests.
4. MCP stdio integration and end-to-end protocol tests.
5. User/developer documentation and CI.

Adjust boundaries when necessary to keep each commit coherent. Do not make one giant implementation commit. Do not mix unrelated cleanup with features or tests. Stage explicit paths; inspect staged diffs and run relevant tests before each commit. Update documentation with behavior changes. Do not rewrite existing history or publish a release without being asked.

## Validation

Tests must be deterministic, offline by default, and use clearly synthetic fixtures. Include MCP protocol integration tests, validation and pagination tests, security tests for redirects/key leaks, cancellation and timeout tests, and context/output-size checks. Live authenticated smoke tests are optional and must not expose keys or response contents in commits.
