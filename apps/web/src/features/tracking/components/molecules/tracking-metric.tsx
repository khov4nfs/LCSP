import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { appLocale } from "@/lib/locale";
import type { TrackingMetricProps } from "../../types/tracking-ui.types";

export function TrackingMetric({ label, value }: TrackingMetricProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">
          {value.toLocaleString(appLocale)}
        </p>
      </CardContent>
    </Card>
  );
}
