"use client";
import { useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";
import { HUMAN_RESOLUTION_CONTROL_TYPES } from "@lcsp/contracts/assessment-domain";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAnswerHumanRequestMutation } from "@/lib/api/assessment-domain-queries";
import {
  humanResolutionAnswerFormSchema,
  type HumanResolutionAnswerFormValues,
} from "../../schemas/human-resolution-answer.schema";

const t = (key: MessageKey) => resolveMessage(appLocale, key);

export function HumanResolutionForm({
  assessmentId,
  request,
  caseRevision,
}: {
  assessmentId: string;
  request: AssessmentHumanRequestView;
  caseRevision: number;
}) {
  const answer = useAnswerHumanRequestMutation(assessmentId, request.requestId);
  const replayKey = useRef<{ key: string; digest: string } | null>(null);
  const form = useForm<HumanResolutionAnswerFormValues>({
    resolver: zodResolver(humanResolutionAnswerFormSchema),
    defaultValues: { doesNotKnow: false, answer: "" },
  });
  const doesNotKnow = useWatch({ control: form.control, name: "doesNotKnow" });
  const answerId = `answer-${request.requestId}`;
  async function submit(values: HumanResolutionAnswerFormValues) {
    const packet = {
      expectedCaseRevision: caseRevision,
      expectedRequestRevision: request.requestRevision,
      ...(values.doesNotKnow
        ? { doesNotKnow: true as const }
        : { doesNotKnow: false as const, answer: values.answer }),
    };
    const digest = JSON.stringify(packet);
    if (replayKey.current?.digest !== digest)
      replayKey.current = { key: crypto.randomUUID(), digest };
    await answer
      .mutateAsync({ ...packet, idempotencyKey: replayKey.current.key })
      .catch(() => undefined);
  }

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit(submit)(event);
      }}
      className="flex flex-col gap-4 rounded-lg border p-4"
      data-human-request={request.requestId}
    >
      <FieldGroup>
        <Field data-invalid={Boolean(form.formState.errors.answer)}>
          <FieldLabel htmlFor={answerId}>{request.question}</FieldLabel>
          {!doesNotKnow ? (
            request.controlType ===
            HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT ? (
              <Controller
                control={form.control}
                name="answer"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    disabled={answer.isPending}
                  >
                    <SelectTrigger id={answerId}>
                      <SelectValue
                        placeholder={t("pages.agenticAssessment.selectAnswer")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {request.choices.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
            ) : (
              <Textarea
                id={answerId}
                {...form.register("answer")}
                disabled={answer.isPending}
                aria-invalid={Boolean(form.formState.errors.answer)}
              />
            )
          ) : null}
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="doesNotKnow"
            render={({ field }) => (
              <Switch
                id={`${answerId}-unknown`}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                disabled={answer.isPending}
              />
            )}
          />
          <FieldLabel htmlFor={`${answerId}-unknown`}>
            {t("pages.agenticAssessment.doesNotKnow")}
          </FieldLabel>
        </Field>
        {form.formState.errors.answer ? (
          <FieldError>{t("pages.agenticAssessment.answerRequired")}</FieldError>
        ) : null}
        {request.answers.at(-1)?.doesNotKnow ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.agenticAssessment.unknownRecorded")}
          </p>
        ) : null}
        {answer.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {t("pages.agenticAssessment.requestFailed")}
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
      <Button type="submit" disabled={answer.isPending}>
        {t(
          answer.isPending
            ? "pages.agenticAssessment.saving"
            : "pages.agenticAssessment.submitFact",
        )}
      </Button>
    </form>
  );
}
