import { RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { trackingMessage } from "../../utils/tracking-display";
import type { TrackingErrorProps } from "../../types/tracking-ui.types";

export function TrackingError({ onRetry }: TrackingErrorProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{trackingMessage("errorTitle")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{trackingMessage("errorDescription")}</span>
        <Button onClick={onRetry} variant="outline" size="sm">
          <RefreshCwIcon className="size-4" />
          {trackingMessage("retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
