import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_DECISION_RECORD_STATES } from "@lcsp/contracts/assessment-domain";
import { ChatMessage } from "@/components/molecules/chat-message";
import { CHAT_MESSAGE_ROLES } from "@/components/types/chat.types";
import { cn } from "@/lib/utils";
import type { DecisionTurn } from "../../types/conversation.types";
import { copy } from "../../utils/conversation-copy";

const DISCLOSURE =
  "cursor-pointer list-none rounded-md select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden";

/** An accepted rule decision as assistant output; evidence, criteria and ids stay behind expanders. */
export function ConversationDecisionTurn({ turn }: { turn: DecisionTurn }) {
  const { decision } = turn.record;
  const outcome = decision.compliance ?? decision.applicability;
  const unfavourable =
    decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT;
  return (
    <ChatMessage role={CHAT_MESSAGE_ROLES.agent}>
      <article
        id={`decision-${turn.decisionId}`}
        data-decision-id={turn.decisionId}
        data-decision-outcome={outcome}
        className="flex flex-col gap-2"
      >
        <header className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="font-medium">
            {turn.concept ??
              copy("decision.ruleFallback", { id: turn.assessmentRuleId })}
          </h3>
          <span
            className={cn(
              "text-sm font-medium",
              unfavourable ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {copy(`decision.outcomes.${outcome}`)}
          </span>
          {turn.record.state !== ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED ? (
            <span className="text-xs text-muted-foreground">
              {turn.record.state === ASSESSMENT_DECISION_RECORD_STATES.SUPERSEDED
                ? copy("decision.superseded")
                : copy("decision.invalidated")}
            </span>
          ) : null}
        </header>
        <p className="whitespace-pre-wrap">{decision.rationale}</p>
        {decision.criteria.length > 0 ? (
          <details className="text-sm text-muted-foreground">
            <summary className={DISCLOSURE}>{copy("decision.criteria")}</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {decision.criteria.map((criterion) => (
                <li key={criterion.criterionId}>
                  <span className="font-medium">
                    {copy(`decision.outcomes.${criterion.outcome}`)}
                  </span>{" "}
                  {criterion.rationale}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {decision.references.length > 0 ? (
          <details className="text-sm text-muted-foreground">
            <summary className={DISCLOSURE}>
              {copy("decision.evidence")} ·{" "}
              {copy("decision.evidenceCount", {
                count: decision.references.length,
              })}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px]">
              {decision.references.map((reference) => (
                <li key={JSON.stringify(reference)} className="break-all">
                  {reference.type}:{" "}
                  {"evidenceId" in reference
                    ? reference.evidenceId
                    : reference.factId}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details className="text-xs text-muted-foreground">
          <summary className={DISCLOSURE}>
            {copy("work.technicalDetails")}
          </summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <dt>rule</dt>
            <dd className="break-all">{turn.assessmentRuleId}</dd>
            <dt>decision</dt>
            <dd className="break-all">{turn.decisionId}</dd>
            <dt>revision</dt>
            <dd>{turn.record.decisionRevision}</dd>
            <dt>scope</dt>
            <dd className="break-all">{turn.record.scopeId}</dd>
          </dl>
        </details>
      </article>
    </ChatMessage>
  );
}
