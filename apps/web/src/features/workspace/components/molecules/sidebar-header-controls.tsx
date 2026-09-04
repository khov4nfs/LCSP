"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PanelLeftIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SidebarHeaderControlsProps = {
  className?: string;
  onBack: () => void;
  onForward: () => void;
  onSearch: () => void;
  onToggleCollapse: () => void;
  showDivider?: boolean;
};

export function SidebarHeaderControls({
  className,
  onBack,
  onForward,
  onSearch,
  onToggleCollapse,
  showDivider = true,
}: SidebarHeaderControlsProps) {
  return (
    <div
      className={cn(
        "flex h-13 shrink-0 items-center gap-2 px-3",
        showDivider ? "border-b border-sidebar-border" : null,
        className,
      )}
    >
      <SidebarHeaderButton
        Icon={PanelLeftIcon}
        label={resolveAppMessage("pages.appShell.sidebarToggle")}
        onClick={onToggleCollapse}
      />
      <SidebarHeaderButton
        Icon={SearchIcon}
        label={resolveAppMessage("pages.appShell.searchAssessments")}
        onClick={onSearch}
      />
      <SidebarHeaderButton
        Icon={ArrowLeftIcon}
        label={resolveAppMessage("pages.appShell.back")}
        onClick={onBack}
      />
      <SidebarHeaderButton
        Icon={ArrowRightIcon}
        label={resolveAppMessage("pages.appShell.forward")}
        onClick={onForward}
      />
    </div>
  );
}

function SidebarHeaderButton({
  Icon,
  label,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="size-8 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={onClick}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
