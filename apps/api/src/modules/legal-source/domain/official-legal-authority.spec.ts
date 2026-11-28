import { describe, expect, it } from "@jest/globals";
import {
  identifyOfficialLegalDocument,
  OFFICIAL_LEGAL_CORPUS,
  resolveOfficialLegalDocument,
} from "./official-legal-authority.js";

describe("official legal corpus admission identity", () => {
  it("pins nine distinct official publication and original identities", () => {
    expect(OFFICIAL_LEGAL_CORPUS).toHaveLength(9);
    expect(new Set(OFFICIAL_LEGAL_CORPUS.map((row) => row.sha256)).size).toBe(9);
    for (const row of OFFICIAL_LEGAL_CORPUS) {
      expect(resolveOfficialLegalDocument(row.sourcePage)).toBe(row);
      expect(resolveOfficialLegalDocument(row.downloadUrl)).toBe(row);
      expect(identifyOfficialLegalDocument(row.sha256)).toBe(row);
      expect(identifyOfficialLegalDocument(`sha256:${row.sha256}`)).toBe(row);
    }
  });

  it("does not trust foreign, lookalike, or unpinned source identities", () => {
    const original = OFFICIAL_LEGAL_CORPUS[0];
    expect(
      resolveOfficialLegalDocument("https://eur-lex.europa.eu/"),
    ).toBeUndefined();
    expect(
      resolveOfficialLegalDocument(original.sourcePage + "?other=1"),
    ).toBeUndefined();
    expect(
      resolveOfficialLegalDocument(
        original.sourcePage.replace(".vn/", ".vn.example.org/"),
      ),
    ).toBeUndefined();
    expect(identifyOfficialLegalDocument("a".repeat(64))).toBeUndefined();
  });
});
