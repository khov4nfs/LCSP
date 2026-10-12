"use client";

import { ASSESSMENT_RUNTIME_CONTROL_STATES as States } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import {
  CirclePauseIcon,
  CirclePlayIcon,
  CircleStopIcon,
  CornerDownLeftIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { AssessmentComposerProps } from "../../types/assessment-composer.types";

const COLLAPSED_MAX_ROWS = 3;
const EXPANDED_MAX_VIEWPORT_RATIO = 0.42;
const EXPANDED_MAX_HEIGHT_PX = 352;

export function AssessmentComposer({
  value,
  onValueChange,
  onSubmit,
  onResume,
  placeholder = t("pages.appShell.chatComposerPlaceholder"),
  sendLabel = t("pages.appShell.chatSend"),
  resumeLabel = t("pages.assessment.resumePipeline"),
  disabled = false,
  submitting = false,
  resuming = false,
  submitReady,
  resumeAvailable = false,
  className,
  onInterruptTurn,
  onResumeTurn,
  interruptingTurn = false,
  resumingTurn = false,
  runtimeControlState,
}: AssessmentComposerProps) {
  const controlState = runtimeControlState ?? null;
  const stopping = controlState === States.stopRequested;
  const continuing = controlState === States.resumeRequested;
  const stopped = controlState === States.stopped;
  const controlled = controlState !== null && controlState !== States.completed;
  const [expanded, setExpanded] = useState(false);
  const [canResize, setCanResize] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      const style = window.getComputedStyle(textarea);
      const lineHeight = cssPixels(style.lineHeight, 20);
      const padding =
        cssPixels(style.paddingTop, 0) + cssPixels(style.paddingBottom, 0);
      const border =
        cssPixels(style.borderTopWidth, 0) +
        cssPixels(style.borderBottomWidth, 0);
      const oneRowHeight = Math.ceil(lineHeight + padding + border);
      const collapsedHeight = Math.ceil(
        lineHeight * COLLAPSED_MAX_ROWS + padding + border,
      );
      const expandedHeightLimit = Math.max(
        collapsedHeight,
        Math.min(
          Math.floor(window.innerHeight * EXPANDED_MAX_VIEWPORT_RATIO),
          EXPANDED_MAX_HEIGHT_PX,
        ),
      );
      textarea.style.height = "0px";
      const contentHeight = Math.max(oneRowHeight, textarea.scrollHeight);
      const heightLimit = expanded ? expandedHeightLimit : collapsedHeight;
      textarea.style.height = `${Math.min(contentHeight, heightLimit)}px`;
      textarea.style.overflowY =
        contentHeight > heightLimit ? "auto" : "hidden";
      setCanResize(contentHeight > collapsedHeight + 1);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, expanded]);
  const isSubmitReady =
    submitReady !== undefined ? submitReady : value.trim().length > 0;
  const sendDisabled = controlled || disabled || submitting || !isSubmitReady;
  // An explicit null runtime control means the canonical ALS/AES pair is not
  // available for this surface. Do not let a stale generic resume flag invent
  // a Continue action until the server projection is present again.
  const showResumeAction =
    runtimeControlState !== null &&
    resumeAvailable &&
    value.trim().length === 0;
  const resumeDisabled = resuming || !onResume;
  const stopTurnLabel = t(
    stopping
      ? "pages.appShell.chatStoppingTurn"
      : "pages.appShell.chatStopTurn",
  );
  const resumeTurnLabel = t(
    continuing
      ? "pages.appShell.chatContinuingTurn"
      : "pages.appShell.chatResumeTurn",
  );
  const interruptTurnDisabled =
    stopping || continuing || interruptingTurn || !onInterruptTurn;
  const resumeTurnDisabled = continuing || resumingTurn || !onResumeTurn;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendDisabled) {
      return;
    }
    onSubmit();
    setExpanded(false);
  }

  function handleResume() {
    if (resumeDisabled) {
      return;
    }
    onResume?.();
    setExpanded(false);
  }

  function handleInterruptTurn() {
    if (interruptTurnDisabled) {
      return;
    }
    onInterruptTurn?.();
  }

  function handleResumeTurn() {
    if (resumeTurnDisabled) {
      return;
    }
    onResumeTurn?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setExpanded(false);
      return;
    }
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form
      data-slot="assessment-composer"
      onSubmit={handleSubmit}
      className={cn(
        "relative mx-auto mb-4 w-full max-w-180 shrink-0 rounded-[18px] border border-input bg-card shadow-sm",
        expanded && "max-h-[min(42dvh,22rem)]",
        className,
      )}
    >
      <Textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={controlled || disabled || submitting}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          stopping
            ? stopTurnLabel
            : continuing
              ? resumeTurnLabel
              : stopped
                ? t("pages.appShell.chatStoppedTurn")
                : placeholder
        }
        aria-label={placeholder}
        className={cn(
          "min-h-11 resize-none overflow-y-hidden scrollbar-none border-0 bg-transparent px-4.5 py-3 pr-14 text-sm leading-5 shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent",
        )}
      />
      {canResize || expanded ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t(
                  expanded
                    ? "pages.appShell.chatCollapse"
                    : "pages.appShell.chatExpand",
                )}
                aria-expanded={expanded}
                onClick={() => {
                  setExpanded(!expanded);
                  textareaRef.current?.focus();
                }}
                className="absolute right-3 top-2 size-7"
              >
                {expanded ? (
                  <Minimize2Icon aria-hidden="true" />
                ) : (
                  <Maximize2Icon aria-hidden="true" />
                )}
              </Button>
            }
          />
          <TooltipContent>
            {t(
              expanded
                ? "pages.appShell.chatCollapse"
                : "pages.appShell.chatExpand",
            )}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {controlled ? (
        <Button
          type="button"
          size="icon"
          disabled={
            stopped || continuing ? resumeTurnDisabled : interruptTurnDisabled
          }
          aria-label={stopped || continuing ? resumeTurnLabel : stopTurnLabel}
          onClick={stopped ? handleResumeTurn : handleInterruptTurn}
          data-runtime-control-state={controlState}
          className="absolute bottom-2 right-3 size-8 rounded-full bg-transparent text-foreground hover:bg-accent disabled:bg-transparent"
        >
          {stopping || continuing ? (
            <CirclePauseIcon aria-hidden="true" />
          ) : stopped ? (
            <CirclePlayIcon aria-hidden="true" />
          ) : (
            <CircleStopIcon aria-hidden="true" />
          )}
        </Button>
      ) : showResumeAction ? (
        <Button
          type="button"
          size="icon"
          disabled={resumeDisabled}
          aria-label={resumeLabel}
          onClick={handleResume}
          className="absolute bottom-2 right-3 size-8 rounded-full bg-transparent text-foreground hover:bg-accent disabled:bg-transparent"
        >
          <CirclePlayIcon aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={sendDisabled}
          aria-label={sendLabel}
          className="absolute bottom-2 right-3 size-8 rounded-full bg-transparent text-foreground hover:bg-accent disabled:bg-transparent"
        >
          <CornerDownLeftIcon aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function cssPixels(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
