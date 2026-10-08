-- W6: a re-evaluation batch is a run in the same ledger as the cutover, but a different kind.
-- Its own migration so the new enum value is committed before any later migration or query uses it.
ALTER TYPE "LegacyMigrationRunKind" ADD VALUE 'REEVALUATION';
