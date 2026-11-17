"use client";
import { useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  legalRuleCatalogSchema,
  legalRuleSavedSchema,
  type LegalRuleListItem,
} from "@lcsp/contracts/legal-rule-catalog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useLegalRuleCommand } from "@/lib/api/legal-rule-catalog-queries";
import { useLegalSourceListQuery } from "@/lib/api/legal-source-queries";
import {
  legalRuleCatalogFormSchema,
  legalRuleFormSchema,
  parseCatalogCitations,
} from "../../schemas/legal-rule-catalog-form.schema";
import type {
  CatalogFormValues,
  RuleFormValues,
} from "../../types/legal-rule-catalog.types";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { LegalRuleCatalogField } from "./legal-rule-catalog-field";

/**
 * Business purpose: Create an explicit catalog as the first step of the integrated Preparation workflow.
 * Business rules:
 * - Admin supplies the source/version; the API never creates source-derived LegalRule records.
 * Execution flow:
 * 1. Validate the form
 * 2. Submit once
 * 3. Select the acknowledged catalog.
 * Failure cases:
 * - Validation and API failures remain visible and keep form input.
 * Side effects:
 * - An explicitly submitted catalog API mutation.
 */
export function LegalRuleCatalogCreateForm({
  sourceId,
  onCreated,
}: {
  sourceId: string;
  onCreated: (id: string) => void;
}) {
  const sourcesQuery = useLegalSourceListQuery();
  const availableSources = useMemo(() => {
    return (sourcesQuery.data?.items ?? []).flatMap((src) => {
      const v = src.activeVersion ?? src.latestVersion;
      if (!v) return [];
      return [
        {
          versionId: v.id,
          displayName: `${src.name} · ${v.version}`,
          versionName: v.version,
        },
      ];
    });
  }, [sourcesQuery.data]);

  const form = useForm<CatalogFormValues>({
    resolver: zodResolver(legalRuleCatalogFormSchema),
    defaultValues: { version: "", legalSourceVersionId: sourceId },
  });

  useEffect(() => {
    if (availableSources.length > 0) {
      const current = form.getValues("legalSourceVersionId");
      const match =
        availableSources.find((s) => s.versionId === current) ??
        availableSources.find((s) => s.versionId === sourceId) ??
        availableSources[0];

      if (match && current !== match.versionId) {
        form.setValue("legalSourceVersionId", match.versionId, {
          shouldValidate: true,
        });
      }
      if (match && !form.getValues("version")) {
        form.setValue("version", `${match.versionName}-catalog`, {
          shouldValidate: true,
        });
      }
    }
  }, [availableSources, sourceId, form]);

  const save = useLegalRuleCommand("", legalRuleCatalogSchema);
  return (
    <FormProvider {...form}>
      <form
        className="grid gap-4 pt-1"
        onSubmit={form.handleSubmit(async (input) => {
          const result = await save.mutateAsync(input).catch(() => null);
          if (result) onCreated(result.id);
        })}
      >
        <div className="space-y-2">
          <Label>{t("sourceSelectLabel")}</Label>
          <Select
            value={form.watch("legalSourceVersionId")}
            onValueChange={(val) => {
              if (!val) return;
              form.setValue("legalSourceVersionId", val, {
                shouldValidate: true,
              });
              const match = availableSources.find((s) => s.versionId === val);
              if (match) {
                form.setValue("version", `${match.versionName}-catalog`, {
                  shouldValidate: true,
                });
              }
            }}
          >
            <SelectTrigger aria-label={t("sourceSelectLabel")}>
              <SelectValue placeholder={t("chooseSource")}>
                {availableSources.find(
                  (s) => s.versionId === form.watch("legalSourceVersionId"),
                )?.displayName ?? t("chooseSource")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableSources.map((s) => (
                <SelectItem key={s.versionId} value={s.versionId}>
                  {s.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <LegalRuleCatalogField name="version" label="version" />
        {save.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t("error")}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          disabled={save.isPending || !form.watch("legalSourceVersionId")}
          type="submit"
        >
          {save.isPending ? t("loading") : t("create")}
        </Button>
      </form>
    </FormProvider>
  );
}

/**
 * Business purpose: Add or update the selected catalog's explicitly authored canonical rule.
 * Business rules:
 * - Rule identity is stable during edits; source validation and optimistic catalog revision checks belong to the API.
 * Execution flow:
 * 1. Validate fields and locator pairs
 * 2. Submit the current revision
 * 3. Close on acknowledgement.
 * Failure cases:
 * - Invalid/stale references and API failures retain the editor with a visible error.
 * Side effects:
 * - One explicit rule save and catalog-cache refresh; no preparation is triggered.
 */
export function LegalRuleCatalogRuleForm({
  catalogId,
  revision,
  rule,
  onSaved,
}: {
  catalogId: string;
  revision: number;
  rule: LegalRuleListItem | null;
  onSaved: () => void;
}) {
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(legalRuleFormSchema),
    defaultValues: {
      legalRuleId: rule?.legalRuleId ?? "",
      title: rule?.title ?? "",
      description: rule?.description ?? "",
      citations:
        rule?.citationLocatorRefs
          .map((ref) => `${ref.documentId}|${ref.locator}`)
          .join("\n") ?? "",
    },
  });
  const save = useLegalRuleCommand(`/${catalogId}/rules`, legalRuleSavedSchema);
  return (
    <FormProvider {...form}>
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit(async ({ citations, ...input }) => {
          const result = await save
            .mutateAsync({
              ...input,
              citationLocatorRefs: parseCatalogCitations(citations),
              expectedRevision: revision,
            })
            .catch(() => null);
          if (result) onSaved();
        })}
      >
        <LegalRuleCatalogField
          name="legalRuleId"
          label="ruleId"
          readOnly={!!rule}
        />
        <LegalRuleCatalogField name="title" label="ruleTitle" />
        <LegalRuleCatalogField
          name="description"
          label="ruleDescription"
          multiline
        />
        <LegalRuleCatalogField name="citations" label="citations" multiline />
        <p className="text-sm text-muted-foreground">{t("citationHelp")}</p>
        {save.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t("error")}</AlertDescription>
          </Alert>
        ) : null}
        <Button disabled={save.isPending} type="submit">
          {save.isPending ? t("loading") : t("save")}
        </Button>
      </form>
    </FormProvider>
  );
}
