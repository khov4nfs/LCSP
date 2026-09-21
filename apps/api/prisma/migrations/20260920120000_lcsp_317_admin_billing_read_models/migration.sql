-- Query-supporting indexes for bounded Admin billing reporting.
CREATE INDEX "PaymentTransaction_reconciliationStatus_reconciledAt_idx"
  ON "PaymentTransaction"("reconciliationStatus", "reconciledAt");

CREATE INDEX "PaymentTransaction_provider_receivedAt_idx"
  ON "PaymentTransaction"("provider", "receivedAt");

CREATE INDEX "PaymentTransaction_receivedAt_id_idx"
  ON "PaymentTransaction"("receivedAt", "id");

CREATE INDEX "CreditLedgerEntry_source_createdAt_idx"
  ON "CreditLedgerEntry"("source", "createdAt");
