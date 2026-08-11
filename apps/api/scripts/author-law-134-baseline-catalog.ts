type Fact = {
  field: string;
  expectedValue: unknown;
};

type Citation = {
  locator: string;
};

type Rule = {
  legalRuleId: string;
  ruleFamily: string;
  requiredFacts: Fact[];
  citations: Citation[];
};

type DeferredRule = {
  legalBasis: string;
  reason: string;
};

type ResultEnvelope<T> = {
  ok: boolean;
  data?: T;
  problem?: { code?: string; detailKey?: string };
};

const documentId = "LAW-134-2025-QH15";
const unknownFactPolicy = "BLOCK_ON_UNKNOWN";
const unknownValues = new Set([
  "UNKNOWN",
  "UNCLEAR",
  "NOT_DETERMINABLE_FROM_CODE",
]);

// These remain authoring candidates only. They are kept in DRAFT so the legal
// operator can review locator selection and future applicability modelling.
// Production approval is deliberately blocked below while legal-role scope is
// not represented as an evidence-backed VerifiedProfile fact.
const rules: Rule[] = [
  {
    legalRuleId: "LAW-134-2025-QH15-ART-11-INTERACTION-DISCLOSURE-GAP",
    ruleFamily: "AI_TRANSPARENCY",
    requiredFacts: [
      { field: "aiInteractionDisclosurePresent", expectedValue: "ABSENT" },
    ],
    citations: [{ locator: "art-11::cl-1" }, { locator: "art-11::cl-5" }],
  },
  {
    legalRuleId: "LAW-134-2025-QH15-ART-11-CONTENT-LABELING-GAP",
    ruleFamily: "AI_TRANSPARENCY",
    requiredFacts: [
      { field: "contentLabelingStatus", expectedValue: "ABSENT" },
    ],
    citations: [{ locator: "art-11::cl-2" }, { locator: "art-11::cl-3" }],
  },
  {
    legalRuleId: "LAW-134-2025-QH15-ART-12-INCIDENT-HANDLING-GAP",
    ruleFamily: "AI_INCIDENT_MANAGEMENT",
    requiredFacts: [
      { field: "incidentHandlingPresent", expectedValue: "ABSENT" },
    ],
    citations: [{ locator: "art-12::cl-1" }, { locator: "art-12::cl-2" }],
  },
];

// The current scanner's HARM_POTENTIAL_SIGNAL is a technical heuristic (for
// example a high-stakes-looking function name or domain package), not evidence
// that the legal high-risk test in Articles 9/10 has been satisfied. Legal
// matching also runs before classification, so medium-risk cannot be assumed
// without creating a circular dependency. Keep these legal bases out of the
// authored catalog until non-circular, evidence-backed applicability facts exist.
const deferredRules: DeferredRule[] = [
  {
    legalBasis: "LAW-134-2025-QH15::art-9",
    reason: "HIGH_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED",
  },
  {
    legalBasis: "LAW-134-2025-QH15::art-10",
    reason: "HIGH_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED",
  },
  {
    legalBasis: "LAW-134-2025-QH15::art-13",
    reason: "HIGH_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED",
  },
  {
    legalBasis: "LAW-134-2025-QH15::art-14",
    reason: "HIGH_RISK_AND_LEGAL_ROLE_APPLICABILITY_NOT_EVIDENCE_BACKED",
  },
  {
    legalBasis: "LAW-134-2025-QH15::art-15",
    reason: "MEDIUM_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED",
  },
];

const approvalBlockers = [
  "LEGAL_ROLE_APPLICABILITY_NOT_MODELED_IN_VERIFIED_PROFILE",
  "DEFERRED_RISK_APPLICABILITY_RULES_REMAIN",
];

function containsUnknownValue(value: unknown): boolean {
  if (typeof value === "string") {
    return unknownValues.has(value.trim().toUpperCase());
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsUnknownValue(item));
  }
  return false;
}

function validateCandidateRules(): void {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule.legalRuleId.trim() || ids.has(rule.legalRuleId)) {
      throw new Error(`Duplicate or empty legalRuleId: ${rule.legalRuleId}`);
    }
    ids.add(rule.legalRuleId);

    if (!rule.ruleFamily.trim()) {
      throw new Error(`${rule.legalRuleId}: ruleFamily is required`);
    }
    if (rule.requiredFacts.length === 0) {
      throw new Error(
        `${rule.legalRuleId}: at least one required fact is required`,
      );
    }
    if (rule.citations.length === 0) {
      throw new Error(`${rule.legalRuleId}: at least one citation is required`);
    }

    for (const fact of rule.requiredFacts) {
      if (!fact.field.trim()) {
        throw new Error(`${rule.legalRuleId}: required fact field is empty`);
      }
      if (containsUnknownValue(fact.expectedValue)) {
        throw new Error(
          `${rule.legalRuleId}: unknown value cannot be authored as a positive required fact`,
        );
      }
    }

    for (const citation of rule.citations) {
      if (!/^art-\d+(?:::[a-z]+-[^:]+)*$/u.test(citation.locator)) {
        throw new Error(
          `${rule.legalRuleId}: invalid citation locator ${citation.locator}`,
        );
      }
    }
  }
}

async function request<T>(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ResultEnvelope<T>;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(
      `Request failed (${response.status}): ${payload.problem?.code ?? "UNKNOWN"}`,
    );
  }
  return payload.data;
}

async function main(): Promise<void> {
  validateCandidateRules();

  const apiUrl = process.env.LCSP_API_URL ?? "http://127.0.0.1:8080";
  const token = process.env.LCSP_SESSION_TOKEN ?? process.env.TOKEN;
  const corpusVersionId = process.env.LEGAL_CORPUS_VERSION_ID;
  const version = process.env.LEGAL_RULE_CATALOG_VERSION;
  const approveRequested = ["1", "true", "yes"].includes(
    (process.env.LEGAL_RULE_CATALOG_APPROVE ?? "").trim().toLowerCase(),
  );

  if (!token || !corpusVersionId || !version) {
    throw new Error(
      "TOKEN (or LCSP_SESSION_TOKEN), LEGAL_CORPUS_VERSION_ID, and LEGAL_RULE_CATALOG_VERSION are required",
    );
  }

  // Fail before any write so an accidental approval request cannot leave an
  // orphaned catalog/rule set behind while known applicability blockers exist.
  if (approveRequested) {
    throw new Error(
      `Catalog approval is blocked: ${approvalBlockers.join(", ")}. Resolve the data-model gaps, then re-author and review the rule set.`,
    );
  }

  const catalog = await request<{ id: string }>(
    `${apiUrl}/internal/legal-rule-catalog/versions`,
    token,
    { version },
  );

  for (const rule of rules) {
    await request<{ id: string }>(
      `${apiUrl}/internal/legal-rule-catalog/rules`,
      token,
      {
        legalRuleId: rule.legalRuleId,
        legalRuleCatalogVersionId: catalog.id,
        ruleFamily: rule.ruleFamily,
        requiredFacts: rule.requiredFacts,
        optionalFacts: [],
        blockingFacts: [],
        unknownFactPolicy,
        citationLocatorRefs: rule.citations.map(({ locator }) => ({
          legalCorpusVersionId: corpusVersionId,
          documentId,
          locator,
        })),
      },
    );
  }

  console.log(
    JSON.stringify(
      {
        catalogVersionId: catalog.id,
        status: "DRAFT",
        ruleCount: rules.length,
        corpusVersionId,
        approval: "BLOCKED_PENDING_DATA_MODEL_AND_LEGAL_REVIEW",
        approvalBlockers,
        deferredRules,
        reviewRequired:
          "Applicability logic and provider/deployer/developer/user role scope must be evidence-backed and legally reviewed before production approval.",
      },
      null,
      2,
    ),
  );
}

void main();
