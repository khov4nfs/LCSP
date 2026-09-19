export function serializeBillingData(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeBillingData);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      serializeBillingData(entry),
    ]),
  );
}

export function projectReservation(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const reservation = value as Record<string, unknown>;
  return {
    reservationId: reservation.id ?? reservation.reservationId,
    assessmentId: reservation.assessmentId,
    runId: reservation.runId,
    amountCredits: reservation.amountCredits,
    remainingCredits: reservation.remainingCredits,
    status: reservation.status,
  };
}
