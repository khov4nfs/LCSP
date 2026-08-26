import type { CitationLocatorRef } from "../../services/citation-locator-validator.service.js";

export class DraftLegalRuleCommand {
  constructor(
    public readonly legalRuleId: string,
    public readonly ruleFamily: string,
    public readonly requiredFacts: Record<string, unknown>,
    public readonly optionalFacts: Record<string, unknown> | null,
    public readonly blockingFacts: Record<string, unknown> | null,
    public readonly unknownFactPolicy: string,
    public readonly citationLocatorRefs: CitationLocatorRef[],
    public readonly authoredBy: string,
    public readonly legalRuleCatalogVersionId: string,
    public readonly correlationId: string,
  ) {}
}
