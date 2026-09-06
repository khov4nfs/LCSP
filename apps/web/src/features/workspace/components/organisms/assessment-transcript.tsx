"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useEffect, useRef, type ReactNode, type UIEvent } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { AssessmentTranscriptAutoScrollKey } from "../../types/assessment-chat.types";

type AssessmentTranscriptProps = {
  children: ReactNode;
  autoScrollKey?: AssessmentTranscriptAutoScrollKey;
  ariaLabel?: string;
  className?: string;
};

type ChatRailProps = {
  children: ReactNode;
  className?: string;
};

const AUTO_FOLLOW_THRESHOLD_PX = 80;

export function AssessmentTranscript({
  children,
  autoScrollKey,
  ariaLabel = t("pages.appShell.chatTranscriptLabel"),
  className,
}: AssessmentTranscriptProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isFollowingLatestRef = useRef(true);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    isFollowingLatestRef.current = isNearLatest(event.currentTarget);
  }

  useEffect(() => {
    if (autoScrollKey === undefined) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (!isFollowingLatestRef.current && !isNearLatest(viewport)) {
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
      onScroll={handleScroll}
      className={cn(
        "no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
        className,
      )}
    >
      <ChatRail className="min-h-full gap-4 py-6">{children}</ChatRail>
    </div>
  );
}

export function ChatRail({ children, className }: ChatRailProps) {
  return (
    <div
      data-slot="chat-rail"
      className={cn(
        "mx-auto flex w-full max-w-170 min-w-0 flex-col px-4 sm:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function isNearLatest(viewport: HTMLDivElement) {
  return (
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
    AUTO_FOLLOW_THRESHOLD_PX
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
