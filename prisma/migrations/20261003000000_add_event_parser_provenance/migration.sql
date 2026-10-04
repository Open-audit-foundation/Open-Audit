-- Retain parser trust metadata when translations are persisted and replayed.
-- Legacy rows remain NULL because their original parser cannot be inferred.
ALTER TABLE "Event"
ADD COLUMN "parserProvenance" TEXT,
ADD COLUMN "sandboxError" TEXT;
