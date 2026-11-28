"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CopyTextButtonProps } from "../types/copy-text-button.types";

export function CopyTextButton({
  value,
  copyLabel,
  copiedLabel,
  failureLabel,
}: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  /**
   * Business purpose: Let a user copy an exact identifier without retyping it.
   * Business rules: Copy only the supplied value and acknowledge only a successful clipboard write; never fill or submit a form.
   * Execution flow:
   * 1. Clear feedback and request a clipboard write.
   * 2. Announce success or failure and release the pending state.
   * Failure cases: Missing clipboard access or rejected permission displays failure; manual text selection remains available.
   * Side effects: Writes to the browser clipboard and changes transient feedback only.
   */
  async function copyText() {
    setPending(true);
    setCopied(false);
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void copyText()}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
        {copyLabel}
      </Button>
      <span
        role="status"
        className={
          failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"
        }
      >
        {copied ? copiedLabel : failed ? failureLabel : null}
      </span>
    </div>
  );
}
