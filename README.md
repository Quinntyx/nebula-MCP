# Nebula MCP

A small, read-only Model Context Protocol server for the [Nebula Labs UT Dallas API](https://github.com/UTDNebula/nebula-api): courses, sections, professors, grade distributions, and student organizations.

**Work in progress.** The interface and implementation are being developed. Client installation is intentionally separate from building this repository.

## Goals

- Use Nebula's production REST API; do not depend on unreleased GraphQL endpoints.
- Expose task-oriented tools with compact, bounded results and explicit academic periods.
- Use the official MCP TypeScript SDK and local stdio transport.
- Accept `NEBULA_API_KEY` at runtime. Never commit credentials or captured private responses.
- Keep API access read-only, restricted to the official API host.
- Test against synthetic fixtures without requiring a key or network access.

This project is independent of Nebula Labs and UT Dallas. Data availability, freshness, and completeness depend on the upstream API.

## Development

See [AGENTS.md](AGENTS.md) for contribution and commit conventions. Build, test, and usage instructions will be added with the implementation.

## License

[MIT](LICENSE).
