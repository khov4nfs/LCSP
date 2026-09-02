"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ASSESSMENT_NAME_MAX_LENGTH,
  ASSESSMENT_DESCRIPTION_MAX_LENGTH,
} from "@lcsp/contracts/assessment";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";

export function CreateAssessmentForm() {
  const router = useRouter();
  const createAssessmentMutation = useCreateAssessmentMutation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [hasError, setHasError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setHasError(false);
    const outcome = await createAssessmentMutation.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    if (outcome.kind === "created") {
      router.push(`/assessments/${outcome.assessmentId}`);
      return;
    }
    setHasError(true);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {t("pages.assessmentForm.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("pages.assessmentForm.pageDescription")}
        </p>
      </header>
      {hasError ? (
        <Alert variant="destructive">
          <AlertTitle>
            {t("pages.workspace.errors.createAssessmentTitle")}
          </AlertTitle>
          <AlertDescription>
            {t("pages.workspace.errors.createAssessmentDetail")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.assessmentForm.formTitle")}</CardTitle>
          <CardDescription>
            {t("pages.assessmentForm.formDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="assessment-name">
                  {t("pages.assessmentForm.nameLabel")}
                </FieldLabel>
                <Input
                  id="assessment-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("pages.assessmentForm.namePlaceholder")}
                  required
                  maxLength={ASSESSMENT_NAME_MAX_LENGTH}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="assessment-description">
                  {t("pages.assessmentForm.descriptionLabel")}
                </FieldLabel>
                <Textarea
                  id="assessment-description"
                  className="min-h-24"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("pages.assessmentForm.descriptionPlaceholder")}
                  maxLength={ASSESSMENT_DESCRIPTION_MAX_LENGTH}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/assessments")}
              >
                {t("pages.assessmentForm.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createAssessmentMutation.isPending}
              >
                {createAssessmentMutation.isPending
                  ? t("pages.assessmentForm.submitting")
                  : t("pages.assessmentForm.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
