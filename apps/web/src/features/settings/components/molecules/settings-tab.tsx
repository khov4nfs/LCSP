"use client";

import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { SettingsSectionId } from "../../types/settings.types";

type SettingsTabProps = {
  active: boolean;
  icon: LucideIcon;
  id: SettingsSectionId;
  label: string;
  onSelect: (id: SettingsSectionId) => void;
};

export function SettingsTab({
  active,
  icon: Icon,
  id,
  label,
  onSelect,
}: SettingsTabProps) {
  return (
    <Button
      aria-current={active ? "page" : undefined}
      aria-pressed={active}
      className={cn(
        "relative h-9 w-52 shrink-0 justify-start gap-3 rounded-lg px-2.5 text-[13px]",
        // Why: Figma's Settings row uses the shared mint sidebar selection treatment.
        // How: Use semantic sidebar tokens and a decorative rail while the existing ghost Button retains focus/disabled feedback.
        // Invariants: Selection remains driven by the existing active prop and route/navigation state.
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
          : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
      )}
      data-component="SettingsTab"
      data-settings-tab={id}
      onClick={() => onSelect(id)}
      type="button"
      variant="ghost"
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-5.25 w-0.75 -translate-y-1/2 bg-brand"
          data-component="SettingsTabSelectionIndicator"
        />
      ) : null}
      <Icon aria-hidden="true" data-icon="inline-start" />
      <span className="truncate">{label}</span>
    </Button>
  );
}
