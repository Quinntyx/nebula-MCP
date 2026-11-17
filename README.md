# Nebula MCP

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the [Nebula Labs UT Dallas API](https://github.com/UTDNebula/nebula-api): courses, sections, professors, grade distributions, academic calendars, student organizations, and (opt-in) campus events.

Ten tools are enabled by default. Campus events are opt-in, so a default installation cannot read the Comet Calendar unless you ask for it.

This project is independent of Nebula Labs and UT Dallas. Data availability, freshness, and completeness depend entirely on the upstream API. Nothing here is an official university system of record.

## Requirements

- Node.js **22 or newer** (the server is ESM and uses the built-in `fetch`, `AbortSignal.any`, and `node --test`).
- A Nebula Labs API key for tool calls. Discovery (`initialize`, `tools/list`) works without one.

## Install and run

```bash
npm ci
npm run build
NEBULA_API_KEY=your-key node dist/src/index.js
```

The server speaks MCP over **stdio**; it prints diagnostics to stderr only, so stdout stays a clean JSON-RPC channel.

Register it with an MCP client (Claude Desktop, VS Code, Cursor, Zed, …) using a stdio entry point:

```json
{
  "mcpServers": {
    "utd-nebula": {
      "command": "node",
      "args": ["/absolute/path/to/nebula-MCP/dist/src/index.js"],
      "env": { "NEBULA_API_KEY": "your-key" }
    }
  }
}
```

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `NEBULA_API_KEY` | for tool calls | Sent as `x-api-key` to the fixed upstream host. Missing keys do not break discovery; calls fail with `AUTH_MISSING` without any network access. |
| `NEBULA_MCP_TOOLSETS` | no | Comma-separated subset of `academics`, `clubs`, `events`. Default `academics,clubs`. Unknown or empty selections stop startup with exit code 2 and a stderr message. |

There is no base-URL override. The server always talks to `https://api.utdnebula.com`, uses `GET` only, refuses redirects, and never accepts a caller-supplied path, URL, or key.

## Tools

| Tool | Toolset | Arguments (all bounded) |
| --- | --- | --- |
| `course_search` | academics | `subject_prefix` (required), `course_number`, `catalog_year`, `school`, `class_level`, `limit` 1–20 (default 10), `cursor` |
| `course_get` | academics | `course_id` (24-hex upstream id) |
| `section_search` | academics | paired `subject_prefix` + `course_number` and/or paired `first_name` + `last_name`, `term`, `limit` 1–25, `cursor` |
| `section_get` | academics | `section_id` |
| `professor_search` | academics | `first_name` and/or `last_name`, `limit` 1–20 (default 10), `cursor` |
| `professor_get` | academics | `professor_id` |
| `grades_get` | academics | one of `course_id` / `professor_id` / `section_id`, or filters `subject_prefix`+`course_number`(+`section_number`), `first_name`+`last_name`; `by` = `overall` (default) \| `term` \| `term_section_type`; `terms`; `limit` 1–40 (default 12); `cursor` |
| `academic_calendar_get` | academics | `term` (canonical `YY[SUF]`, four-digit, or `Fall 2026`); omitted means the upstream "current" calendar |
| `club_search` | clubs | `query` (1–120 chars; at least two letters/digits after wildcard removal), `limit` 1–15 (default 5), `cursor` |
| `club_get` | clubs | `club_id` |
| `campus_events_on_date` | events | `date` (`YYYY-MM-DD`, required), `building`, `room` (requires `building`), `query`, `limit` 1–50, `cursor` |

Semantics worth knowing before you rely on them:

- **Exact academic matching.** Subject prefixes are uppercased; text filters are trimmed and whitespace is normalized. Academic filters are case-sensitive with no fuzzy matching or capitalization retries. Club keyword search is fuzzy.
- **No catalog guessing.** `course_get` and `professor_get` take ids only. The server never picks a "newest catalog" row for you, and never resolves a name to an id behind your back.
- **Bounded requests.** Course/professor searches fetch one upstream page at the cursor offset. Trends sections, clubs, events and per-term grades fetch one complete response (within the byte limit) and page locally. No hidden multi-page fallbacks or widened filters. `section_get` explicitly fetches instructors in a second request.
- **Honest pagination.** Course/professor searches use `has_more: null` when exhaustion is unknown, and `false` only after an empty upstream page; a terminal empty call may be needed. Locally paged datasets know when their last page is reached. Every partial nonempty page has a continuation cursor.
- **Grade buckets are raw counts.** Exactly 14 buckets, in Trends order: `A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F, W`. An all-zero distribution means no recorded observations, not a missing entity. **No GPA, no ranking.**
- **Calendars are not inferred.** Omitting `term` returns whatever the upstream API marks as current; the server never derives the current term from the clock.

Detailed arguments and examples live in [docs/tools.md](docs/tools.md). See the [design contract](docs/design.md) and [review/validation record](docs/validation.md).

## Result shape

Every successful call returns one minified JSON text block:

```json
{
  "ok": true,
  "data": { "items": [], "returned": 0, "has_more": false },
  "meta": {
    "source": "api.utdnebula.com",
    "fetched_at": "2026-11-17T00:00:00.000Z",
    "requests": 1,
    "notes": ["..."],
    "truncated": false
  }
}
```

Errors set MCP `isError: true` and return a bounded block with no echoed key material:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "subject_prefix must be a short alphanumeric subject code such as CS",
    "hint": "Remove punctuation or wildcards.",
    "retryable": false
  }
}
```

Codes: `INVALID_ARGUMENT`, `NOT_FOUND`, `AUTH_MISSING`, `AUTH_REJECTED`, `RATE_LIMITED`, `UPSTREAM_TIMEOUT`, `UPSTREAM_ERROR`, `UPSTREAM_SCHEMA`, `RESPONSE_TOO_LARGE`, `CANCELLED`, `UNSUPPORTED`.

Lists page with opaque `next_cursor` values. Cursors are versioned base64url JSON that bind the tool and a hash of the normalized filters; changing a filter or switching tools invalidates the cursor. They carry pagination state only, never credentials or URLs.

The complete MCP result, including metadata and serialization overhead, is capped at **12,000 UTF-8 bytes**; list data targets **6,000 bytes**. Truncation is disclosed in data/metadata. Cursors advance by rows actually emitted, never by discarded rows. Upstream updates can still cause paging drift. A row/detail that cannot fit returns `RESPONSE_TOO_LARGE`, not an unusable empty success.

Tool descriptions are at most 160 characters, and the server exposes only selected toolsets. Client-side deferred discovery is supported naturally; this repository does not install or configure clients.

## Limits and safety

- Fixed API origin, `GET` only, redirects rejected, no caller-provided paths.
- Streaming response bodies with a hard byte ceiling; oversized bodies fail with `RESPONSE_TOO_LARGE`.
- 10-second per-attempt timeout plus a bounded total budget, one retry for `429/502/503/504` honoring a short `Retry-After`, and MCP cancellation propagated to the fetch signal.
- Strict schemas: unknown properties and invalid argument combinations are rejected before any network call.
- Read-only tool annotations (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`).
- No credentials in logs, cursors, errors, or results. Nothing is written to disk.

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/
npm test            # build, then node --test dist/test/*.test.js
npm run check       # typecheck + test
```

Tests are fully offline: synthetic fixtures model upstream envelopes; a real stdio subprocess and the official SDK client exercise discovery, strict schemas, argument validation, missing-key handling, toolset selection, reflected-secret redaction, and output budgets. No API key, network access, or captured production data is involved. There is no live smoke test in the required path; see [AGENTS.md](AGENTS.md) for contribution rules and commit conventions.

## Data notes and limitations

- Name-filtered grade aggregates merge homonymous instructors; ID-based aggregates scope to the supplied entity. Course filters resolve through the upstream internal course number, so cross-listed or renumbered courses can combine.
- Section and professor results reflect the upstream index at fetch time; there is no live registration, seat-count, or waitlist data.
- Campus events come from the Comet Calendar index. An empty day means no indexed events, not proof that nothing happens on campus. Listed rooms are event locations, not verified bookings.
- Club results are a fuzzy index; absence from it does not mean an organization does not exist. Contact links are returned as data and never opened automatically.

## License

[MIT](LICENSE).
