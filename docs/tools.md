# Tool reference

All tools are read-only. They publish strict JSON schemas and reject unknown properties, invalid types, whitespace-only text, and invalid argument combinations before network access. Results are single JSON text blocks; large values/collections disclose truncation. See [design.md](design.md) and [README](../README.md).

## Common conventions

- `limit` controls rows returned by this server, not upstream page size. No invented upstream `limit` is sent.
- `cursor` is at most 512 characters. Pass `next_cursor` unchanged with the same tool and filters; changing the limit is allowed.
- Course/professor searches read one API page using raw `offset`. Their `has_more` is `true` if that page has unreturned rows, `null` if exhaustion is unknown, and `false` only after an empty page. A terminal empty call may be needed.
- Trends sections, clubs, term grades, and events fetch one complete response within a 2 MiB ceiling and page locally; their `has_more` is boolean. Continuations refetch rather than retain an unbounded cache. Upstream changes can cause drift.
- All partial nonempty pages provide a cursor; no row is skipped merely to meet an output budget. An oversized first row produces a bounded error rather than an empty, unusable page.
- Lists target 6,000 bytes of data. The complete MCP result is limited to 12,000 UTF-8 bytes, including metadata, errors, and JSON escaping. Further field/collection reductions are marked with `truncated` in data or metadata; clipped text ends in an ellipsis.
- `meta.requests` reports attempts returned by the repository; retries are included for successful calls. Failed optional lookups may not be counted. `meta.notes` explains freshness and completeness.
- Academic text filters are exact/case-sensitive after trimming and whitespace normalization; prefixes are uppercased. Clubs alone support fuzzy keyword search. No casing retries, catalog guessing, or broad fallback scans.

## course_search — academics

Required: `subject_prefix` (1–8 characters; letters/digits, spaces, `&`, `-`).

Optional: `course_number` (1–12), `catalog_year` (1–24, passed unchanged apart from whitespace), `school` (1–60), `class_level` (1–40), `limit` (default 10, max 20), `cursor`.

Route: `GET /course` with exact filters and `offset`. Rows: `id`, `code`, `title`, `credit_hours`, `catalog_year`. Different catalog years can produce different IDs for the same code.

Example: `{"subject_prefix":"CS","course_number":"1336","limit":5}`.

## course_get — academics

Required: `course_id` (24 hexadecimal characters).

Route: `GET /course/{id}`. Returns catalog metadata, description, enrollment requirements, bounded prerequisite/corequisite trees and section count from that same response. It does not expand sections or silently choose a newer catalog record.

## section_search — academics

Provide an exact course pair (`subject_prefix` 1–8 plus `course_number` 1–12), an exact instructor pair (`first_name` plus `last_name`, each 1–64), or both.

Optional: `term` (2–24), `limit` (default 10, max 25), `cursor`. Terms accept `26S`, `26U`, `26F`, four-digit-year equivalents, or `Spring 2026`/`Summer 2026`/`Fall 2026`.

Routes: `/course/sections/trends`, `/professor/sections/trends`, or `/combined/sections/trends`. One response embeds instructor and course summaries; local filtering/sorting/paging adds no per-section requests. Rows include ID, course, section, term, mode, meetings and instructors.

Trends is derived and can lag; empty results do not prove a class is not offered. No live seat-count or waitlist claims. Available indexed terms appear in metadata.

Example: `{"subject_prefix":"CS","course_number":"1336","term":"26F"}`.

## section_get — academics

Required: `section_id` (24 hex).

Routes: `/section/{id}` and `/section/{id}/professors`. Returns term dates, course reference, instruction mode, core flags, syllabus, meetings, instructors, and TA names/roles (no TA emails). Grade fields are not required for schedule discovery; use `grades_get` for grades.

## professor_search — academics

At least one of `first_name` or `last_name` (each 1–64). Optional `limit` (default 10, max 20), `cursor`.

Route: `GET /professor` with exact names and `offset`. Rows: ID, full name, titles, email and office. Whitespace-only names fail rather than dropping name scoping.

## professor_get — academics

Required: `professor_id` (24 hex).

Route: `/professor/{id}`. Returns bounded directory contacts, office, office hours, profile link, total indexed section count and a small ID sample. No automatic course expansion.

## grades_get — academics

Choose exactly one ID (`course_id`, `professor_id`, `section_id`, each 24 hex), **or** exact filters. Never mix ID and filter targets.

Filters:

- `subject_prefix` (1–8), optionally `course_number` (1–12), then optionally `section_number` (1–12).
- One or both of `first_name`, `last_name` (each 1–64), alone or alongside course filters.
- Number requires prefix; section requires prefix+number. Prefix alone is allowed.

Options:

- `by`: `overall` (default), `term`, or `term_section_type`.
- ID targets support **overall only** and no term filtering.
- `terms`: 1–6 term strings (each 2–24), only for grouped term modes.
- `limit`: default 12, max 40 term rows. `cursor` is only valid in term modes.

Routes: ID `/grades` endpoints or `/grades/overall`, `/grades/semester`, `/grades/semester/sectionType`. Returns labelled counts, total observations and explicit scope. Per-term rows are newest first; section-type rows retain all 15 currently supported groups. Unexpected additional groups are explicitly marked truncated with `group_count`.

Bucket order: `A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F, W`. Exactly 14 nonnegative integer buckets are required. All zeros mean no observations, not proof of an existing/missing entity. No GPA or instructor ranking.

Name filters can merge homonyms. Course filters can combine cross-listed/renumbered data through internal course numbers. ID targets scope to their supplied entity. Historical grades do not establish current teaching availability.

Example: `{"subject_prefix":"CS","course_number":"1336","by":"term","terms":["26S","26U"]}`.

## academic_calendar_get — academics

Optional `term` (2–24), with the same term formats as sections. Omitted uses `/academicCalendars/current`; otherwise `/academicCalendars/{term}`.

Returns sessions, registration/drop deadlines, exams, closings and official source URL. Dates remain upstream text, without timezone conversion or invented times. The server does not derive the current term from the wall clock or certify freshness of the upstream marker. Session reductions are marked truncated and include original `session_count`; consult the source URL for the complete calendar.

## club_search — clubs

Required `query` (1–120 characters; must retain at least two letters/digits after removing SQL-LIKE wildcards/backslashes). Optional `limit` (default 5, max 15), `cursor`.

Route: `/club/search?q=…`. Preserves fuzzy upstream ranking and pages locally. Returns ID, slug, name, tags, summary and update time. Upstream search **404** or null list becomes empty matches; authentication and other errors are not suppressed.

Example: `{"query":"robotics","limit":5}`.

## club_get — clubs

Required `club_id` (1–128-character opaque path-safe identifier, **not a slug**). IDs may be numeric but need not be MongoDB IDs.

Route: `/club/{id}`. Returns description, tags, contacts, officers and update time. No approval/active-status guarantee. Links are data only; no contacts are messaged or opened. Getter 404 remains `NOT_FOUND`.

## campus_events_on_date — events (opt-in)

Required real `date` (`YYYY-MM-DD`, year 2000–2100). Optional `building`, `room` (each 1–60 path-safe characters; room requires building), `query` (1–80), `limit` (default 15, max 50), `cursor`.

Route: `/calendar/{date}[/{building}[/{room}]]`. One response is flattened and optionally filtered locally (case-insensitive keyword). Rows: title, start/end, location, types, tags, link and bounded description. Contact email/phone are omitted. This is Comet Calendar, not class meetings or a verified booking feed. Empty may mean not indexed.

Enable with `NEBULA_MCP_TOOLSETS=academics,clubs,events`.

## Errors

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid types, unknown properties, bounds or combinations; no upstream request |
| `NOT_FOUND` | Upstream 404, except the club-search empty-match case |
| `AUTH_MISSING` | No `NEBULA_API_KEY`; no upstream request |
| `AUTH_REJECTED` | Upstream 401/403 |
| `RATE_LIMITED` | Upstream 429 after bounded retry or long Retry-After |
| `UPSTREAM_TIMEOUT` | Attempt or total time budget exhausted |
| `UPSTREAM_ERROR` | Other upstream/network failure or refused redirect |
| `UPSTREAM_SCHEMA` | Unexpected envelope or payload shape |
| `RESPONSE_TOO_LARGE` | Streaming body or complete tool output exceeded its budget |
| `CANCELLED` | Caller cancelled |
| `UNSUPPORTED` | Reserved for unsupported capabilities |

Errors never echo rejected input values, upstream internals or runtime credentials. Strict schemas remain visible for model discovery, but handler validation runs inside the bounded error boundary instead of the high-level SDK's unbounded enum-error formatter.
