import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function TrackingSection({
  title,
  description,
  children,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardHeader className={compact ? "flex flex-row items-start justify-between gap-4 p-4 pb-2" : "flex flex-row items-start justify-between gap-4"}>
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className={compact ? "px-4 pb-4" : undefined}>{children}</CardContent>
    </Card>
  );
}
