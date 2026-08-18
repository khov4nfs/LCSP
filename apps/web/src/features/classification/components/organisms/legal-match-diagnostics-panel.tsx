"use client";

import { useEffect, useState } from "react";
import { resolveMessage } from "@lcsp/i18n";

import { apiRequest } from "@/lib/api/api-request";
import { appLocale } from "@/lib/locale";

type RuleEvaluation = {
  ruleId: string;
  status: string;
  rationale: string[];
  matchedRequiredFacts: string[];
  blockingFacts: string[];
};

type LegalMatchDiagnostics = {
  noMatchReason: string | null;
  ruleCount: number | null;
  candidateRuleCount: number | null;
  chunkCount: number | null;
  deterministicMatchCount: number | null;
  matchedWithoutCitationCount: number | null;
  matchCount: number | null;
  profileFactFields: string[];
  profileEvidenceFields: string[];
  evaluations: RuleEvaluation[];
  evaluationsTruncated: boolean;
  verifiedProfileId: string;
  corpusVersionId: string;
  legalRuleCatalogVersionId: string;
  snapshotId: string | null;
};

export function LegalMatchDiagnosticsPanel({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const [diagnostics, setDiagnostics] =
    useState<LegalMatchDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiRequest(`/api/assessments/${encodeURIComponent(assessmentId)}`, {
      cache: "no-store",
    }).then(({ ok, payload }) => {
      if (cancelled || !ok) return;
      const parsed = parseDiagnostics(payload);
      if (parsed) setDiagnostics(parsed);
    });

    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  if (!diagnostics) return null;

  const counters = [
    ["rule_count", diagnostics.ruleCount],
    ["candidate_rule_count", diagnostics.candidateRuleCount],
    ["chunk_count", diagnostics.chunkCount],
    ["deterministic_match_count", diagnostics.deterministicMatchCount],
    ["matched_without_citation_count", diagnostics.matchedWithoutCitationCount],
    ["match_count", diagnostics.matchCount],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-6 lg:px-6">
      <section className="grid gap-4 rounded-lg border bg-card p-5">
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            {resolveMessage(appLocale, "pages.classification.summaryLabel")}
          </p>
          <p className="mt-2 font-mono text-sm text-foreground">
            {diagnostics.noMatchReason ?? "NO_CITATION_BASIS"}
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {counters.map(([label, value]) => (
            <DiagnosticValue key={label} label={label} value={value} />
          ))}
        </dl>

        <dl className="grid gap-3 sm:grid-cols-2">
          <DiagnosticValue
            label="snapshot_id"
            value={diagnostics.snapshotId}
          />
          <DiagnosticValue
            label="verified_profile_id"
            value={diagnostics.verifiedProfileId}
          />
          <DiagnosticValue
            label="legal_rule_catalog_version_id"
            value={diagnostics.legalRuleCatalogVersionId}
          />
          <DiagnosticValue
            label="corpus_version_id"
            value={diagnostics.corpusVersionId}
          />
        </dl>

        {diagnostics.profileFactFields.length ? (
          <DiagnosticList
            label="profile_fact_fields"
            values={diagnostics.profileFactFields}
          />
        ) : null}

        {diagnostics.profileEvidenceFields.length ? (
          <DiagnosticList
            label="profile_evidence_fields"
            values={diagnostics.profileEvidenceFields}
          />
        ) : null}

        {diagnostics.evaluations.length ? (
          <div className="grid gap-3">
            {diagnostics.evaluations.map((evaluation) => (
              <article
                key={`${evaluation.ruleId}:${evaluation.status}`}
                className="rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-sm font-medium">{evaluation.ruleId}</code>
                  <span className="rounded-full border px-2.5 py-1 font-mono text-xs">
                    {evaluation.status}
                  </span>
                </div>

                {evaluation.rationale.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {evaluation.rationale.map((reason, index) => (
                      <li key={`${evaluation.ruleId}:rationale:${index}`}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {evaluation.matchedRequiredFacts.length ? (
                  <DiagnosticList
                    label="matched_required_facts"
                    values={evaluation.matchedRequiredFacts}
                    compact
                  />
                ) : null}

                {evaluation.blockingFacts.length ? (
                  <DiagnosticList
                    label="blocking_facts"
                    values={evaluation.blockingFacts}
                    compact
                  />
                ) : null}
              </article>
            ))}
            {diagnostics.evaluationsTruncated ? (
              <code className="text-xs text-muted-foreground">
                evaluations_truncated=true
              </code>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DiagnosticValue({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="font-mono text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm">
        {value === null ? "—" : value}
      </dd>
    </div>
  );
}

function DiagnosticList({
  label,
  values,
  compact = false,
}: {
  label: string;
  values: string[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-3" : "rounded-lg border p-4"}>
      <code className="text-xs text-muted-foreground">{label}</code>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <code
            key={`${label}:${value}`}
            className="rounded border bg-muted/40 px-2 py-1 text-xs"
          >
            {value}
          </code>
        ))}
      </div>
    </div>
  );
}

function parseDiagnostics(payload: unknown): LegalMatchDiagnostics | null {
  const root = record(payload);
  if (
    !root ||
    String(root.legal_rule_match_guardrail_status).toLowerCase() !== "blocked"
  ) {
    return null;
  }

  const value = record(root.legal_rule_match_diagnostics);
  if (!value) return null;

  const verifiedProfileId = requiredString(value.verified_profile_id);
  const corpusVersionId = requiredString(value.corpus_version_id);
  const legalRuleCatalogVersionId = requiredString(
    value.legal_rule_catalog_version_id,
  );
  if (!verifiedProfileId || !corpusVersionId || !legalRuleCatalogVersionId) {
    return null;
  }

  return {
    noMatchReason: optionalString(value.no_match_reason),
    ruleCount: optionalCount(value.rule_count),
    candidateRuleCount: optionalCount(value.candidate_rule_count),
    chunkCount: optionalCount(value.chunk_count),
    deterministicMatchCount: optionalCount(value.deterministic_match_count),
    matchedWithoutCitationCount: optionalCount(
      value.matched_without_citation_count,
    ),
    matchCount: optionalCount(value.match_count),
    profileFactFields: strings(value.profile_fact_fields),
    profileEvidenceFields: strings(value.profile_evidence_fields),
    evaluations: records(value.evaluations)
      .map(parseEvaluation)
      .filter((item): item is RuleEvaluation => item !== null),
    evaluationsTruncated: value.evaluations_truncated === true,
    verifiedProfileId,
    corpusVersionId,
    legalRuleCatalogVersionId,
    snapshotId: optionalString(value.snapshot_id),
  };
}

function parseEvaluation(value: Record<string, unknown>): RuleEvaluation | null {
  const ruleId = requiredString(value.rule_id);
  const status = requiredString(value.status);
  if (!ruleId || !status) return null;
  return {
    ruleId,
    status,
    rationale: strings(value.rationale),
    matchedRequiredFacts: strings(value.matched_required_facts),
    blockingFacts: strings(value.blocking_facts),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = record(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
