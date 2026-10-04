# WASM sandbox (community parsers)

Implements [issue #405](https://github.com/Open-audit-foundation/Open-Audit/issues/405):
an untrusted-code execution boundary for community-contributed contract parsers.

- **Threat model:** [`WASM_SANDBOX_ARCHITECTURE.md`](./WASM_SANDBOX_ARCHITECTURE.md)
- **Author guide:** [`COMMUNITY_PARSER_GUIDE.md`](./COMMUNITY_PARSER_GUIDE.md)
- **Runner:** `WasmSandboxRunner` in `runner.ts` (worker isolation, host-capped memory)
- **Tests:** `npm run test:wasm`

Native TypeScript blueprints remain the reviewed path. Community parsers are
labeled `parserProvenance: "community-wasm"` on `TranslatedEvent`.
