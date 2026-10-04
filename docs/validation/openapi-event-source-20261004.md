# OpenAPI event-source response validation

This continuation of #416 permits the existing legacy `source: null` value in the
shared Event enum. The list/search handlers and Prisma model are unchanged.
`live` and `historical` remain the only non-null source values described.

## Observed execution

Base: `52ea15328c8c90a36b7655fc632b8756108afb8e`.
Execution candidate: `0e54f7bbae2f6385b605002fe3c37f5e45bec55f`.
[Functional run](https://github.com/woahwhattheheck/Open-Audit/actions/runs/37200083718).

The repository's unchanged lockfile was installed with `npm ci --no-audit --no-fund`.
Node 22.23.3, npm 10.9.9, Vitest 3.2.7, Ajv 8.20.0 and
openapi-schema-validator 12.1.3 were used with the maintained Vitest configuration.

With the new response tests and the original schema, both cases failed specifically
at `/events/0/source`, schema path `#/components/schemas/Event/properties/source/enum`:
`must be equal to one of the allowed values` (allowed values: live, historical).
After restoring the corrected schema, the following selection passed **21 tests,
zero failures and zero pending tests**:

```sh
npm exec -- vitest run \
  lib/openapi/__tests__/event-responses.test.ts \
  lib/openapi/__tests__/openapi-spec.test.ts \
  app/api/v1/events/export/route.test.ts \
  --maxWorkers=1 --reporter=json --outputFile=after.json
```

The selection contains two new list/search cases, nine maintained OpenAPI
validator/drift cases, and ten maintained export cases. This also executes the
previously unrun populated/empty JSON-export schema regressions from the base.

The new cases call the actual NextRequest/NextResponse handlers and obtain their
schema from the actual public OpenAPI handler. Database/authentication collaborators
are controlled. Both endpoints preserve null/live/historical sources; the validator
still rejects unknown source strings and numeric sources. Date-time format
validation is outside these new cases (`validateFormats: false`); the existing
OpenAPI 3.0 document validator remains in the selection.

## Formatting and evidence boundaries

The functional run's overall conclusion is failure because its subsequent Prettier
check flagged a line wrap in the new test. The
[formatting follow-through](https://github.com/woahwhattheheck/Open-Audit/actions/runs/37200309557)
ran Prettier 3.9.6 write/check successfully on the final files. Its overall conclusion
is also failure: a follow-up byte-for-byte emitted-JavaScript comparator treated
that whitespace difference as a change. The recovered before/after files differ
only by collapsing the request-options ternary from three lines to one. Independent
TypeScript 5.8.3 parsing found zero diagnostics and identical complete syntax trees
including token text, excluding positions/trivia. No functional test was rerun for
that whitespace-only edit. An earlier formatting workflow was rejected before
execution due to its runner-context placement; no success is claimed for it.

Final schema blob: `6943a93df69411a83952c95788685cc42e8cc658`.
Executed test blob: `0d887beac72ff40bfab7f20eb90d166ecf73c803`.
Final formatted test blob: `da9c10629ea42d47b394dc79a1d42eaf34c24da2`.
Unchanged lockfile blob: `9070aa448cbf0b6ace17370567b80a2ae35732cc`.
Normalized before/after syntax-tree SHA256:
`3fef9b67c2759f643038e73e14fcf781fc71587c472d53a5ba5e5bd4e9bddf14`.

Raw functional artifact `11302487237` (8 files, 4690-byte ZIP) was downloaded and
verified: SHA256 `a1bf67257164efa7e0196de7d599dac5f9f6ce5a42273b918ffe5aca672f34f4`.
Its before.json SHA256 is `32b85e41d6b76f7cbd2cb88ffcd2a0d59a9a366270adef03f5ecb409d7c6dcb3`;
after.json SHA256 is `d6bee0c0e61d1cdcaa0f8539d1d5ccf1ed8c1c6c06f866a9bd6fad9299ea793e`.
Formatted-source artifact `11302194483` (2969-byte ZIP) was also downloaded and
verified: SHA256 `31915911013447b5964bcd423655486221f0f7535bb4b89821c512f7a301961e`.
Hosted artifacts have seven-day retention. The original validation workflow is
isolated from the contribution branch and is not part of this change.

No full-suite, full application typecheck/build, live database, deployed Swagger
browser, authentication, upstream CI approval or maintainer-acceptance result is
asserted by this focused continuation. Earlier build results retain their own source
identity. The original PR, branch and contributor are preserved.
