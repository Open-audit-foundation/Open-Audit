-- Remove unused columns from the Event table.
--
-- The IPFS offloading system and reconciliation engine were both removed from
-- the codebase. The four columns they owned have no callers and create
-- unnecessary Prisma-generated types and database columns.
--
-- Removed columns:
--   ipfsCids      - IPFS offloading (removed subsystem)
--   rpcVerified   - Reconciliation engine (removed subsystem)
--   lastRpcCheck  - Reconciliation engine (removed subsystem)
--   discrepancies - Reconciliation engine (removed subsystem)

BEGIN;

ALTER TABLE "Event"
  DROP COLUMN IF EXISTS "ipfsCids",
  DROP COLUMN IF EXISTS "rpcVerified",
  DROP COLUMN IF EXISTS "lastRpcCheck",
  DROP COLUMN IF EXISTS "discrepancies";

COMMIT;
