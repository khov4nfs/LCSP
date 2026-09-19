ALTER TABLE "BillingReservation"
  ADD COLUMN "maxInvocations" BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN "invocationsStarted" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "BillingReservationInvocationClaim" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingReservationInvocationClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingReservationInvocationClaim_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "BillingReservation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingReservationInvocationClaim_reservationId_invocationId_key"
  ON "BillingReservationInvocationClaim"("reservationId", "invocationId");
CREATE INDEX "BillingReservationInvocationClaim_invocationId_idx"
  ON "BillingReservationInvocationClaim"("invocationId");
