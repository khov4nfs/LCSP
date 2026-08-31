import React from "react";
import type { SectionHeadingProps } from "@/components/types/section-heading.types";

export function SectionHeading({
  title,
  description,
  icon,
}: SectionHeadingProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
