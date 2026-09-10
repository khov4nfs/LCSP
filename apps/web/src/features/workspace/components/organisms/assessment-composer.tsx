"use client";

import { resolveMessage } from "@lcsp/i18n";
import { CornerDownLeftIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
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
  placeholder?: string;
  sendLabel?: string;
  disabled?: boolean;
  submitting?: boolean;
  submitReady?: boolean;
  className?: string;
};

export function AssessmentComposer({
  value,
  onValueChange,
  onSubmit,
  placeholder = t("pages.appShell.chatComposerPlaceholder"),
  sendLabel = t("pages.appShell.chatSend"),
  disabled = false,
  submitting = false,
  submitReady,
  className,
}: AssessmentComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, expanded]);
  const isSubmitReady =
    submitReady !== undefined ? submitReady : value.trim().length > 0;
  const sendDisabled = disabled || submitting || !isSubmitReady;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendDisabled) {
      return;
    }
    onSubmit();
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
        rows={1}
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
      {value.length > 0 || expanded ? (
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
      <Button
        type="submit"
        size="icon"
        disabled={sendDisabled}
        aria-label={sendLabel}
        className="absolute bottom-1.5 right-3 size-8 rounded-full bg-transparent text-foreground hover:bg-accent disabled:bg-transparent"
      >
        <CornerDownLeftIcon aria-hidden="true" />
      </Button>
    </form>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
