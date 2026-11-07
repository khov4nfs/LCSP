-- A null prefix preserves the historical whole-repository scope. New scoped
-- snapshots keep original repository-relative paths while authorizing one directory.
ALTER TABLE "RepositorySnapshot"
  ADD COLUMN "sourcePathPrefix" TEXT;

ALTER TABLE "RepositorySnapshot"
  ADD CONSTRAINT "RepositorySnapshot_sourcePathPrefix_canonical_check"
  CHECK (
    "sourcePathPrefix" IS NULL
    OR (
      char_length("sourcePathPrefix") BETWEEN 1 AND 1024
      AND "sourcePathPrefix" = btrim("sourcePathPrefix")
      AND "sourcePathPrefix" !~ '^[[:space:]]|[[:space:]]$'
      AND "sourcePathPrefix" !~ '[[:cntrl:]]'
      AND "sourcePathPrefix" !~ '(^/|/$|//|(^|/)[.]{1,2}(/|$))'
      AND position(chr(92) IN "sourcePathPrefix") = 0
      AND position(':' IN "sourcePathPrefix") = 0
      AND position('%' IN "sourcePathPrefix") = 0
    )
  );

CREATE FUNCTION enforce_repository_snapshot_source_scope_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $source_scope_guard$
BEGIN
  IF NEW."sourcePathPrefix" IS DISTINCT FROM OLD."sourcePathPrefix" THEN
    RAISE EXCEPTION 'Repository snapshot source scope is immutable';
  END IF;
  RETURN NEW;
END;
$source_scope_guard$;

CREATE TRIGGER "RepositorySnapshot_source_scope_immutable"
BEFORE UPDATE OF "sourcePathPrefix" ON "RepositorySnapshot"
FOR EACH ROW
EXECUTE FUNCTION enforce_repository_snapshot_source_scope_immutable();
