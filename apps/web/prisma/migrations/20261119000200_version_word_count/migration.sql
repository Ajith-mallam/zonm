-- Word count per document version, so redactions and partial exclusions
-- change the counted known writing. Document.wordCount now tracks the
-- current (latest) version.
ALTER TABLE "DocumentVersion" ADD COLUMN "wordCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing originals. DocumentVersion is append-only, so the guard
-- trigger is lifted for this one statement inside the migration transaction.
ALTER TABLE "DocumentVersion" DISABLE TRIGGER document_version_immutable;
UPDATE "DocumentVersion" v SET "wordCount" = d."wordCount"
  FROM "Document" d WHERE d.id = v."documentId" AND v.version = 1;
ALTER TABLE "DocumentVersion" ENABLE TRIGGER document_version_immutable;
