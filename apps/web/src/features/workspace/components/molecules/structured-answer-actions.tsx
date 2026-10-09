import { CheckIcon, Edit3Icon, SendIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";

export const STRUCTURED_ANSWER_ACTION_MODES = {
  submit: "submit",
  confirmAdjust: "confirm-adjust",
} as const;
export type StructuredAnswerActionMode =
  (typeof STRUCTURED_ANSWER_ACTION_MODES)[keyof typeof STRUCTURED_ANSWER_ACTION_MODES];

export function StructuredAnswerActions({
  mode,
  valid = true,
  disabled = false,
  pending = false,
  submitted = false,
  isAdjusting = false,
  onSubmit,
  onConfirm,
  onAdjust,
}: {
  mode: StructuredAnswerActionMode;
  valid?: boolean;
  disabled?: boolean;
  pending?: boolean;
  submitted?: boolean;
  isAdjusting?: boolean;
  onSubmit?: () => void;
  onConfirm?: () => void;
  onAdjust?: () => void;
}) {
  const invoked = useRef(false);
  useEffect(() => {
    if (!pending && !submitted) invoked.current = false;
  }, [pending, submitted]);
  function invokeOnce(callback?: () => void) {
    if (disabled || pending || submitted || invoked.current) return;
    invoked.current = true;
    callback?.();
  }
  if (mode === STRUCTURED_ANSWER_ACTION_MODES.confirmAdjust) {
    return (
      <div data-slot="confirm-adjust-actions" className="flex flex-wrap items-center gap-2" aria-busy={pending}>
        <Button type="button" size="sm" disabled={disabled || pending || submitted} onClick={() => invokeOnce(onConfirm)}>
          <CheckIcon />{t("pages.assessment.confirm")}
        </Button>
        <Button type="button" size="sm" variant={isAdjusting ? "secondary" : "outline"} disabled={disabled || pending || submitted} onClick={() => onAdjust?.()}>
          <Edit3Icon />{t("pages.assessment.adjust")}
        </Button>
        {isAdjusting ? <span className="text-xs text-muted-foreground">{t("pages.assessment.continueInComposer")}</span> : null}
      </div>
    );
  }
  return (
    <div data-slot="selection-submit-action" className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <Button type="button" size="sm" disabled={disabled || pending || submitted || !valid} onClick={() => invokeOnce(onSubmit)}>
        <SendIcon />{t("pages.assessment.submitAnswer")}
      </Button>
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
