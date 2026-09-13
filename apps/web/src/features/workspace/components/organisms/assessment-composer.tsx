"use client";

import { resolveMessage } from "@lcsp/i18n";
import {
  CornerDownLeftIcon,
  Maximize2Icon,
  Minimize2Icon,
  RotateCcwIcon,
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

type AssessmentComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onResume?: () => void;
  placeholder?: string;
  sendLabel?: string;
  resumeLabel?: string;
  disabled?: boolean;
  submitting?: boolean;
  resuming?: boolean;
  submitReady?: boolean;
  resumeAvailable?: boolean;
  className?: string;
};

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
}: AssessmentComposerProps) {
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
      const collapsedHeight = Math.ceil(lineHeight * 5 + padding + border);
      textarea.style.height = "0px";
      const nextHeight = expanded ? textarea.scrollHeight : collapsedHeight;
      textarea.style.height = `${nextHeight}px`;
      setCanResize(textarea.scrollHeight > collapsedHeight + 1);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, expanded]);
  const isSubmitReady =
    submitReady !== undefined ? submitReady : value.trim().length > 0;
  const sendDisabled = disabled || submitting || !isSubmitReady;
  const showResumeAction = resumeAvailable && value.trim().length === 0;
  const resumeDisabled = resuming || !onResume;

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
        expanded && "flex h-[min(70dvh,48rem)] flex-col",
        className,
      )}
    >
      <Textarea
        ref={textareaRef}
        rows={5}
        value={value}
        disabled={disabled || submitting}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "min-h-19 max-h-[min(35dvh,20rem)] resize-none overflow-y-auto border-0 bg-transparent px-4.5 py-6.5 pr-14 text-sm leading-5 shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent",
          expanded && "min-h-0 max-h-none flex-1",
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
                className="absolute right-3 top-1.5 size-7"
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
      {showResumeAction ? (
        <Button
          type="button"
          size="sm"
          disabled={resumeDisabled}
          aria-label={resumeLabel}
          onClick={handleResume}
          className="absolute bottom-1.5 right-3 h-8 rounded-full px-3"
        >
          <RotateCcwIcon aria-hidden="true" />
          {resumeLabel}
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={sendDisabled}
          aria-label={sendLabel}
          className="absolute bottom-1.5 right-3 size-8 rounded-full bg-transparent text-foreground hover:bg-accent disabled:bg-transparent"
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
