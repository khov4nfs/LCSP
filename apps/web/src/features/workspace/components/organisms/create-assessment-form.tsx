"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  createAssessmentFormSchema,
  type CreateAssessmentFormValues,
} from "../../schemas/create-assessment.schema";

/**
 * Business purpose:
 * Render the Frame 19 Create Assessment page with Zod-validated form inputs
 * and the 4-step post-creation setup guide ("Complete assessment setup").
 *
 * Business rules:
 * - Uses `react-hook-form` + `createAssessmentFormSchema` from sibling `schemas/`.
 * - Navigates to `/assessments/:id` only when the API returns `created`.
 *
 * Execution flow:
 * 1. Validate name and description on submit.
 * 2. Call `useCreateAssessmentMutation` and redirect to the new assessment.
 *
 * Failure cases:
 * - Validation errors display inline under the invalid field.
 * - Mutation failure renders a destructive Alert without navigating.
 *
 * Side effects:
 * - Creates a new assessment via BFF mutation and navigates via `router.push`.
 */
export function CreateAssessmentForm() {
  const router = useRouter();
  const create = useCreateAssessmentMutation();
  const form = useForm<CreateAssessmentFormValues>({
    resolver: zodResolver(createAssessmentFormSchema),
    defaultValues: { name: "", description: "" },
  });

  const setupSteps = [
    resolveAppMessage("pages.assessmentForm.setupStep1"),
    resolveAppMessage("pages.assessmentForm.setupStep2"),
    resolveAppMessage("pages.assessmentForm.setupStep3"),
    resolveAppMessage("pages.assessmentForm.setupStep4"),
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {resolveAppMessage("pages.assessmentForm.pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolveAppMessage("pages.assessmentForm.pageDescription")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
        <Card className="rounded-xl border-border bg-card shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">
              {resolveAppMessage("pages.assessmentForm.formTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-5"
              onSubmit={form.handleSubmit(async (values) => {
                const result = await create.mutateAsync(values);
                if (result.kind === API_OUTCOME_KINDS.created) {
                  router.push(`/assessments/${result.assessmentId}`);
                }
              })}
            >
              <FieldGroup>
                <Field data-invalid={Boolean(form.formState.errors.name)}>
                  <FieldLabel htmlFor="assessment-name">
                    {resolveAppMessage("pages.assessmentForm.nameLabel")}
                  </FieldLabel>
                  <Input
                    id="assessment-name"
                    placeholder={resolveAppMessage(
                      "pages.assessmentForm.namePlaceholder",
                    )}
                    {...form.register("name")}
                    disabled={create.isPending}
                    aria-invalid={Boolean(form.formState.errors.name)}
                  />
                  {form.formState.errors.name ? (
                    <FieldError>
                      {resolveAppMessage(
                        "pages.agenticAssessment.answerRequired",
                      )}
                    </FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(form.formState.errors.description)}>
                  <FieldLabel htmlFor="assessment-description">
                    {resolveAppMessage("pages.assessmentForm.descriptionLabel")}
                  </FieldLabel>
                  <Textarea
                    id="assessment-description"
                    rows={5}
                    placeholder={resolveAppMessage(
                      "pages.assessmentForm.descriptionPlaceholder",
                    )}
                    {...form.register("description")}
                    disabled={create.isPending}
                    aria-invalid={Boolean(form.formState.errors.description)}
                  />
                  {form.formState.errors.description ? (
                    <FieldError>
                      {resolveAppMessage(
                        "pages.agenticAssessment.answerRequired",
                      )}
                    </FieldError>
                  ) : null}
                </Field>
              </FieldGroup>

              {create.isError ||
              create.data?.kind === API_OUTCOME_KINDS.error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {resolveAppMessage(
                      "pages.agenticAssessment.requestFailed",
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button type="submit" disabled={create.isPending}>
                  {resolveAppMessage(
                    create.isPending
                      ? "pages.assessmentForm.submitting"
                      : "pages.assessmentForm.submit",
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={create.isPending}
                  onClick={() => router.push("/assessments")}
                >
                  {resolveAppMessage("pages.assessmentForm.cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <aside
          aria-label={resolveAppMessage("pages.assessmentForm.setupTitle")}
          className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-border bg-setup-surface p-5"
        >
          <span
            className="absolute top-3.5 left-0 h-10 w-1 rounded-r-xs bg-setup-accent"
            aria-hidden="true"
          />

          <div className="space-y-5 pl-2">
            <h2 className="text-xl font-semibold text-foreground">
              {resolveAppMessage("pages.assessmentForm.setupTitle")}
            </h2>

            <ol className="relative space-y-5">
              {setupSteps.map((stepLabel, index) => (
                <li key={stepLabel} className="flex items-start gap-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-setup-badge text-sm font-medium text-brand-deep">
                    {index + 1}
                  </span>
                  <span className="pt-1 text-sm font-medium text-foreground">
                    {stepLabel}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            {resolveAppMessage("pages.assessmentForm.setupDisclaimer")}
          </p>
        </aside>
      </div>
    </main>
  );
}
