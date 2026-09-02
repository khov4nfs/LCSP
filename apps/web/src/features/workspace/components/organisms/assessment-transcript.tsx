"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useEffect, useRef, type ReactNode } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { AssessmentTranscriptAutoScrollKey } from "../../types/assessment-chat.types";

type AssessmentTranscriptProps = {
  children: ReactNode;
  autoScrollKey?: AssessmentTranscriptAutoScrollKey;
  ariaLabel?: string;
  className?: string;
};

export function AssessmentTranscript({
  children,
  autoScrollKey,
  ariaLabel = t("pages.appShell.chatTranscriptLabel"),
  className,
}: AssessmentTranscriptProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScrollKey === undefined) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [autoScrollKey]);

  return (
    <div
      ref={viewportRef}
      data-slot="assessment-transcript"
      role="log"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col gap-4 px-4 py-6 sm:px-0">
        {children}
      </div>
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
