DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'LegalRuleLifecycleStatus'
  ) THEN
    CREATE TYPE "LegalRuleLifecycleStatus" AS ENUM (
      'DRAFT',
      'APPROVED',
      'REJECTED',
      'SUPERSEDED'
    );
  END IF;
END $$;

ALTER TABLE "LegalRuleCatalogVersion"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "LegalRuleLifecycleStatus" USING "status"::"LegalRuleLifecycleStatus",
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "LegalCorpusVersion"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "LegalRuleLifecycleStatus" USING "status"::"LegalRuleLifecycleStatus",
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "CorpusApprovalRecord"
ALTER COLUMN "status" TYPE "LegalRuleLifecycleStatus" USING "status"::"LegalRuleLifecycleStatus";

ALTER TABLE "LegalRule"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "LegalRuleLifecycleStatus" USING "status"::"LegalRuleLifecycleStatus",
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "RuleApprovalRecord"
ALTER COLUMN "status" TYPE "LegalRuleLifecycleStatus" USING "status"::"LegalRuleLifecycleStatus";
