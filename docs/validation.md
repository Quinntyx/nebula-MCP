# v0.1 validation

## Review and remediation

An independent Sol review of implementation commit `45bc2ff` requested changes. The subsequent fixes were made by the maintainer, not represented as a second independent approval.

| Review issue | Resolution / regression coverage |
| --- | --- |
| Node 24 directory test discovery | Explicit `dist/test/*.test.js`; clean Node 22 and 24 checks |
| Null upstream empty lists | List routes normalize null; details still fail closed; terminal pagination tested |
| Runtime/reflected credentials in output | Redaction on the actual MCP boundary; official SDK client tests, including quotes/backslashes |
| SDK enum validation bypassing error budget | Strict published schemas with manual validation inside the low-level SDK server handler |
| Metadata/errors outside hard byte budget | Complete serialized MCP results capped, including UTF-8/escaping overhead |
| Club-search 404 | Search-only empty-match normalization; getter/auth errors remain errors |
| Oversized first-row dead end | Bounded field mapping or explicit error; never nonadvancing empty success |
| Lost nested grade/calendar data | All 15 supported grade groups retained; calendar/group truncation marked with original counts |
| Requirement sibling budget | Omitted siblings and clipped text set the truncation flag |
| Whitespace name scoping | Blank text rejected without an unscoped request |

Additional checks cover empty grade arrays on future sections, multi-byte budget paging without skipped rows, compact descriptions (at most 160 characters), strict model-visible schemas, fixed-origin GET requests, redirects, streaming size bounds, timeouts, cancellation, retries, grade buckets and source mappings.

Zod was upgraded to pinned `4.6.7` to address the dependency advisory found during review. The runtime dependency audit reports zero known vulnerabilities at validation time.

## Initial offline checks

- Host: Node `26.10.0`, `npm run check`.
- Clean ephemeral container: Node `22.23.5`, `npm ci --ignore-scripts`, `npm run check`, runtime dependency audit.
- Clean ephemeral container: Node `24.22.3`, the same install/check/audit.
- **109 tests passed on each runtime**, with zero failures or cancelled tests.
- Stdio subprocess and official MCP SDK in-memory client integration tests are included.

These initial fixtures were synthetic; no authenticated production requests or real API key were involved in that phase. Client registration and registry publication remain deliberately outside this build.

## Authenticated production validation — 2026-11-17 (America/Chicago)

Opt-in live testing used a securely supplied API key and the official MCP SDK client over a real stdio subprocess. All 11 tools, including opt-in events, returned real data. No credentials or authenticated response dumps were saved in this repository; the reusable suite emits only sanitized status/timing/count summaries.

Live testing found three issues, fixed in separate commits with synthetic regression tests:

| Finding | Fix |
| --- | --- |
| Room-specific calendar responses omit the parent building, causing legitimate location-filtered events to disappear | Preserve requested building/room context when omitted upstream |
| The production API gateway rejects invalid keys with HTTP 400 rather than 401/403 | Recognize only its structured invalid-key diagnostic as `AUTH_REJECTED`; generic/malformed 400s remain upstream errors; keep bounded body handling |
| An unchanged valid `/combined/sections/trends` query alternated between empty and populated results (including a direct upstream reproduction) | Avoid that index: fetch course Trends once and apply exact instructor matching locally; disclose the route choice in metadata |

After those fixes, the default CS 1337 live run passed **62 checks, zero failed/skipped**, covering **95 tool calls** and **81 upstream attempts reported by successful calls**. The largest complete MCP result in that run was **7,426 UTF-8 bytes**, below the 12,000-byte ceiling. A second full run with MATH 2413 as the primary course also passed all 62 checks with 95 calls and 81 reported upstream attempts; its largest response was **7,543 bytes**. Both runs included five repeated combined-section requests with consistent nonempty results after the route change.

Coverage includes every advertised tool, current and explicit calendar lookup, discovered-ID detail lookups, populated and genuinely empty searches, course catalog/school/class-level filters, professor/course/combined section scopes, term normalization, continuation and changed-filter rejection, all grade-target/filter families and grouping modes, fourteen-bucket totals and section-type reconciliation, club search/get/wildcard/no-match behavior, date/building/room/text event filters, maximum list limits, not-found and invalid-argument cases, and deliberately invalid credentials. Representative course checks cover CS 1336, 1337, 2336, 3345, MATH 2413 and PHYS 2325.

The post-fix offline suite passes **114 tests on each of Node 22.23.5, 24.22.3 and host 26.10.0**, with zero failures/cancellations. Clean Node 22/24 containers performed `npm ci --ignore-scripts`, `npm run check` and runtime dependency audits; both audits, and the host runtime audit, found zero vulnerabilities. The script's missing-key guard was also verified to exit 2 without starting the MCP client. Reproduce the opt-in run with `npm run test:live`; environment overrides are documented in the README. Neither normal tests nor CI use a key or contact production.

This verifies the exercised behavior and that the supplied key could access those routes at that time. It does not guarantee future availability, production-wide permissions, catalog coverage or freshness, absence of upstream paging drift, or correctness for every possible input/data combination. Trends and calendars remain upstream indexes, not current registration authorities.
