import { resolveMessage } from "@lcsp/i18n";
import { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { appLocale } from "@/lib/locale";

import { getConflictTypeLabelKey } from "../../config/conflict-labels";
import {
  CONFLICT_RESOLUTION_OPTIONS,
  type ConflictCardProps,
} from "../../types/conflict-card.types";

export function ConflictCard({
  conflict,
  resolution,
  resolutionNote,
  isSubmitting,
  formError,
  onResolutionChange,
  onResolutionNoteChange,
  onSubmit,
}: ConflictCardProps) {
  const scorePercent = Math.max(
    0,
    Math.min(100, Math.round(conflict.conflict_score * 100)),
  );
  const progressTone =
    scorePercent <= 40
      ? "bg-emerald-500"
      : scorePercent <= 70
        ? "bg-amber-500"
        : "bg-destructive";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>
            {resolveMessage(
              appLocale,
              getConflictTypeLabelKey(conflict.conflict_type),
            )}
          </CardTitle>
          <Badge variant="outline">
            {resolveMessage(appLocale, "pages.reconciliation.pendingBadge")}
          </Badge>
        </div>
        <CardDescription>{conflict.score_explanation}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.reconciliation.scorePriorityLabel",
              )}
            </span>
            <span className="font-medium">{scorePercent}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={resolveMessage(
              appLocale,
              "pages.reconciliation.scoreLabel",
            )}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={scorePercent}
          >
            <div
              className={progressTone}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {conflict.explanation_basis.score_priority_explanation}
          </p>
        </div>

        <dl className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.reconciliation.affectedFieldLabel",
              )}
            </dt>
            <dd className="font-medium">
              {conflict.explanation_basis.affected_field}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.reconciliation.confidenceLabel",
              )}
            </dt>
            <dd className="font-medium">
              {conflict.explanation_basis.confidence}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.reconciliation.materialityReasonLabel",
              )}
            </dt>
            <dd>{conflict.explanation_basis.materiality_reason}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">
            {resolveMessage(
              appLocale,
              "pages.reconciliation.sourceValuesLabel",
            )}
          </p>
          <dl className="grid gap-3 md:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">
                {resolveMessage(
                  appLocale,
                  "pages.reconciliation.managerAnswerLabel",
                )}
              </dt>
              <dd>
                {formatNullableValue(
                  conflict.explanation_basis.source_values.manager_answer,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {resolveMessage(
                  appLocale,
                  "pages.reconciliation.technicalEvidenceLabel",
                )}
              </dt>
              <dd>
                {formatNullableValue(
                  conflict.explanation_basis.source_values.technical_evidence,
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {resolveMessage(
              appLocale,
              "pages.reconciliation.evidenceRefsLabel",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {conflict.evidence_refs.map((ref, index) => (
              <Badge key={`${ref}-${index}`} variant="secondary">
                {ref}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">
            {resolveMessage(
              appLocale,
              "pages.reconciliation.evidenceBasisLabel",
            )}
          </p>
          {conflict.explanation_basis.evidence_context.map((context) => (
            <div
              key={context.evidence_ref}
              className="border-l-2 border-muted pl-3"
            >
              <p className="font-medium">{context.evidence_ref}</p>
              <dl className="mt-2 grid gap-2">
                <div>
                  <dt className="text-muted-foreground">
                    {resolveMessage(
                      appLocale,
                      "pages.reconciliation.redactedContextLabel",
                    )}
                  </dt>
                  <dd>{context.redacted_context}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {resolveMessage(
                      appLocale,
                      "pages.reconciliation.coverageLimitationsLabel",
                    )}
                  </dt>
                  <dd>{context.coverage_limitations}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`resolution-${conflict.conflict_id}`}>
              {resolveMessage(
                appLocale,
                "pages.reconciliation.resolutionLabel",
              )}
            </FieldLabel>
            <Select
              value={resolution}
              disabled={isSubmitting}
              onValueChange={(value) => {
                if (
                  value === CONFLICT_RECORD_STATUSES.resolved ||
                  value === CONFLICT_RECORD_STATUSES.dismissed
                ) {
                  onResolutionChange(value);
                }
              }}
            >
              <SelectTrigger
                id={`resolution-${conflict.conflict_id}`}
                className="w-full bg-background"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CONFLICT_RESOLUTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {resolveMessage(appLocale, option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={Boolean(formError) || undefined}>
            <FieldLabel htmlFor={`note-${conflict.conflict_id}`}>
              {resolveMessage(
                appLocale,
                "pages.reconciliation.resolutionNoteLabel",
              )}
            </FieldLabel>
            <FieldDescription>
              {resolveMessage(
                appLocale,
                "pages.reconciliation.resolutionNotePlaceholder",
              )}
            </FieldDescription>
            <Textarea
              id={`note-${conflict.conflict_id}`}
              value={resolutionNote}
              disabled={isSubmitting}
              aria-invalid={Boolean(formError)}
              maxLength={2000}
              className="min-h-24 bg-background"
              placeholder={resolveMessage(
                appLocale,
                "pages.reconciliation.resolutionNotePlaceholder",
              )}
              onChange={(event) => onResolutionNoteChange(event.target.value)}
            />
            <FieldError>{formError}</FieldError>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? resolveMessage(appLocale, "pages.reconciliation.submitting")
            : resolveMessage(appLocale, "pages.reconciliation.submitAction")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function formatNullableValue(value: string | null): string {
  return value ?? resolveMessage(appLocale, "pages.reconciliation.notProvided");
}
