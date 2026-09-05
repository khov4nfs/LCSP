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
        "h-9 w-52 justify-start gap-3 rounded-lg px-2.5 text-[13px]",
        active
          ? "bg-accent text-accent-foreground hover:bg-accent"
          : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
      )}
      data-component="SettingsTab"
      data-settings-tab={id}
      onClick={() => onSelect(id)}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      <span className="truncate">{label}</span>
    </Button>
  );
}
