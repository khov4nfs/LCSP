DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'EvidenceAcceptanceStatus'
  ) THEN
    CREATE TYPE "EvidenceAcceptanceStatus" AS ENUM (
      'ACCEPTED',
      'REJECTED'
    );
  END IF;
END $$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'TechnicalEvidenceReport',
    'TechnicalProfile',
    'AIUsageFlow',
    'ClassificationResult',
    'LegalRuleMatch'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'status'
        AND udt_name <> 'EvidenceAcceptanceStatus'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN "status" DROP DEFAULT',
        target_table
      );

      EXECUTE format(
        $sql$
        ALTER TABLE %I
        ALTER COLUMN "status" TYPE "EvidenceAcceptanceStatus"
        USING (
          CASE UPPER("status"::text)
            WHEN 'ACCEPTED' THEN 'ACCEPTED'::"EvidenceAcceptanceStatus"
            WHEN 'REJECTED' THEN 'REJECTED'::"EvidenceAcceptanceStatus"
            ELSE 'ACCEPTED'::"EvidenceAcceptanceStatus"
          END
        )
        $sql$,
        target_table
      );

      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN "status" SET DEFAULT ''ACCEPTED''',
        target_table
      );
    END IF;
  END LOOP;
END $$;
