import { LEGAL_PORTFOLIO_FAILURE_CODES } from "@lcsp/contracts/legal-portfolio";
import { legalPortfolioPacketSchema } from "@lcsp/contracts/legal-portfolio";

import {
  FIXTURE_LEAVES,
  fixtureChunks,
  fixtureCorpus,
  fixtureHash,
  ref,
  validPacket,
} from "../../../../test/support/legal-portfolio-fixtures.js";
import {
  canonicalJson,
  sourceClaimKey,
  validateLegalPortfolioPacket,
} from "./legal-portfolio-integrity.validator.js";

const never = () => false;
const codes = (failures: Array<{ code: string }>) =>
  failures.map((f) => f.code);

describe("validateLegalPortfolioPacket (mechanical integrity only)", () => {
  it("accepts a complete packet whose source claims all resolve", () => {
    const packet = validPacket();
    expect(legalPortfolioPacketSchema.safeParse(packet).success).toBe(true);
    const { failures, resolved } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(failures).toEqual([]);
    for (const leaf of FIXTURE_LEAVES) {
      expect(
        resolved.has(
          sourceClaimKey({
            documentId: "SYNTHETIC-NOTICE-INSTRUMENT",
            locator: leaf,
          }),
        ),
      ).toBe(true);
    }
  });

  it("rejects a fake reference (locator not in the pinned corpus)", () => {
    const packet = validPacket();
    packet.legalRules[0].sourceRefs.push({
      ...ref("art-1::cl-1"),
      locator: "art-99::cl-1",
    });
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(codes(failures)).toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
    );
  });

  it("rejects a stale hash (declared hash is from another corpus version)", () => {
    const packet = validPacket();
    packet.legalRules[1].sourceRefs[0] = ref("art-5::cl-1::pt-a");
    packet.legalRules[1].sourceRefs.push(ref("art-5::cl-1", "v2")); // art-5::cl-1 changed in v2
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(codes(failures)).toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.STALE_SOURCE_HASH,
    );
    expect(codes(failures)).not.toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.MIXED_CORPUS_VERSION,
    );
  });

  it("reports mixed corpus versions when clean claims and foreign-version claims coexist", () => {
    const packet = validPacket();
    packet.legalRules[1].sourceRefs.push(ref("art-5::cl-1", "v2"));
    const foreign = (claim: { locator: string; contentSha256: string }) =>
      claim.contentSha256 === fixtureHash("art-5::cl-1", "v2");
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      foreign,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.STALE_SOURCE_HASH,
        LEGAL_PORTFOLIO_FAILURE_CODES.MIXED_CORPUS_VERSION,
      ]),
    );
  });

  it("rejects a repealed source reference", () => {
    const corpus = fixtureCorpus(
      {},
      { "art-2::cl-1": { legalStatus: "REPEALED" } },
    );
    const { failures } = validateLegalPortfolioPacket(
      validPacket(),
      corpus,
      never,
    );
    expect(codes(failures)).toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.REPEALED_SOURCE_REFERENCE,
    );
  });

  it("rejects duplicate rule, engineering rule and relation ids", () => {
    const packet = validPacket();
    packet.legalRules.push({ ...packet.legalRules[0] });
    packet.engineeringRules.push({ ...packet.engineeringRules[0] });
    packet.contextRelations.push({ ...packet.contextRelations[0] });
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_RULE_ID,
        LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_ENGINEERING_RULE_ID,
      ]),
    );
  });

  it("rejects orphan engineering rules and orphan context relations", () => {
    const packet = validPacket();
    packet.engineeringRules[0].legalRuleIds = ["LR-MISSING"];
    packet.contextRelations[0].toLegalRuleId = "LR-MISSING-TARGET";
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.ORPHAN_ENGINEERING_RULE,
        LEGAL_PORTFOLIO_FAILURE_CODES.ORPHAN_CONTEXT_RELATION,
      ]),
    );
  });

  it("rejects a provision that is neither covered nor declared non-assessable", () => {
    const packet = validPacket();
    packet.legalRules = packet.legalRules.filter(
      (rule) => rule.legalRuleId !== "LR-PERSON",
    );
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    const coverage = failures.filter(
      (failure) =>
        failure.code ===
        LEGAL_PORTFOLIO_FAILURE_CODES.INCOMPLETE_SOURCE_COVERAGE,
    );
    expect(coverage.map((failure) => failure.ref)).toEqual([
      "locator:SYNTHETIC-NOTICE-INSTRUMENT::art-6::cl-1",
    ]);
  });

  it("counts a cited ancestor as covering its descendants", () => {
    const packet = validPacket();
    packet.legalRules[1].sourceRefs = [ref("art-5::cl-1")]; // parent covers pt-a and pt-b
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(failures).toEqual([]);
  });

  it("requires every covered rule to have an EngineeringRule and every non-assessable rule a reason", () => {
    const packet = validPacket();
    packet.engineeringRules = packet.engineeringRules.filter(
      (rule) => rule.engineeringRuleId !== "ER-DEF",
    );
    packet.legalRules[4].coverage.nonAssessableReason = "   ";
    const { failures } = validateLegalPortfolioPacket(
      packet,
      fixtureCorpus(),
      never,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.INCOMPLETE_RULE_COVERAGE,
        LEGAL_PORTFOLIO_FAILURE_CODES.NON_ASSESSABLE_REASON_REQUIRED,
      ]),
    );
  });

  it("fails an empty portfolio and an invalid retrieval index without judging meaning", () => {
    const empty = {
      legalRules: [],
      engineeringRules: [],
      contextRelations: [],
    };
    const result = validateLegalPortfolioPacket(
      empty,
      fixtureCorpus({ retrievalIndexValid: false }),
      never,
    );
    expect(codes(result.failures)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.EMPTY_PORTFOLIO,
        LEGAL_PORTFOLIO_FAILURE_CODES.RETRIEVAL_INDEX_NOT_VALID,
      ]),
    );
  });

  it("is deterministic and never mutates the packet or the corpus", () => {
    const packet = validPacket();
    const corpus = fixtureCorpus();
    const before = canonicalJson({ packet, corpus });
    const first = validateLegalPortfolioPacket(packet, corpus, never);
    const second = validateLegalPortfolioPacket(packet, corpus, never);
    expect(canonicalJson({ packet, corpus })).toBe(before);
    expect(first.failures).toEqual(second.failures);
    expect(fixtureChunks().length).toBeGreaterThan(0);
  });

  it("canonicalJson ignores key order so equal packets hash equally", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
    );
  });
});
