"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";

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
  elementRef?: Ref<HTMLDivElement>;
};

const PINNED_BOTTOM_THRESHOLD_PX = 120;

export function AssessmentTranscript({
  children,
  autoScrollKey,
  ariaLabel = t("pages.appShell.chatTranscriptLabel"),
  className,
}: AssessmentTranscriptProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    pinnedRef.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
      PINNED_BOTTOM_THRESHOLD_PX;
    if (pinnedRef.current) setShowJumpToLatest(false);
  };

  const jumpToLatest = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    pinnedRef.current = true;
    scrollToLatest(viewport);
    setShowJumpToLatest(false);
  };

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    if (pinnedRef.current) {
      scrollToLatest(viewport);
    } else {
      setShowJumpToLatest(true);
    }
  }, [autoScrollKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const rail = railRef.current;
    if (!viewport || !rail || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) {
        scrollToLatest(viewport);
      } else {
        setShowJumpToLatest(true);
      }
    });
    observer.observe(viewport);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={viewportRef}
        data-slot="assessment-transcript"
        role="log"
        aria-live="polite"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
      >
        <ChatRail
          elementRef={railRef}
          className="shrink-0 gap-4 pt-6 pb-4"
        >
          {children}
        </ChatRail>
      </div>
      {showJumpToLatest && (
        <button
          type="button"
          data-slot="transcript-jump-to-latest"
          aria-label={t("pages.appShell.chatJumpToLatest")}
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("pages.appShell.chatNewActivity")}
        </button>
      )}
    </div>
  );
}

export function ChatRail({ children, className, elementRef }: ChatRailProps) {
  return (
    <div
      ref={elementRef}
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

function scrollToLatest(viewport: HTMLDivElement) {
  if (viewport.scrollHeight <= viewport.clientHeight) {
    return;
  }
  viewport.scrollTo({
    top: viewport.scrollHeight,
    behavior: "auto",
  });
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
