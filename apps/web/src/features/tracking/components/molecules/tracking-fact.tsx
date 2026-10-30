import { trackingMessage } from "../../utils/tracking-display";
import type { TrackingFactProps } from "../../types/tracking-ui.types";

export function TrackingFact({
  label,
  value,
  fallbackWhenEmpty = true,
}: TrackingFactProps) {
  const displayedValue =
    value === null || (fallbackWhenEmpty && value.length === 0)
      ? trackingMessage("notAvailable")
      : value;

  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-3/5 break-all text-right">{displayedValue}</dd>
    </div>
  );
}
