import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";

import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";

type WalletBalanceCardProps = {
  locale: Locale;
  formattedAvailableBalance: string;
  formattedReservedBalance: string;
};

/**
 * Business purpose: Display the workspace's authoritative prepaid VND balance and reserved balance in the Figma Financial & usage metric card.
 * Business rules:
 * - Displays only server-returned available and reserved balances; never fabricates or optimistically mutates wallet credits.
 * - Uses the shared NextMetricCard embedded variant matching Figma master 1837:14045 (LCSP Next / Metric / Financial & usage).
 * Execution flow:
 * 1. Compose localized title, formatted available VND balance, and reserved balance context into NextMetricCard.
 * Failure cases:
 * - Missing or unformatted amounts are handled by the parent formatter before reaching this card.
 * Side effects:
 * - Pure presentational component; no state or network calls.
 */
export function WalletBalanceCard({
  locale,
  formattedAvailableBalance,
  formattedReservedBalance,
}: WalletBalanceCardProps) {
  const reservedLabel = resolveMessage(
    locale,
    "pages.workspace.settingsHub.billing.reservedBalance",
  );

  return (
    <section
      aria-labelledby="billing-balance-heading"
      className="flex flex-col"
      data-component="WalletBalanceCard"
    >
      <h3 id="billing-balance-heading" className="sr-only">
        {resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.balanceTitle",
        )}
      </h3>
      <NextMetricCard
        variant={NEXT_METRIC_VARIANTS.embedded}
        label={resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.availableBalance",
        )}
        value={formattedAvailableBalance}
        context={`${reservedLabel}: ${formattedReservedBalance}`}
        className="h-full"
      />
    </section>
  );
}
