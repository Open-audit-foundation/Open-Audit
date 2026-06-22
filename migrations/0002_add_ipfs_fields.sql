-- Add IPFS offloading support to the Event table.
--
-- Complex contracts can emit massive text payloads (JSON blobs, IPFS hashes,
-- DAO proposal text). This migration adds columns to store IPFS CID pointers
-- when bloated metadata (>2KB) is offloaded to a local IPFS node.
--
-- The `ipfs_cids` column stores the list of CIDs for offloaded topics/data.
-- When data or topics contain an "ipfs:<cid>" pointer, the frontend resolves
-- it asynchronously via /api/ipfs/resolve.

BEGIN;

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "ipfsCids" JSONB DEFAULT NULL;

-- Allows fast lookup of events that have offloaded IPFS content
CREATE INDEX IF NOT EXISTS idx_event_ipfs_cids
  ON "Event" ("ipfsCids")
  WHERE "ipfsCids" IS NOT NULL;

COMMIT;
