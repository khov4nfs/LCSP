import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TrackingSectionProps } from "../../types/tracking-ui.types";

export function TrackingSection({
  title,
  description,
  children,
  action,
  compact = false,
}: TrackingSectionProps) {
  return (
    <Card>
      <CardHeader
        className={
          compact
            ? "flex flex-row items-start justify-between gap-4 p-4 pb-2"
            : "flex flex-row items-start justify-between gap-4"
        }
      >
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className={compact ? "px-4 pb-4" : undefined}>
        {children}
      </CardContent>
    </Card>
  );
}
