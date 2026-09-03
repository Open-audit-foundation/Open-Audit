-- Full-text search support for the Event table (issue #409).
--
-- Adds a maintained tsvector column built from description (weight A),
-- eventType (weight B) and blueprintName (weight C), plus a GIN index so
-- search scales with table size instead of full-table ILIKE scans.
--
-- The vector is kept fresh by a BEFORE INSERT/UPDATE trigger, and existing
-- rows are backfilled below, so the migration works on top of existing data.

ALTER TABLE "Event" ADD COLUMN "searchVector" tsvector;

UPDATE "Event"
SET "searchVector" =
    setweight(to_tsvector('english', coalesce("description", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("eventType", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("blueprintName", '')), 'C');

CREATE INDEX "Event_searchVector_idx" ON "Event" USING GIN ("searchVector");

CREATE OR REPLACE FUNCTION "Event_searchVector_update"() RETURNS trigger AS $$
BEGIN
    NEW."searchVector" :=
        setweight(to_tsvector('english', coalesce(NEW."description", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW."eventType", '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW."blueprintName", '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Event_searchVector_trigger"
BEFORE INSERT OR UPDATE OF "description", "eventType", "blueprintName"
ON "Event"
FOR EACH ROW
EXECUTE FUNCTION "Event_searchVector_update"();
