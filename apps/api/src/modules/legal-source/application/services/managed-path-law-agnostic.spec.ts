import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const here = dirname(fileURLToPath(import.meta.url));
const MANAGED_FILES = [
  "document-media-type.ts",
  "legal-source-document.service.ts",
  "legal-source-management.service.ts",
  "legal-source-structure.ts",
  "legal-source-views.ts",
  "safe-url-fetcher.service.ts",
  "../../presentation/http/legal-library.controller.ts",
  "../../presentation/http/legal-source-admin.controller.ts",
  "../../presentation/http/legal-source-ingestion.controller.ts",
];

// Names of instruments or jurisdictions, and the way official numbers are written. None of these
// belong in generic code: what the platform reasons over is data an administrator manages.
const INSTRUMENT_IDENTITY =
  /\b\d{1,4}[-/]\d{4}[-/][A-Z]{2,}\d*\b|VN-LEGAL|vbpl\.vn|congbao|Quốc hội/iu;

describe("managed Legal Source code is law-agnostic", () => {
  it.each(MANAGED_FILES)(
    "%s names no instrument, jurisdiction or official catalog",
    (file) => {
      const source = readFileSync(join(here, file), "utf8");
      expect(source).not.toMatch(INSTRUMENT_IDENTITY);
    },
  );
});
