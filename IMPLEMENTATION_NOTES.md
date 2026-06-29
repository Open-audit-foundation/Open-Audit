# Implementation Notes — Issue #231

**Issue:** feat(api): Add paginated REST endpoint for querying translated events by contract ID
**Upstream:** https://github.com/Open-audit-foundation/Open-Audit/issues/231

## Acceptance Criteria

Body:
Summary
Currently, the only way to consume translated events is via the live WebSocket feed. There is no way to query historical events by contract ID, time range, or event type via a REST API. This makes it impossible for external tools, dashboards, or scripts to integrate with Open-Audit without maintaining a persistent WebSocket connection.
Required work
New API route: app/api/events/route.ts
Implement a GET /api/events endpoint with the following query parameters:
ParameterTypeDescriptioncontractIdstringFilter by Stellar contract ID (required)pagenumberPage number, 1-indexed (default: 1)limitnumberResults per page, max 100 (default: 20)fromISO8601Filter events after this timestamp (optional)toISO8601Filter events before this timestamp (optional)eventTypestringFilter by event topic/type (optional)
Response shape:
json{
  "data": [
    {
      "id": "string",
      "contractId": "string",
      "raw": "0x...",
      "translated": "Public Key [G...] transferred 100 USDC to [G...]",
      "eventType": "transfer",
      "ledger": 12345678,
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 145,
    "hasNextPage": true
  }
}
Implementation details:

Query the Prisma database (schema already exists in prisma/) for stored events matching the filters
Apply input validation using Zod — reject invalid contractId format, out-of-range limit, invalid date strings
Return 400 with a structured error body for invalid i

---
_Delete this file before merging._