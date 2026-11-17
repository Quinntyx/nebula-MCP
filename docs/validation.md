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

## Executed checks

- Host: Node `26.10.0`, `npm run check`.
- Clean ephemeral container: Node `22.23.5`, `npm ci --ignore-scripts`, `npm run check`, runtime dependency audit.
- Clean ephemeral container: Node `24.22.3`, the same install/check/audit.
- **109 tests passed on each runtime**, with zero failures or cancelled tests.
- Stdio subprocess and official MCP SDK in-memory client integration tests are included.

Fixtures are synthetic. No authenticated production requests were executed and no real API key was supplied. Production permissions, dataset coverage, freshness and exact catalog-year values remain live-smoke-test limitations, not implied by the offline suite. Client registration and registry publication are deliberately outside this build.
