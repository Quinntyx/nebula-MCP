# v0.1 interface contract

## Decision

Build a read-only TypeScript MCP server using the official MCP SDK and stdio. Use separate, discoverable domain tools, not a generic API/MongoDB/HTTP dispatcher. Runtime credentials come only from `NEBULA_API_KEY`. The executable is `nebula-mcp`; the server identifies itself as `utd-nebula`. The client owns direct/deferred/codemode exposure; this server does not modify client settings.

This contract combines an independent Opus interface proposal with source verification and a second design pass. Accepted: small domain tools, exact-match semantics, Trends section queries, academic-calendar resolution, bounded summaries, opaque filter-bound cursors. Tightened: ID-only getters (no implicit newest-catalog selection); no automatic title-casing retries; no hidden multi-page fallback scans; unknown pagination is explicit; no unverified GPA calculations. Events are opt-in.

## Evidence

Reviewed 2026-11-16 against public production Swagger v1.3.0 and upstream source:

- [Production Swagger](https://api.utdnebula.com/swagger/index.html), machine-readable `/swagger/doc.json`.
- [Nebula API source at be330706](https://github.com/UTDNebula/nebula-api/tree/be330706fa57d01bb694d5856a3a2ca5c42b30b1).
- Route/controller/schema/config evidence: `rest/controllers/{course,section,professor,trends,grades,club,calendar,academic_calendars}.go`, `rest/schema/{objects,filter}.go`, `rest/configs/setup.go`.
- [UTD Trends at 46f5e3a3](https://github.com/UTDNebula/utd-trends/tree/46f5e3a3dda25310e899e9982b276aaa97b0e815): `src/modules/semesters.ts` confirms `S`, `U`, `F` and their order; `src/components/common/SingleGradesInfo/SingleGradesInfo.tsx` confirms the 14 grade labels below.

Source verification is not an authenticated production smoke test. Keep live-data coverage/freshness uncertainty documented. Do not vendor authenticated responses or private data.

## Tool inventory

Default toolsets: `academics,clubs`. Optional: `events`. `NEBULA_MCP_TOOLSETS` may select a nonempty comma-separated subset; reject unknown values. Academics includes academic calendars. No separate discovery/help tool or large server instruction block is needed. Descriptions should normally fit within 160 characters and be keyword-rich.

| Tool | Arguments | REST route | Output |
| --- | --- | --- | --- |
| `course_search` | required `subject_prefix`; optional `course_number`, `catalog_year`, `school`, `class_level`, `limit`, `cursor` | `/course` with exact filters, `offset` | ID, code, title, credit hours, catalog year |
| `course_get` | `course_id` | `/course/{id}` | Course detail, bounded description, prerequisite/corequisite structures, enrollment requirements; relation IDs counted or capped |
| `section_search` | paired `subject_prefix` + `course_number` and/or paired `first_name` + `last_name`; optional `term`, `limit`, `cursor` | `/course/sections/trends`, `/professor/sections/trends`, or `/combined/sections/trends` | ID, course code, section, term, mode, meetings, professor IDs/names |
| `section_get` | `section_id` | `/section/{id}` and `/section/{id}/professors` | Meetings, instructors, syllabus, core flags, TAs (name/role only), course reference |
| `professor_search` | at least one of `first_name`, `last_name`; optional `limit`, `cursor` | `/professor` exact-name filters and `offset` | ID, name, titles, email, office |
| `professor_get` | `professor_id` | `/professor/{id}` | Office, office hours, email, profile, bounded section references/count; no automatic course expansion |
| `grades_get` | exactly one ID (`course_id`, `professor_id`, `section_id`) OR filter fields (`subject_prefix`, `course_number`, `section_number`, `first_name`, `last_name`); optional `by` (`overall` default, `term`, `term_section_type`), `terms`, `limit`, `cursor` | ID `/grades` routes OR `/grades/overall`, `/grades/semester`, `/grades/semester/sectionType` | Labelled grade counts, total observations, explicit aggregation scope and historical-data notes |
| `academic_calendar_get` | optional `term` | `/academicCalendars/current` or `/{term}` | Term/timeline, sessions and key dates, official source URL |
| `club_search` | `query`; optional `limit`, `cursor` | `/club/search?q=` | ID, slug, name, tags, short description, updated-at |
| `club_get` | `club_id` | `/club/{id}` | Description, tags, contacts, officers, updated-at |
| `campus_events_on_date` (opt-in events toolset) | required `date` YYYY-MM-DD; optional `building`, `room` (requires building), `query`, `limit`, `cursor` | `/calendar/{date}[/{building}[/{room}]]` | Flattened compact calendar events: title, start/end, location, type, URL; omit contact email/phone |

All schemas reject extra properties and invalid argument combinations. Do not accept raw query objects, URLs, headers, regular expressions, `$` operators, or mutation options. Course prefix is uppercased. Exact names and other string filters are otherwise preserved. Catalog year is a bounded string (1–24 characters), passed unchanged apart from whitespace normalization because the production format remains unverified (it may be a year or catalog-year range). Mongo IDs are exactly 24 hex digits. Club IDs are opaque bounded path-safe strings (not assumed Mongo IDs or slugs). Reject path separators, percent escapes and dot segments in path arguments. Validate real calendar dates.

Terms accept canonical `26S`, `26U`, `26F`, four-digit equivalents, or unambiguous English season/year (e.g. Spring 2026); return canonical IDs. Never infer a current term/catalog from the wall clock. `academic_calendar_get` trusts only the upstream `current` marker, reports that source, and does not certify its freshness.

Grades filters must match the upstream switch: prefix alone; prefix+number; prefix+number+section; professor name; prefix+professor; prefix+number+professor; prefix+number+section+professor. Professor means one or both supplied name fields (record that homonyms merge). Number requires prefix; section requires prefix+number. ID queries support `by=overall` only and must reject term filtering instead of silently ignoring it. Filters with term filtering require term grouping. Mixed ID/filter targets are invalid.

Grade order, verified from the official Trends frontend: `A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F, W`. Require exactly 14 finite nonnegative integer buckets. An all-zero distribution means no observations, not proof of an existing entity. No GPA/"easy professor" ranking in v0.1. Name aggregation can merge homonyms; course filters can include cross-listed/renumbered data through internal course number. Include these limitations in appropriate notes. By-term data defaults to 12 rows, maximum 40, newest first.

## Pagination and output budgets

- Defaults/max: course/professor 10/20; sections 10/25; clubs 5/15; grades by term 12/40; events 15/50.
- Course/professor API page size is server-configured (`LIMIT`, default 20), not client-controllable; it exposes no total or stable sort. Use ONE upstream page per search call, starting at the cursor offset. Do not send an invented `limit` parameter. Never automatically fill from multiple upstream pages.
- Consume only the rows actually emitted. Advance raw offset by rows emitted, NOT all rows fetched, so smaller output pages or response-budget trimming do not skip data.
- Do not infer page size or exhaustion from a short nonempty upstream page. `has_more=true` when known unreturned rows exist in that response; `null` when more data is unknown; `false` only after an empty response. A nonempty page always has a continuation cursor. Document that a terminal empty call may be required and offsets can drift during upstream updates.
- Trends/clubs/events/term-grades return complete upstream result sets (within the transport byte limit). Filter and deterministically sort/page locally. Preserve club ranking. Here exhaustion is known, so `has_more` is boolean. Re-fetch on continuation rather than building an unbounded cache; note changes may affect paging.
- Cursors are versioned base64url JSON containing tool name, normalized filter hash, and nonnegative safe bounded offset. Validate length/shape/version/offset and binding. They are pagination state, not auth. Changing a filter/tool invalidates the cursor. Limit need not be bound. No user-supplied URL or arbitrary path in cursors.
- Target ~6,000 characters per tool result, hard maximum 12,000 UTF-8 bytes including metadata/errors. Trim fields/collections and then rows, adjusting continuation correctly. Do not substring serialized JSON. Every truncation must be visible. If one detail cannot fit after safe field bounds, return a bounded structured error rather than malformed/lossy JSON with silent omissions.
- Summary description: course/club 200 chars; detail description course 1,200, club 1,500. Prerequisites must retain meaningful AND/OR structure with explicit truncation; bounded nested structures are fine (do not invent a lossy renderer). Bound all strings/arrays and nested responses, including metadata and academic calendar sessions.
- Success: one minified JSON text block `{ok:true,data:...,meta:{source,fetched_at,requests,notes,...}}`. Lists expose `items`, `returned`, `has_more`, `next_cursor`; truncation information is explicit. Do not duplicate results in `structuredContent` initially. Do not claim an API version if runtime has not checked it.
- Error: MCP `isError:true` and one bounded JSON block `{ok:false,error:{code,message,hint?,retryable,upstream_status?}}`. Codes include `INVALID_ARGUMENT`, `NOT_FOUND`, `AUTH_MISSING`, `AUTH_REJECTED`, `RATE_LIMITED`, `UPSTREAM_TIMEOUT`, `UPSTREAM_ERROR`, `UPSTREAM_SCHEMA`, `RESPONSE_TOO_LARGE`, `CANCELLED`, `UNSUPPORTED`.

## API limitations and non-goals

- Academic filters are exact and case-sensitive; clubs alone support fuzzy search. Reject/strip SQL LIKE wildcards in club queries and require at least two actual letters/digits to avoid broad accidental downloads. Upstream club-search 404 means empty matches; getter 404 remains NOT_FOUND. Do not assert club approval/active status.
- Trends is a derived dataset and may lag. Empty sections for a term do not prove that no courses are offered. Report actual available terms/source. No automatic fallback scan (source aggregation-offset handling appears inconsistent and multi-page scans are both costly and potentially incomplete).
- Dates returned by academic calendars should retain upstream meaning/timezone rather than being shifted to UTC/invented times. Empty campus calendar results may mean not indexed. Only club-search 404 is automatically normalized to empty.
- Raw `/section` reference filtering is unsuitable: query parser constructs strings for ObjectID/date fields. Do not pretend `/section?course_reference=` provides correct course filtering.
- Do not expose `/all`, unbounded local fuzzy indexes, RMP scraping, GraphQL, storage, submissions, attendance, or writes. Do not call linked contact/syllabus URLs automatically. Do not label room bookings or class meetings as campus club events.

## Transport and security

Fixed origin `https://api.utdnebula.com`, GET only, explicit typed allowlisted routes/query builders, URLSearchParams and validated encoded segments; disable redirects so credentials cannot leak cross-origin. No runtime base-URL override (test via injected fetch only). API key appears solely in `x-api-key`; redact it and header-like secrets from errors/logs/provenance, including malicious reflected upstream strings. Never return raw upstream errors (may contain database internals), URLs with credentials, request headers, stack traces, or the key. No logs on stdout.

Use a 10-second per-attempt timeout and propagate MCP cancellation; bound total request time and at most one retry for 429/502/503/504 (honor bounded Retry-After without long waits). No auth/404/schema retries. Stream response bodies with a hard byte ceiling (e.g. 2 MiB), not just Content-Length checks. Bound all error bodies too. Missing key must not break discovery/initialize; tool calls return AUTH_MISSING without network access. Short server instructions and MCP readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=true annotations. No auto-fetch on initialize.

## Delivery and tests

Use minimal pinned runtime dependencies plus a committed lockfile; Node >=22. Standard scripts: build, typecheck, test, check. No registry publish or client registration. Document build/run and key environment variable, toolset selection, limitations and examples without real credentials/user-specific paths. CI validates on GitHub and Forgejo where practical using npm ci and offline checks, no key.

Tests: every tool's route/mapping and invalid inputs; strict schemas; unknown toolset rejection; periods/summer sorting; changed-filter cursors, malformed/oversized cursors; arbitrary upstream page sizes and terminal empty page; local paging; hard UTF-8 output cap with correct continuation; schema envelope/null data behavior; error mappings and redaction; redirect/URL confinement; size limits, timeout, cancellation, retry bounds; 14 bucket validation and historical semantics; club wildcard/404; optional event flattening and academic-calendar fixture; stdio initialize/list/call and stdout cleanliness using official SDK. All fixtures synthetic. Optional live smoke script must require NEBULA_API_KEY and never print or save key/response bodies. Live smoke is not required to build or run offline tests.

## Implementation notes (v0.1)

Where the contract left room or the SDK forced a choice, the implementation decided as follows:

- **Published schemas and validation are strict.** The official SDK's low-level server publishes strict JSON schemas, while each handler validates within our bounded error boundary. This avoids the high-level SDK validator echoing unbounded rejected enum values before the handler runs. Final tool results are redacted with the runtime key and budgeted including metadata and serialization overhead.
- **`course_search` accepts `catalog_year`, `school`, and `class_level`.** The table above lists them as optional; the upstream `/course` route exposes them as queryable exact fields, so they are forwarded verbatim and folded into the cursor fingerprint.
- **`meta.requests` counts reported HTTP attempts.** Successful repository calls include retries; a normalized club-search 404 counts once. Failed optional lookups can be omitted because their attempt count is discarded with the exception.
- **Grade id scopes are `by=overall` only.** Per-term aggregates require filter fields (`subject_prefix` + `course_number`, `first_name` + `last_name`), matching the upstream `/grades/semester*` routes, which are filter-keyed.
- **Output completeness is explicit.** Empty upstream list representations normalize to empty arrays only on list routes. All 15 currently supported grade section-type groups are preserved; unexpected extra groups, calendar session reductions, and nested collection caps disclose truncation. Oversized first rows fail instead of returning a nonadvancing empty page.
- **Two CI files.** `.github/workflows/ci.yml` and `.forgejo/workflows/ci.yml` run the same `npm ci` + `npm run check` ladder; both must stay in sync. Test file selection uses `dist/test/*.test.js` for Node 22/24 compatibility.
