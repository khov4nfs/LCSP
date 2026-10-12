-- Active terminology for the shared Compliance Rule Set lifecycle.
--
-- Tables, columns and enum TYPE names keep their historical physical spelling (the Prisma models
-- map to them with @@map/@map), so no table, column or constraint is renamed and no data moves.
-- Only closed enum VALUES that carried the retired vocabulary are renamed in place; PostgreSQL
-- keeps every stored row and every CHECK/trigger that references them.

ALTER TYPE "BlockerReason"
  RENAME VALUE 'LEGAL_PORTFOLIO_UNAVAILABLE' TO 'COMPLIANCE_RULE_SET_UNAVAILABLE';

ALTER TYPE "LegalPortfolioCoverageState"
  RENAME VALUE 'COVERED_BY_ENGINEERING_RULES' TO 'COVERED_BY_ASSESSMENT_RULES';

ALTER TYPE "LegalPreparationFailureReason"
  RENAME VALUE 'PORTFOLIO_VALIDATION_FAILED' TO 'RULE_SET_VALIDATION_FAILED';
ALTER TYPE "LegalPreparationFailureReason"
  RENAME VALUE 'CORPUS_UNAVAILABLE' TO 'SOURCE_VERSION_UNAVAILABLE';

ALTER TYPE "AuditResourceType"
  RENAME VALUE 'LEGAL_PORTFOLIO_VERSION' TO 'COMPLIANCE_RULE_SET_VERSION';
ALTER TYPE "AuditResourceType"
  RENAME VALUE 'LEGAL_CORPUS_VERSION' TO 'LEGAL_SOURCE_VERSION';

ALTER TYPE "OutboxAggregateType"
  RENAME VALUE 'LEGAL_PORTFOLIO_VERSION' TO 'COMPLIANCE_RULE_SET_VERSION';
ALTER TYPE "OutboxAggregateType"
  RENAME VALUE 'LEGAL_CORPUS_VERSION' TO 'LEGAL_SOURCE_VERSION';

-- Undelivered messages keep flowing under the renamed routing keys. Published history is untouched.
UPDATE "OutboxMessage"
SET "eventType" = 'command.compliance-rule-set.preparation.requested.v1'
WHERE "eventType" = 'command.legal-portfolio.preparation.requested.v1'
  AND "status" IN ('PENDING', 'FAILED', 'DLQ');

UPDATE "OutboxMessage"
SET "eventType" = 'event.compliance-rule-set.activated.v1'
WHERE "eventType" = 'event.legal-portfolio.activated.v1'
  AND "status" IN ('PENDING', 'FAILED', 'DLQ');

UPDATE "OutboxMessage"
SET "eventType" = 'event.compliance-rule-set.validation-failed.v1'
WHERE "eventType" = 'event.legal-portfolio.validation-failed.v1'
  AND "status" IN ('PENDING', 'FAILED', 'DLQ');
