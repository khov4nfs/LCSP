"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { resolveMessage } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";
import { UserMessage } from "./agent-turn";

export function InterviewAnswerMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > 500 || text.split("\n").length > 8;
  return (
    <UserMessage className="m-0 max-w-none rounded-none bg-transparent p-0">
      <div className="min-w-0">
        <div
          className={
            collapsible && !expanded ? "relative max-h-56 overflow-hidden" : ""
          }
        >
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {text}
          </p>
          {collapsible && !expanded ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-muted to-transparent"
            />
          ) : null}
        </div>
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2"
          >
            {resolveMessage(
              appLocale,
              expanded
                ? "pages.appShell.chatShowLess"
                : "pages.appShell.chatShowMore",
            )}
            {expanded ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </button>
        ) : null}
      </div>
    </UserMessage>
  );
}
