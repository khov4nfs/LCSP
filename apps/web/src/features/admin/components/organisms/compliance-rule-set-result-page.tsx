"use client";

import type { MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  LEGAL_CONTEXT_RELATION_KINDS,
} from "@lcsp/contracts/compliance-rule-set";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useComplianceRuleSetResultQuery } from "@/lib/api/compliance-rule-set-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleTimestamp } from "@/features/workspace/utils/assessment-runtime-formatter";
import type { ComplianceRuleSetResultPageProps } from "../../types/compliance-rule-set-result.types";
import { ComplianceRuleSetResultAssessmentRule } from "../molecules/compliance-rule-set-result-assessment-rule";
import { ComplianceRuleSetResultRequirement } from "../molecules/compliance-rule-set-result-requirement";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function ComplianceRuleSetResultPage({
  ruleSetVersionId,
}: ComplianceRuleSetResultPageProps) {
  const result = useComplianceRuleSetResultQuery(ruleSetVersionId);
  if (result.isPending) {
    return (
      <div className="flex flex-col gap-6 pb-12">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (result.isError) {
    const notFound =
      result.error.message === COMPLIANCE_RULE_SET_ERROR_CODES.ruleSetNotFound;
    return (
      <div className="flex flex-col gap-4">
        <Link
          className="text-sm font-medium text-primary underline underline-offset-4"
          href="/admin/compliance-rule-sets"
        >
          {t("pages.complianceRuleSets.result.backToHistory")}
        </Link>
        <Alert variant={notFound ? "default" : "destructive"}>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {t(
                notFound
                  ? "pages.complianceRuleSets.result.notFoundDescription"
                  : "pages.complianceRuleSets.result.loadErrorDescription",
              )}
            </span>
            {!notFound ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void result.refetch()}
              >
                {t("pages.complianceRuleSets.result.retry")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
        <h1 className="text-xl font-semibold">
          {t(
            notFound
              ? "pages.complianceRuleSets.result.notFoundTitle"
              : "pages.complianceRuleSets.result.loadErrorTitle",
          )}
        </h1>
      </div>
    );
  }

  const { ruleSet, legalSourceVersion, supersededAt } = result.data;
  const metadata = [
    ["version", ruleSet.version],
    ["sourceVersion", legalSourceVersion.version],
    [
      "activatedAt",
      ruleSet.activatedAt
        ? formatLocaleTimestamp(ruleSet.activatedAt)
        : t("pages.complianceRuleSets.result.noneStated"),
    ],
    [
      "supersededAt",
      supersededAt
        ? formatLocaleTimestamp(supersededAt)
        : t("pages.complianceRuleSets.result.noneStated"),
    ],
    ["digest", ruleSet.ruleSetDigest],
    ["requirements", String(ruleSet.legalRequirements.length)],
    ["assessmentRules", String(ruleSet.assessmentRules.length)],
  ];
  const relationCounts = Object.values(LEGAL_CONTEXT_RELATION_KINDS).map(
    (kind) =>
      [
        kind,
        ruleSet.contextRelations.filter((relation) => relation.kind === kind)
          .length,
      ] as const,
  );

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Link
        className="text-sm font-medium text-primary underline underline-offset-4"
        href="/admin/compliance-rule-sets"
      >
        {t("pages.complianceRuleSets.result.backToHistory")}
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {t("pages.complianceRuleSets.result.title")} · {ruleSet.version}
          </h1>
          <Badge variant="outline">
            {t(`pages.complianceRuleSets.states.${ruleSet.lifecycleState}`)}
          </Badge>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {ruleSet.ruleSetVersionId}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages.complianceRuleSets.state")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {metadata.map(([key, value]) => (
              <div key={key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t(`pages.complianceRuleSets.${key}`)}
                </dt>
                <dd
                  className={
                    key === "digest"
                      ? "break-all font-mono text-xs"
                      : "text-sm font-medium"
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("pages.complianceRuleSets.result.legalSource")}
          </CardTitle>
          <CardDescription>
            {legalSourceVersion.version} ·{" "}
            {legalSourceVersion.legalSourceVersionId}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {legalSourceVersion.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("pages.complianceRuleSets.result.noneStated")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {legalSourceVersion.documents.map((document) => (
                <li
                  key={document.documentId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium">
                      {document.title}
                    </span>
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {document.documentId}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {document.sourceEffectStatus}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("pages.complianceRuleSets.result.chunkCount")}:{" "}
                      {document.chunkCount}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t("pages.complianceRuleSets.requirements")} (
          {ruleSet.legalRequirements.length})
        </h2>
        {ruleSet.legalRequirements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.complianceRuleSets.result.noneStated")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {ruleSet.legalRequirements.map((requirement) => (
              <ComplianceRuleSetResultRequirement
                key={requirement.legalRequirementId}
                requirement={requirement}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t("pages.complianceRuleSets.assessmentRules")} (
          {ruleSet.assessmentRules.length})
        </h2>
        {ruleSet.assessmentRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.complianceRuleSets.result.noneStated")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {ruleSet.assessmentRules.map((rule) => (
              <ComplianceRuleSetResultAssessmentRule
                key={rule.assessmentRuleId}
                rule={rule}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("pages.complianceRuleSets.result.contextRelations")}
          </CardTitle>
          <CardDescription>
            {ruleSet.contextRelations.length === 0
              ? t("pages.complianceRuleSets.result.noneStated")
              : String(ruleSet.contextRelations.length)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {relationCounts.map(([kind, count]) => (
              <div key={kind} className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t(
                    `pages.complianceRuleSets.result.contextRelationKinds.${kind}`,
                  )}
                </dt>
                <dd className="text-sm font-medium">{count}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
