export type BillingProjection = {
  ledgerBalance: bigint;
  reservedBalance: bigint;
  availableBalance: bigint;
};

export function calculateBillingProjection(
  ledgerDeltas: readonly bigint[],
  activeReservations: readonly bigint[],
): BillingProjection {
  const ledgerBalance = ledgerDeltas.reduce((sum, delta) => sum + delta, 0n);
  const reservedBalance = activeReservations.reduce(
    (sum, amount) => sum + amount,
    0n,
  );
  return {
    ledgerBalance,
    reservedBalance,
    availableBalance: ledgerBalance - reservedBalance,
  };
}
