"use client";

import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import type { MessageKey } from "@lcsp/i18n";
import {
  PREPARATION_ACTIVITY_SCOPES,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
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
import {
  RULE_SET_PREPARATION_CANCEL_MUTATION_KEY,
  usePrepareRuleSetMutation,
} from "@/lib/api/compliance-rule-set-queries";
import { resolveAppMessage } from "@/lib/i18n";
import type { RuleSetPreparationActionProps } from "../../types/compliance-rule-sets.types";

export function RuleSetPreparationAction({
  availability,
  replaceActive = false,
}: RuleSetPreparationActionProps) {
  const prepare = usePrepareRuleSetMutation();
  const cancelling =
    useIsMutating({ mutationKey: RULE_SET_PREPARATION_CANCEL_MUTATION_KEY }) >
    0;
  const [confirming, setConfirming] = useState(false);
  const running =
    prepare.isPending ||
    cancelling ||
    availability.refusalReason ===
      RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS;
  const canPrepare = replaceActive
    ? availability.canReplace
    : availability.canStart;
  const canSubmit = canPrepare && availability.legalSourceVersionId !== null;
  const blockerId = "rule-set-preparation-blocker";
  const blockerKey = availability.refusalReason
    ? `pages.complianceRuleSets.blockers.${availability.refusalReason}`
    : "pages.complianceRuleSets.blockers.SOURCE_VERSION_NOT_ELIGIBLE";
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        type="button"
        disabled={running || !canSubmit}
        aria-busy={running}
        aria-describedby={!canSubmit ? blockerId : undefined}
        onClick={() => setConfirming(true)}
      >
        {resolveAppMessage(
          cancelling
            ? "pages.complianceRuleSets.cancelling"
            : running
              ? "pages.complianceRuleSets.preparing"
              : replaceActive
                ? "pages.complianceRuleSets.prepareNewVersion"
                : "pages.complianceRuleSets.prepare",
        )}
      </Button>
      {!canSubmit ? (
        <div id={blockerId} className="max-w-2xl text-sm" role="status">
          <p className="font-medium">
            {resolveAppMessage(
              "pages.complianceRuleSets.preparationUnavailable",
            )}
          </p>
          <p className="text-muted-foreground">
            {resolveAppMessage(blockerKey as MessageKey)}
          </p>
          <p className="text-muted-foreground">
            {resolveAppMessage("pages.complianceRuleSets.sourceAdminNextStep")}
          </p>
        </div>
      ) : null}
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
              {resolveAppMessage(
                replaceActive
                  ? "pages.complianceRuleSets.confirmReplaceTitle"
                  : "pages.complianceRuleSets.confirmTitle",
              )}
            </DialogTitle>
            <DialogDescription>
              {resolveAppMessage(
                replaceActive
                  ? "pages.complianceRuleSets.confirmReplaceDescription"
                  : "pages.complianceRuleSets.confirmDescription",
              )}
              <span className="mt-2 block font-medium">
                {availability.legalSourceVersion ??
                  resolveAppMessage(
                    "pages.complianceRuleSets.sourceNotSelected",
                  )}
                {availability.legalSourceVersionId
                  ? ` · ${availability.legalSourceVersionId}`
                  : ""}
                {` · ${resolveAppMessage(
                  `pages.complianceRuleSets.scopes.${PREPARATION_ACTIVITY_SCOPES[1]}`,
                )}`}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end pt-5">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {resolveAppMessage("pages.complianceRuleSets.cancel")}
            </Button>
            <Button
              disabled={running || !canSubmit}
              onClick={() => {
                setConfirming(false);
                // Name the version on screen so a stale page cannot prepare a newer one by accident.
                prepare.mutate({
                  ...(replaceActive ? { replaceActive: true } : {}),
                  ...(availability.legalSourceVersionId
                    ? {
                        legalSourceVersionId: availability.legalSourceVersionId,
                      }
                    : {}),
                  targetActivityScope: PREPARATION_ACTIVITY_SCOPES[1],
                });
              }}
            >
              {resolveAppMessage(
                replaceActive
                  ? "pages.complianceRuleSets.confirmReplace"
                  : "pages.complianceRuleSets.confirmPrepare",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
