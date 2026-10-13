"use client";

import { useState } from "react";
import { RULE_SET_PREPARATION_REFUSAL_REASONS } from "@lcsp/contracts/compliance-rule-set";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePrepareRuleSetMutation } from "@/lib/api/compliance-rule-set-queries";
import { resolveAppMessage } from "@/lib/i18n";
import type { RuleSetPreparationActionProps } from "../../types/compliance-rule-sets.types";

export function RuleSetPreparationAction({
  availability,
}: RuleSetPreparationActionProps) {
  const prepare = usePrepareRuleSetMutation();
  const [confirming, setConfirming] = useState(false);
  const running =
    prepare.isPending ||
    availability.refusalReason ===
      RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS;
  if (!availability.canStart && !running) return null;
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        type="button"
        disabled={running}
        aria-busy={running}
        onClick={() => setConfirming(true)}
      >
        {resolveAppMessage(
          running
            ? "pages.complianceRuleSets.preparing"
            : "pages.complianceRuleSets.prepare",
        )}
      </Button>
      {prepare.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {resolveAppMessage("pages.complianceRuleSets.prepareFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader className="flex-col">
            <DialogTitle>
              {resolveAppMessage("pages.complianceRuleSets.confirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {resolveAppMessage("pages.complianceRuleSets.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end pt-5">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {resolveAppMessage("pages.complianceRuleSets.cancel")}
            </Button>
            <Button
              disabled={running || !availability.canStart}
              onClick={() => {
                setConfirming(false);
                prepare.mutate();
              }}
            >
              {resolveAppMessage("pages.complianceRuleSets.confirmPrepare")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
