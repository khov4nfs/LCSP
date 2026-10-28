import { describe, expect, it } from "@jest/globals";
import { LEGAL_SOURCE_MEDIA_TYPES as Media } from "@lcsp/contracts/legal-source";

import {
  cleanFileName,
  detectMediaType,
  documentIdFrom,
} from "./document-media-type.js";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj");
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

describe("detectMediaType", () => {
  it("reads a PDF by its bytes whatever the name says", () => {
    expect(detectMediaType({ bytes: pdf })).toBe(Media.PDF);
    expect(detectMediaType({ bytes: pdf, fileName: "law.txt" })).toBe(null);
    expect(
      detectMediaType({ bytes: pdf, declaredType: "application/pdf" }),
    ).toBe(Media.PDF);
    expect(
      detectMediaType({
        bytes: pdf,
        declaredType: "application/octet-stream",
        fileName: "a.pdf",
      }),
    ).toBe(Media.PDF);
  });

  it("accepts a ZIP only as a DOCX that says so", () => {
    expect(detectMediaType({ bytes: zip, fileName: "law.docx" })).toBe(
      Media.DOCX,
    );
    expect(detectMediaType({ bytes: zip, declaredType: Media.DOCX })).toBe(
      Media.DOCX,
    );
    expect(detectMediaType({ bytes: zip, fileName: "archive.zip" })).toBe(null);
    expect(detectMediaType({ bytes: zip })).toBe(null);
  });

  it("accepts plain text, markdown and html when the claim and the bytes agree", () => {
    const text = Buffer.from("Điều 1. Phạm vi điều chỉnh\nNội dung.");
    expect(detectMediaType({ bytes: text, fileName: "a.txt" })).toBe(
      Media.PLAIN_TEXT,
    );
    expect(detectMediaType({ bytes: text, fileName: "a.md" })).toBe(
      Media.MARKDOWN,
    );
    expect(
      detectMediaType({
        bytes: text,
        declaredType: "text/plain; charset=utf-8",
      }),
    ).toBe(Media.PLAIN_TEXT);
    const html = Buffer.from("<!DOCTYPE html><html><body>x</body></html>");
    expect(detectMediaType({ bytes: html, fileName: "a.html" })).toBe(
      Media.HTML,
    );
    expect(detectMediaType({ bytes: html, declaredType: "text/html" })).toBe(
      Media.HTML,
    );
    expect(detectMediaType({ bytes: html, fileName: "a.txt" })).toBe(
      Media.HTML,
    );
  });

  it("refuses what is not supported or does not match its claim", () => {
    expect(detectMediaType({ bytes: Buffer.alloc(0), fileName: "a.txt" })).toBe(
      null,
    );
    expect(
      detectMediaType({
        bytes: Buffer.from("MZ\u0000\u0000binary"),
        fileName: "a.txt",
      }),
    ).toBe(null);
    expect(
      detectMediaType({ bytes: Buffer.from("plain words"), fileName: "a.exe" }),
    ).toBe(null);
    expect(detectMediaType({ bytes: Buffer.from("plain words") })).toBe(null);
    expect(
      detectMediaType({
        bytes: Buffer.from("plain words"),
        declaredType: "image/png",
      }),
    ).toBe(null);
    expect(
      detectMediaType({
        bytes: Buffer.from("not html at all"),
        fileName: "a.html",
      }),
    ).toBe(null);
  });
});

describe("documentIdFrom", () => {
  it("makes a stable url-safe id and drops the extension", () => {
    expect(documentIdFrom("Luat_134_2025_QH15.pdf")).toBe("luat-134-2025-qh15");
    expect(documentIdFrom("Luật Trí tuệ nhân tạo số 134/2025/QH15")).toBe(
      "luat-tri-tue-nhan-tao-so-134-2025-qh15",
    );
    expect(documentIdFrom("***")).toBe("document");
    expect(documentIdFrom("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("cleanFileName", () => {
  it("removes path separators and control characters", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("....etcpasswd");
    expect(cleanFileName("a\u0000b\\c.pdf")).toBe("abc.pdf");
    expect(cleanFileName("  ")).toBe("document");
  });
});
