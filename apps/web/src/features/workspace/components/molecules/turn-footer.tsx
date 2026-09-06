"use client";

import * as React from "react";
import { resolveMessage } from "@lcsp/i18n";
import { CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { TurnFooterAction } from "../../types/assessment-chat.types";

type TurnFooterProps = {
  timestamp?: string;
  onCopy?: () => void;
  copyLabel?: string;
  actions?: TurnFooterAction[];
  className?: string;
};

export function TurnFooter({
  timestamp,
  onCopy,
  copyLabel = t("pages.appShell.chatCopy"),
  actions = [],
  className,
}: TurnFooterProps) {
  if (!timestamp && !onCopy && actions.length === 0) {
    return null;
  }

  return (
    <div
      data-slot="turn-footer"
      className={cn(
        "flex min-h-7.5 max-w-full flex-wrap items-center justify-start gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {timestamp ? (
        <time className="leading-4" dateTime={timestamp}>
          {timestamp}
        </time>
      ) : null}
      {onCopy ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={copyLabel}
          onClick={onCopy}
          className="size-7.5 rounded-lg text-muted-foreground hover:text-foreground"
        >
          <CopyIcon aria-hidden="true" />
        </Button>
      ) : null}
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

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
