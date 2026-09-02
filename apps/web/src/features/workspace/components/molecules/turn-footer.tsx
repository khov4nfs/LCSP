"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { TurnFooterAction } from "../../types/assessment-chat.types";

type TurnFooterProps = {
  actions: TurnFooterAction[];
  className?: string;
};

export function TurnFooter({ actions, className }: TurnFooterProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div
      data-slot="turn-footer"
      className={cn(
        "flex max-w-full flex-wrap items-center justify-end gap-1.5",
        className,
      )}
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          size="sm"
          variant={action.variant ?? "ghost"}
          disabled={action.disabled}
          onClick={action.onSelect}
          className="max-w-full whitespace-normal"
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
