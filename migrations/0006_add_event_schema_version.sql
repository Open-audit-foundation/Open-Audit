-- Add schemaVersion to the Event table.
--
-- translateEvent() already computes the version label of the blueprint
-- schema that translated an event (e.g. "v2", "1.0.0"), but the value was
-- discarded before reaching the database. Persisting it lets operators
-- audit which schema version processed a given event and query for events
-- that need re-translation after a blueprint bug fix.

BEGIN;

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT;

CREATE INDEX IF NOT EXISTS idx_event_schema_version
  ON "Event" ("schemaVersion");

COMMIT;
