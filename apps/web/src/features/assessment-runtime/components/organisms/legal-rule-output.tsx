"use client";

import { useRef, useState } from "react";
import {
  ScaleIcon,
  ShieldCheckIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  FileCode2Icon,
  BookOpenIcon,
  ListTreeIcon,
  InfoIcon,
  MessageSquareShareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "@lcsp/contracts/assessment";
import {
  useAssessmentDetailQuery,
  useAssessmentProvenanceQuery,
} from "@/lib/api/assessment-domain-queries";
import { useRuleAuditCatalogQuery } from "@/lib/api/rule-audit-queries";
import { useActiveLegalLibraryQuery } from "@/lib/api/legal-source-queries";
import type { DecisionTurn } from "../../types/conversation.types";
import { buildLegalRulePresentationModel } from "../../utils/legal-rule-presentation";
import { copy } from "../../utils/conversation-copy";
import { ComplianceStepFlow } from "../molecules/compliance-step-flow";
import { RawLegalRuleViewer } from "../molecules/raw-legal-rule-viewer";
import { EvidenceRelationshipViewer } from "../molecules/evidence-relationship-viewer";
import { ComplianceReasoningSummary } from "../molecules/compliance-reasoning-summary";

type LegalRuleOutputProps = {
  turn: DecisionTurn;
};

type ActiveDetailSection = "evidence" | "rawRule" | "synthesis" | "applicability" | null;

/**
 * Business purpose: Present a recorded compliance decision with its legal basis and evidence.
 * Business rules: Keep source content intact and translate interface captions using the active locale.
 * Execution flow:
 * 1. Resolve the decision, linked sources and evidence into the existing presentation model.
 * 2. Show the result and let customers expand its supporting details or ask a follow-up question.
 * Failure cases: Missing supporting records use the presentation model's existing fallbacks.
 * Side effects: Reads cached assessment queries and updates local disclosure and composer state.
 */
export function LegalRuleOutput({ turn }: LegalRuleOutputProps) {
  const assessmentId = turn.record.assessmentId;
  const detailQuery = useAssessmentDetailQuery(assessmentId);
  const catalogQuery = useRuleAuditCatalogQuery(assessmentId);
  const libraryQuery = useActiveLegalLibraryQuery();
  const provenanceQuery = useAssessmentProvenanceQuery(assessmentId);

  // Progressive disclosure: default to collapsed executive view for instant scannability
  const [activeSection, setActiveSection] = useState<ActiveDetailSection>(null);

  const applicabilityRef = useRef<HTMLDivElement>(null);
  const obligationRef = useRef<HTMLDivElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const conclusionRef = useRef<HTMLDivElement>(null);
  const rawRuleRef = useRef<HTMLDivElement>(null);

  const model = buildLegalRulePresentationModel({
    turn,
    catalog: catalogQuery.data,
    library: libraryQuery.data,
    provenance: provenanceQuery.data,
    detail: detailQuery.data,
  });

  const isCompliant =
    model.compliance.outcome === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;
  const isNonCompliant =
    model.compliance.outcome ===
    RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT;

  const toggleSection = (section: ActiveDetailSection) => {
    setActiveSection((curr) => (curr === section ? null : section));
  };

  const handleSelectStep = (step: string) => {
    const stepToSection: Record<string, ActiveDetailSection> = {
      rule: "rawRule",
      applicability: "applicability",
      obligation: "applicability",
      assessment: "synthesis",
      evidence: "evidence",
      conclusion: "synthesis",
    };
    setActiveSection(stepToSection[step] ?? "synthesis");
  };

  const handleNavigateToObligation = (criterionId?: string | null) => {
    setActiveSection("applicability");
    if (criterionId) {
      setTimeout(() => {
        const el = document.getElementById(`criterion-${criterionId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-primary");
          setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
        }
      }, 100);
    }
  };

  /**
   * Business purpose: Help the customer ask about the currently displayed legal requirement.
   * Business rules: Use the selected language and preserve the requirement's concept and locator.
   * Execution flow:
   * 1. Build the translated question and focus the existing composer when present.
   * Failure cases: Without a composer, no draft is changed.
   * Side effects: Replaces the local composer draft; does not submit a message.
   */
  const handleAskAboutRule = () => {
    const prompt = copy("decision.askAboutRulePrompt", {
      concept: model.identity.concept,
      locator: model.identity.locator,
    });
    const composer = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      'textarea[data-slot="chat-input"], input[data-slot="chat-input"], textarea',
    );
    if (composer) {
      composer.value = prompt;
      composer.focus();
    }
  };

  const primaryEvidence = model.evidenceList[0];

  return (
    <article
      id={`decision-${turn.decisionId}`}
      data-slot="legal-rule-output"
      data-decision-id={turn.decisionId}
      data-decision-outcome={model.compliance.outcome}
      data-rule-id={turn.assessmentRuleId}
      className={cn(
        "flex w-full flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5 shadow-xs transition-all",
        isCompliant
          ? "border-emerald-500/30 hover:border-emerald-500/50"
          : isNonCompliant
            ? "border-rose-500/30 hover:border-rose-500/50"
            : "border-border/80 hover:border-border",
      )}
    >
      {/* 1. EXECUTIVE VERDICT HEADER (Nhìn phát biết kết quả liền trong 2 giây) */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground tracking-tight break-words">
                {model.identity.concept}
              </h3>
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 text-primary font-semibold text-xs"
              >
                <ShieldCheckIcon className="mr-1 size-3.5" aria-hidden="true" />
                {copy("decision.applicableRuleBadge")}
              </Badge>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpenIcon className="size-3.5 text-primary shrink-0" aria-hidden="true" />
              <span className="font-medium text-foreground/80 break-words">
                {model.identity.documentTitle} · {model.identity.locator}
              </span>
            </div>
          </div>

          {/* Compliance Outcome Badge - High Visual Contrast */}
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              data-slot="compliance-outcome-badge"
              variant={isCompliant ? "default" : isNonCompliant ? "destructive" : "secondary"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold tracking-wide shadow-xs",
                isCompliant && "bg-emerald-600 text-white hover:bg-emerald-600/90",
                isNonCompliant && "bg-rose-600 text-white hover:bg-rose-600/90",
              )}
            >
              {isCompliant ? (
                <>
                  <CheckCircle2Icon className="size-4" aria-hidden="true" />
                  <span>{copy("decision.outcomes.COMPLIANT")}</span>
                </>
              ) : isNonCompliant ? (
                <>
                  <AlertTriangleIcon className="size-4" aria-hidden="true" />
                  <span>{copy("decision.outcomes.NON_COMPLIANT")}</span>
                </>
              ) : (
                <>
                  <AlertTriangleIcon className="size-4" aria-hidden="true" />
                  <span>{copy("decision.outcomes.UNDETERMINED")}</span>
                </>
              )}
            </Badge>
          </div>
        </div>

        {/* BOTTOM-LINE VERDICT BANNER (Không văn bản thừa, lãnh đạo đọc 1 câu hiểu ngay) */}
        <div
          className={cn(
            "rounded-lg border p-3.5 transition-colors",
            isCompliant
              ? "border-emerald-500/30 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-950/20"
              : isNonCompliant
                ? "border-rose-500/30 bg-rose-50/40 dark:border-rose-500/20 dark:bg-rose-950/20"
                : "border-amber-500/30 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-950/20",
          )}
        >
          <div className="flex items-start gap-3">
            {isCompliant ? (
              <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            ) : isNonCompliant ? (
              <AlertTriangleIcon className="size-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <InfoIcon className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <div className="flex-1 space-y-1">
              <div className="font-semibold text-sm text-foreground">
                {isCompliant
                  ? copy("decision.verdict.compliant")
                  : isNonCompliant
                    ? copy("decision.verdict.nonCompliant")
                    : copy("decision.verdict.undetermined")}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {model.compliance.rationale}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Highlights: File code vi phạm, nghĩa vụ (scannable chips) */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {primaryEvidence?.path ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 font-mono text-[11px] text-foreground">
              <FileCode2Icon className="size-3 text-muted-foreground" aria-hidden="true" />
              <span>{primaryEvidence.path}</span>
              {primaryEvidence.startLine && (
                <span className="text-muted-foreground">
                  (L{primaryEvidence.startLine}–{primaryEvidence.endLine})
                </span>
              )}
            </span>
          ) : null}

          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
            <ScaleIcon className="size-3 text-muted-foreground" aria-hidden="true" />
            <span>{model.obligation.summary || model.obligation.title}</span>
          </span>
        </div>
      </header>

      {/* 2. PROGRESSIVE DISCLOSURE ACTION BAR (Các nút bấm xem chi tiết khi người dùng cần) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-b border-border/60 py-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={copy("decision.details")}>
          <Button
            type="button"
            variant={activeSection === "evidence" ? "secondary" : "outline"}
            size="sm"
            onClick={() => toggleSection("evidence")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <FileCode2Icon className="size-3.5 text-primary" aria-hidden="true" />
            <span>{copy("decision.viewEvidence", { count: model.evidenceList.length })}</span>
            {activeSection === "evidence" ? (
              <ChevronUpIcon className="size-3" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-3" aria-hidden="true" />
            )}
          </Button>

          <Button
            type="button"
            variant={activeSection === "rawRule" ? "secondary" : "outline"}
            size="sm"
            onClick={() => toggleSection("rawRule")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <BookOpenIcon className="size-3.5 text-indigo-500" aria-hidden="true" />
            <span>{copy("decision.rawLegalRule")}</span>
            {activeSection === "rawRule" ? (
              <ChevronUpIcon className="size-3" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-3" aria-hidden="true" />
            )}
          </Button>

          <Button
            type="button"
            variant={activeSection === "synthesis" ? "secondary" : "outline"}
            size="sm"
            onClick={() => toggleSection("synthesis")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <ListTreeIcon className="size-3.5 text-purple-500" aria-hidden="true" />
            <span>{copy("decision.reasoning")}</span>
            {activeSection === "synthesis" ? (
              <ChevronUpIcon className="size-3" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-3" aria-hidden="true" />
            )}
          </Button>

          <Button
            type="button"
            variant={activeSection === "applicability" ? "secondary" : "outline"}
            size="sm"
            onClick={() => toggleSection("applicability")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <InfoIcon className="size-3.5 text-sky-500" aria-hidden="true" />
            <span>{copy("decision.applicabilityTitle")}</span>
            {activeSection === "applicability" ? (
              <ChevronUpIcon className="size-3" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-3" aria-hidden="true" />
            )}
          </Button>
        </div>

        <Button
          type="button"
          data-slot="ask-follow-up-rule"
          variant="outline"
          size="sm"
          onClick={handleAskAboutRule}
          className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10 gap-1.5 ml-auto"
        >
          <MessageSquareShareIcon className="size-3.5" aria-hidden="true" />
          <span>{copy("decision.askAboutRule")}</span>
        </Button>
      </div>

      {/* 3. 6-STEP VISUAL PIPELINE (Chu trình trực quan khép kín) */}
      <ComplianceStepFlow
        activeStep={
          activeSection === "rawRule"
            ? "rule"
            : activeSection === "applicability"
              ? "applicability"
              : activeSection === "evidence"
                ? "evidence"
                : activeSection === "synthesis"
                  ? "conclusion"
                  : undefined
        }
        onSelectStep={handleSelectStep}
        outcome={model.compliance.outcome}
      />

      {/* 4. DETAIL DRAWERS (Chỉ bung mở khi người dùng bấm nút tương ứng) */}
      <div className="space-y-4">
        {/* Detail A: Evidence Relationship Viewer */}
        <div
          ref={evidenceRef}
          className={cn(activeSection === "evidence" ? "block" : "hidden")}
        >
          <section
            aria-labelledby={`evidence-title-${turn.decisionId}`}
            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-4 shadow-2xs"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileCode2Icon className="size-4 text-primary" aria-hidden="true" />
                <h4 id={`evidence-title-${turn.decisionId}`}>
                  {copy("decision.evidenceAndTraceabilityTitle")}
                </h4>
              </div>
              <span className="text-xs text-muted-foreground font-medium">
                {copy("decision.evidenceCount", { count: model.evidenceList.length })}
              </span>
            </header>
            <EvidenceRelationshipViewer
              evidenceList={model.evidenceList}
              hasEvidenceGap={model.hasEvidenceGap}
              onNavigateToObligation={handleNavigateToObligation}
            />
          </section>
        </div>

        {/* Detail B: Raw Legal Rule Viewer */}
        <div
          ref={rawRuleRef}
          className={cn(activeSection === "rawRule" ? "block" : "hidden")}
        >
          <RawLegalRuleViewer
            documentTitle={model.identity.documentTitle}
            documentNumber={model.identity.documentNumber}
            locator={model.identity.locator}
            sourceUrl={model.identity.sourceUrl}
            effectiveStatus={model.identity.effectiveStatus}
            effectiveDate={model.identity.effectiveDate}
            documentRowId={model.identity.documentRowId}
            hasOriginal={model.identity.hasOriginal}
          />
        </div>

        {/* Detail C: 5-Step Reasoning Synthesis */}
        <div
          ref={conclusionRef}
          className={cn(activeSection === "synthesis" ? "block" : "hidden")}
        >
          <section
            aria-labelledby={`synthesis-title-${turn.decisionId}`}
            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-4 shadow-2xs"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ListTreeIcon className="size-4 text-purple-500" aria-hidden="true" />
                <h4 id={`synthesis-title-${turn.decisionId}`}>
                  {copy("decision.reasoningAndConclusionTitle")}
                </h4>
              </div>
            </header>
            <ComplianceReasoningSummary
              synthesis={model.synthesis}
              outcome={model.compliance.outcome}
              onAskAboutRule={handleAskAboutRule}
            />
          </section>
        </div>

        {/* Detail D: Applicability & Legal Basis */}
        <div
          ref={applicabilityRef}
          className={cn(activeSection === "applicability" ? "block" : "hidden")}
        >
          <div
            data-slot="applicability-explanation"
            className="flex flex-col gap-4 rounded-lg border border-border/70 bg-card p-4 shadow-2xs text-xs"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <InfoIcon className="size-4 text-sky-500" aria-hidden="true" />
                <h4 id={`applicability-title-${turn.decisionId}`}>
                  {copy("decision.applicabilityTitle")}
                </h4>
              </div>
            </header>

            {/* Target Activity */}
            <div className="space-y-1">
              <span className="font-semibold text-foreground">
                1. {copy("decision.targetActivity")}:
              </span>
              <p className="text-muted-foreground leading-relaxed pl-3.5">
                {model.applicability.targetActivity}
              </p>
            </div>

            {/* Applicability Criteria */}
            <div className="space-y-1">
              <span className="font-semibold text-foreground">
                2. {copy("decision.applicabilityCriteria")}:
              </span>
              <p className="text-muted-foreground leading-relaxed pl-3.5">
                {model.applicability.conditions.join("; ") || model.applicability.targetActivity}
              </p>
            </div>

            {/* Supporting Basis */}
            <div className="space-y-1">
              <span className="font-semibold text-foreground">
                3. {copy("decision.supportingBasis")}:
              </span>
              <p className="text-muted-foreground leading-relaxed pl-3.5">
                {model.applicability.basisFindings.map((b) => b.rationale).join("; ") || model.applicability.targetActivity}
              </p>
            </div>

            {/* Criteria Breakdown (Không hiển thị ID kỹ thuật) */}
            {model.obligation.criteria.length > 0 && (
              <div ref={obligationRef} className="pt-2 border-t border-border/40">
                <span className="font-semibold text-foreground block mb-2">
                  {copy("decision.criteria")} ({model.obligation.criteria.length}):
                </span>
                <ul className="flex flex-col gap-2">
                  {model.obligation.criteria.map((criterion, idx) => {
                    const isCritMet =
                      criterion.outcome === "MET" || criterion.outcome === "SATISFIED";
                    return (
                      <li
                        key={idx}
                        id={`criterion-${criterion.criterionId}`}
                        className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 p-2.5 transition-shadow"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground">
                            {criterion.rationale || copy("decision.criterionTitle")}
                          </span>
                          <Badge
                            variant={isCritMet ? "outline" : "destructive"}
                            className="text-[11px] py-0 shrink-0"
                          >
                            {copy(`decision.outcomes.${criterion.outcome}`)}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
