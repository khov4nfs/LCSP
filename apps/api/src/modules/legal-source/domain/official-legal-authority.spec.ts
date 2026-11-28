import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

  it("matches the existing corpus manifest and checked-in original bytes", () => {
    const corpus = new URL(
      "../../../../../../deepagents/evals/corpora/lcsp-402-vn-cong-bao-v1/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      readFileSync(new URL("manifest.json", corpus), "utf8"),
    ) as {
      documents: Array<{
        number: string;
        sourcePage: string;
        downloadUrl: string;
        sha256: string;
        file: string;
      }>;
    };
    expect(
      manifest.documents.map(({ number, sourcePage, downloadUrl, sha256 }) => ({
        number,
        sourcePage,
        downloadUrl,
        sha256,
      })),
    ).toEqual(OFFICIAL_LEGAL_CORPUS);
    for (const document of manifest.documents) {
      const actual = createHash("sha256")
        .update(readFileSync(new URL(document.file, corpus)))
        .digest("hex");
      expect(actual).toBe(document.sha256);
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
