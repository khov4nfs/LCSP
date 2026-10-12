"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resolveAppMessage } from "@/lib/i18n";
import {
  createAssessmentFormSchema,
  type CreateAssessmentFormValues,
} from "../../schemas/create-assessment.schema";

export function CreateAssessmentForm() {
  const router = useRouter();
  const create = useCreateAssessmentMutation();
  const form = useForm<CreateAssessmentFormValues>({
    resolver: zodResolver(createAssessmentFormSchema),
    defaultValues: { name: "", description: "" },
  });
  return (
    <main className="mx-auto flex w-full max-w-180 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">
        {resolveAppMessage("pages.workspace.createAssessment")}
      </h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(async (values) => {
          const result = await create.mutateAsync(values);
          if (result.kind === API_OUTCOME_KINDS.created)
            router.push(`/assessments/${result.assessmentId}`);
        })}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.name)}>
            <FieldLabel htmlFor="assessment-name">
              {resolveAppMessage("pages.assessmentForm.nameLabel")}
            </FieldLabel>
            <Input
              id="assessment-name"
              {...form.register("name")}
              disabled={create.isPending}
              aria-invalid={Boolean(form.formState.errors.name)}
            />
            {form.formState.errors.name ? (
              <FieldError>
                {resolveAppMessage("pages.agenticAssessment.answerRequired")}
              </FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="assessment-description">
              {resolveAppMessage("pages.assessmentForm.descriptionLabel")}
            </FieldLabel>
            <Textarea
              id="assessment-description"
              {...form.register("description")}
              disabled={create.isPending}
              aria-invalid={Boolean(form.formState.errors.description)}
            />
            {form.formState.errors.description ? (
              <FieldError>
                {resolveAppMessage("pages.agenticAssessment.answerRequired")}
              </FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        {create.isError || create.data?.kind === API_OUTCOME_KINDS.error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {resolveAppMessage("pages.agenticAssessment.requestFailed")}
            </AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={create.isPending}>
          {resolveAppMessage(
            create.isPending
              ? "pages.agenticAssessment.saving"
              : "pages.workspace.createAssessment",
          )}
        </Button>
      </form>
    </main>
  );
}
