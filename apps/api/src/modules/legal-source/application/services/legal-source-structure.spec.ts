import { describe, expect, it } from "@jest/globals";

import {
  managedChunkId,
  sha256Ref,
  structuralIntegrityRef,
  structuralValidationRef,
  validateStructure,
} from "./legal-source-structure.js";

const chunk = (locator: string, content: string) => ({
  locator,
  content,
  contentSha256: sha256Ref(content),
});

describe("validateStructure", () => {
  it("accepts documents whose chunks are addressable and hash-true", () => {
    const result = validateStructure([
      {
        documentId: "a",
        chunks: [chunk("art-1", "one"), chunk("art-2", "two")],
      },
      { documentId: "b", chunks: [chunk("art-1", "other")] },
    ]);
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("reports an empty version, a chunkless document, a bad hash, an empty chunk and a duplicate locator", () => {
    expect(validateStructure([]).failures).toEqual(["NO_DOCUMENTS"]);
    expect(
      validateStructure([{ documentId: "a", chunks: [] }]).failures,
    ).toEqual(["DOCUMENT_WITHOUT_CHUNKS:a"]);
    const tampered = { ...chunk("x", "text"), content: "changed" };
    expect(
      validateStructure([{ documentId: "a", chunks: [tampered] }]).failures,
    ).toEqual(["CHUNK_HASH_MISMATCH:a"]);
    expect(
      validateStructure([{ documentId: "a", chunks: [chunk("x", "   ")] }])
        .failures,
    ).toContain("EMPTY_CHUNK:a");
    expect(
      validateStructure([
        { documentId: "a", chunks: [chunk("x", "1"), chunk("x", "2")] },
      ]).failures,
    ).toEqual(["DUPLICATE_LOCATOR:a"]);
  });

  it("derives one content hash from content, independent of order", () => {
    const a = validateStructure([
      { documentId: "a", chunks: [chunk("1", "x"), chunk("2", "y")] },
      { documentId: "b", chunks: [chunk("1", "z")] },
    ]);
    const reordered = validateStructure([
      { documentId: "b", chunks: [chunk("1", "z")] },
      { documentId: "a", chunks: [chunk("2", "y"), chunk("1", "x")] },
    ]);
    const changed = validateStructure([
      { documentId: "a", chunks: [chunk("1", "x"), chunk("2", "Y")] },
      { documentId: "b", chunks: [chunk("1", "z")] },
    ]);
    expect(reordered.contentHash).toBe(a.contentHash);
    expect(changed.contentHash).not.toBe(a.contentHash);
  });
});

describe("references", () => {
  it("builds activation references that satisfy the manifest-ref shape", () => {
    const hash = sha256Ref("x");
    const shape = /^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9._:-]{1,180}$/;
    expect(structuralValidationRef(hash)).toMatch(shape);
    expect(structuralIntegrityRef(hash)).toMatch(shape);
  });

  it("qualifies chunk ids by version so versions never collide", () => {
    expect(managedChunkId("v1", "doc", "art-1")).not.toBe(
      managedChunkId("v2", "doc", "art-1"),
    );
  });
});
