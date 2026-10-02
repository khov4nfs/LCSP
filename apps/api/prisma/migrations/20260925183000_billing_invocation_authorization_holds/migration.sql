ALTER TABLE "BillingReservationInvocationClaim"
  ADD COLUMN "authorizedChargeCredits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "authorizationFingerprint" TEXT,
  ADD COLUMN "settledAt" TIMESTAMP(3);

CREATE INDEX "BillingReservationInvocationClaim_reservationId_settledAt_idx"
  ON "BillingReservationInvocationClaim"("reservationId", "settledAt");
