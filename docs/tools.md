# Tool reference

Every tool is read-only, returns one minified JSON text block, and accepts strictly bounded arguments. Unknown properties are rejected before any network call. See [design.md](design.md) for the accepted contract and [../README.md](../README.md) for configuration and limits.

Common conventions:

- `limit` is a row count for this server, never an upstream page size. Upstream search pages are fixed by the API's own `LIMIT`; this server sends `offset` only and never invents `limit`.
- `cursor` is opaque. Pass `next_cursor` back verbatim; it is bound to the tool and a hash of the normalized filters, so changing a filter requires starting over.
- `has_more` is `true` when unreturned rows are known to exist, `null` when a non-empty page cannot prove exhaustion, and `false` only after an empty page.
- `meta.requests` counts upstream responses consumed by the call; `meta.notes` explains provenance, freshness, and truncation.

## course_search — academics

| Argument | Required | Type | Notes |
| --- | --- | --- | --- |
| `subject_prefix` | yes | string 1–8 | Trimmed and uppercased; `[A-Z0-9 &-]` only |
| `course_number` | no | string 1–12 | Exact, case-sensitive |
| `catalog_year` | no | string 1–24 | Exact, e.g. `2024-2025` |
| `school` | no | string 1–60 | Exact |
| `class_level` | no | string 1–40 | Exact, e.g. `Undergraduate` |
| `limit` | no | 1–25, default 10 | Rows returned locally |
| `cursor` | no | string ≤512 | Continuation token |

Route: `GET /course?subject_prefix=…&offset=…`. Result rows: `id`, `code`, `title`, `credit_hours`, `catalog_year`.

`has_more` is `null` on a non-empty page because the API exposes no totals and a short page does not prove exhaustion. A terminal empty page returns `has_more: false`.

## course_get — academics

| Argument | Required | Type |
| --- | --- | --- |
| `course_id` | yes | 24-hex upstream id |

Route: `GET /course/{id}` plus a bounded section-count lookup. Result: catalog metadata, `description`, a bounded prerequisite/co-requisite tree, and `section_count` with a small sample of section ids. Section records are counted, not expanded.

## section_search — academics

| Argument | Required | Type | Notes |
| --- | --- | --- | --- |
| `subject_prefix` + `course_number` | pair | strings | Exact course pair |
| `first_name` + `last_name` | pair | strings | Exact professor pair |
| `term` | no | string | `YY[SUF]`, four-digit, or `Fall 2026`; canonicalised |
| `limit` | no | 1–25, default 10 | |
| `cursor` | no | string ≤512 | |

Provide the course pair, the professor pair, or both. Routes: `/course/sections/trends`, `/professor/sections/trends`, or `/combined/sections/trends` — the Trends routes embed course and professor summaries, so one request covers the page. Result rows: `id`, `course`, `title`, `section`, `term`, `mode`, `meetings`, `professors`.

## section_get — academics

| Argument | Required | Type |
| --- | --- | --- |
| `section_id` | yes | 24-hex upstream id |

Routes: `GET /section/{id}` and `GET /section/{id}/professors`. Result: `term` (`id`, `name`, `start`, `end`), `section_number`, `course_id`, `instruction_mode`, `core_flags`, `syllabus_uri`, `meetings`, `professors`, `teaching_assistants`. Grade distributions are intentionally excluded; use `grades_get` with `section_id`.

## professor_search — academics

| Argument | Required | Type |
| --- | --- | --- |
| `first_name` | one of | string 1–40, exact |
| `last_name` | one of | string 1–40, exact |
| `limit` | no | 1–25, default 10 |
| `cursor` | no | string ≤512 |

Route: `GET /professor?first_name=…&last_name=…&offset=…`. Names are never title-cased or retried with different capitalization. Rows: `id`, `name`, `first_name`, `last_name`, `titles`, `email`, `office`.

## professor_get — academics

| Argument | Required | Type |
| --- | --- | --- |
| `professor_id` | yes | 24-hex upstream id |

Route: `GET /professor/{id}`. Result: contact details, `office`, `office_hours`, and a bounded `section_count`/`section_ids` sample. No automatic course expansion.

## grades_get — academics

| Argument | Required | Type | Notes |
| --- | --- | --- | --- |
| `course_id` / `professor_id` / `section_id` | one | 24-hex id | `by` must be `overall` for ids |
| `subject_prefix` + `course_number` | pair | strings | Exact |
| `section_number` | no | string | Requires the course pair |
| `first_name` + `last_name` | pair | strings | Exact, name-keyed aggregate |
| `by` | no | `overall` \| `term` \| `term_section_type` | Default `overall` |
| `terms` | no | string[] ≤12 | Only with `by=term*`; entries canonicalised |
| `limit` | no | 1–40, default 12 | Per-term rows, newest first |
| `cursor` | no | string ≤512 | |

Routes: `/course/{id}/grades`, `/professor/{id}/grades`, `/section/{id}/grades`, `/grades/overall`, `/grades/semester`, `/grades/semester/sectionType`.

Result: `by`, `scope`, `buckets` (or `terms[]` with `period`, `term`, `buckets`, `total`, and `groups[]` for section types), `total`. Buckets are the 14 verified Trends labels in order: `A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F, W`. An all-zero distribution means no recorded observations. No GPA and no instructor ranking is computed or implied.

Aggregates are complete upstream responses, so per-term `has_more` is exact.

## academic_calendar_get — academics

| Argument | Required | Type | Notes |
| --- | --- | --- | --- |
| `term` | no | string | Canonical `YY[SUF]`, four-digit year, or season + year |

Route: `GET /academicCalendars/current` when `term` is omitted, else `GET /academicCalendars/{id}`. Result: `id`, `timeline`, `sessions[]` with registration and drop deadlines, reading days, exams, closings, and `upstream_url`. Dates pass through as upstream text without timezone conversion.

Omitting `term` returns whatever the upstream API marks as current. The server never infers the term from the clock and cannot certify that the marker is fresh.

## club_search — clubs

| Argument | Required | Type | Notes |
| --- | --- | --- | --- |
| `query` | yes | string 2–80 | `%` and `_` removed; must keep ≥2 characters |
| `limit` | no | 1–25, default 10 | |
| `cursor` | no | string ≤512 | |

Route: `GET /club/search?q=…`. Upstream ranking is preserved; paging is local to the returned page. Rows: `id`, `slug`, `name`, `tags`, `summary`, `updated_at`. A `null` upstream result is treated as empty.

## club_get — clubs

| Argument | Required | Type |
| --- | --- | --- |
| `club_id` | yes | numeric upstream id |

Route: `GET /club/{id}`. Result: `description`, `tags`, `image`, `contacts[]`, `officers[]`, `updated_at`. Contact links are data only and are never opened.

## campus_events_on_date — events (opt-in)

| Argument | Required | Type | Notes |
| --- | --- | --- | --- |
| `date` | yes | `YYYY-MM-DD` | Real calendar date |
| `building` | no | string 1–20 | Exact upstream building code |
| `room` | no | string 1–20 | Requires `building` |
| `query` | no | string 1–80 | Local case-insensitive filter over title, description, tags, types, departments, building, room |
| `limit` | no | 1–50, default 15 | |
| `cursor` | no | string ≤512 | |

Route: `/calendar/{date}[/{building}[/{room}]]` — one request per call. Rows: `title`, `start`, `end`, `building`, `room`, `types`, `tags`, `url`, `description` (bounded). Contact email and phone are omitted.

Enable with `NEBULA_MCP_TOOLSETS=academics,clubs,events`.

## Errors

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Bounded argument violation, rejected before any request |
| `NOT_FOUND` | Upstream 404 for a specific id |
| `AUTH_MISSING` | `NEBULA_API_KEY` absent; no network call was made |
| `AUTH_REJECTED` | Upstream rejected the key (401/403) |
| `RATE_LIMITED` | Upstream 429 that survived the bounded retry |
| `UPSTREAM_TIMEOUT` | Attempt or total time budget exhausted |
| `UPSTREAM_ERROR` | Other upstream failure, including refused redirects |
| `UPSTREAM_SCHEMA` | Response shape did not match the expected schema |
| `RESPONSE_TOO_LARGE` | Body exceeded the streaming byte ceiling |
| `CANCELLED` | The caller cancelled the request |
| `UNSUPPORTED` | Upstream lacks the requested capability |
