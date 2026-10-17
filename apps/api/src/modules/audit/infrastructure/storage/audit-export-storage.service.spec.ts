import { describe, expect, it } from "@jest/globals";
import { AuditExportStorageService } from "./audit-export-storage.service.js";

describe("AuditExportStorageService", () => {
  it("creates a signed download URL containing exportRequestId and encoded token", () => {
    const service = new AuditExportStorageService();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const url = service.createSignedDownloadUrl({
      exportRequestId: "req-123",
      expiresAt,
    });

    expect(url).toContain("/audit-events/export/req-123/download?token=");
    const token = url.split("token=")[1];
    expect(token).toBeDefined();
    expect(token).toContain(".");
  });

  it("verifies a valid signed download token", () => {
    const service = new AuditExportStorageService();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const url = service.createSignedDownloadUrl({
      exportRequestId: "req-123",
      expiresAt,
    });
    const token = url.split("token=")[1] ?? "";

    const payload = service.verifySignedDownloadToken(token, "req-123");

    expect(payload).not.toBeNull();
    expect(payload?.exportRequestId).toBe("req-123");
    expect(payload?.expiresAt).toBe(expiresAt.toISOString());
  });

  it("returns null if the token structure is malformed", () => {
    const service = new AuditExportStorageService();

    expect(
      service.verifySignedDownloadToken("no-dot-token", "req-123"),
    ).toBeNull();
    expect(service.verifySignedDownloadToken("", "req-123")).toBeNull();
  });

  it("returns null if the signature is invalid or forged", () => {
    const service = new AuditExportStorageService();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const url = service.createSignedDownloadUrl({
      exportRequestId: "req-123",
      expiresAt,
    });
    const [payload] = (url.split("token=")[1] ?? "").split(".");

    expect(
      service.verifySignedDownloadToken(
        `${payload}.forged_signature`,
        "req-123",
      ),
    ).toBeNull();
  });

  it("returns null if the signature length does not match", () => {
    const service = new AuditExportStorageService();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const url = service.createSignedDownloadUrl({
      exportRequestId: "req-123",
      expiresAt,
    });
    const [payload] = (url.split("token=")[1] ?? "").split(".");

    expect(
      service.verifySignedDownloadToken(`${payload}.short`, "req-123"),
    ).toBeNull();
  });

  it("returns null if exportRequestId does not match the bound route parameter", () => {
    const service = new AuditExportStorageService();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const url = service.createSignedDownloadUrl({
      exportRequestId: "req-123",
      expiresAt,
    });
    const token = url.split("token=")[1] ?? "";

    expect(service.verifySignedDownloadToken(token, "other-req")).toBeNull();
  });

  it("returns null if token is expired", () => {
    const service = new AuditExportStorageService();
    const expiresAt = new Date(Date.now() - 1000);

    const url = service.createSignedDownloadUrl({
      exportRequestId: "req-123",
      expiresAt,
    });
    const token = url.split("token=")[1] ?? "";

    expect(service.verifySignedDownloadToken(token, "req-123")).toBeNull();
  });

  it("returns null if token payload is not valid JSON", () => {
    const service = new AuditExportStorageService();
    const invalidEncoded = Buffer.from("not-json").toString("base64url");
    const privateSigner = service as unknown as {
      sign(value: string): string;
    };
    const signature = privateSigner.sign(invalidEncoded);

    expect(
      service.verifySignedDownloadToken(
        `${invalidEncoded}.${signature}`,
        "req-123",
      ),
    ).toBeNull();
  });
});
