import {
  LEGACY_ARTIFACT_AVAILABILITIES,
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES,
} from "@lcsp/contracts/legacy-migration";
import { describe, expect, it } from "@jest/globals";

import {
  availabilityOf,
  mediaTypeForReference,
  utcIso,
} from "./legacy-report-availability.js";

describe("availabilityOf", () => {
  it.each([
    [
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES.ARTIFACT_PRESENT_AND_COPIED,
      LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE,
    ],
    [
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES.NO_LEGACY_ARTIFACT_PRESENT,
      LEGACY_ARTIFACT_AVAILABILITIES.NOT_RETAINED,
    ],
    [
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES.METADATA_ONLY_LEGACY_RECORD,
      LEGACY_ARTIFACT_AVAILABILITIES.METADATA_ONLY,
    ],
    [
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES.ARTIFACT_PRESENT_BUT_COPY_FAILED,
      LEGACY_ARTIFACT_AVAILABILITIES.UNAVAILABLE,
    ],
    [
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
      LEGACY_ARTIFACT_AVAILABILITIES.UNAVAILABLE,
    ],
  ])("maps %s to %s", (reconciliationClass, expected) => {
    expect(availabilityOf(reconciliationClass)).toBe(expected);
  });

  it("only a verified copy is ever downloadable", () => {
    const downloadable = Object.values(
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES,
    ).filter(
      (reconciliationClass) =>
        availabilityOf(reconciliationClass) ===
        LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE,
    );
    expect(downloadable).toEqual([
      LEGACY_ARTIFACT_RECONCILIATION_CLASSES.ARTIFACT_PRESENT_AND_COPIED,
    ]);
  });
});

describe("mediaTypeForReference", () => {
  it.each([
    ["file:///data/reports/r1.pdf", "application/pdf", "pdf"],
    [
      "https://store.example/reports/r1.MD?sig=abc",
      "text/markdown; charset=utf-8",
      "md",
    ],
    [
      "file:///data/reports/r1.docx",
      expect.stringContaining("wordprocessingml"),
      "docx",
    ],
    ["file:///data/reports/r1.unknown", "application/octet-stream", "bin"],
    [null, "application/octet-stream", "bin"],
    ["not a url", "application/octet-stream", "bin"],
  ])("%s", (reference, mediaType, extension) => {
    expect(mediaTypeForReference(reference)).toEqual({ mediaType, extension });
  });
});

describe("utcIso", () => {
  it("attaches UTC to zone-less database timestamps", () => {
    expect(utcIso("2026-08-01T08:00:00")).toBe("2026-08-01T08:00:00.000Z");
  });
  it("keeps explicit zones and rejects junk", () => {
    expect(utcIso("2026-08-01T08:00:00+07:00")).toBe(
      "2026-08-01T01:00:00.000Z",
    );
    expect(utcIso("nope")).toBeNull();
    expect(utcIso(null)).toBeNull();
    expect(utcIso("")).toBeNull();
  });
});
