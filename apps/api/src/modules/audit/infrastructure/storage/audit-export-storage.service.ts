import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";

interface SignedDownloadInput {
  exportRequestId: string;
  expiresAt: Date;
}

interface SignedDownloadTokenPayload {
  exportRequestId: string;
  expiresAt: string;
}

/**
 * Creates and verifies HMAC-signed, time-limited download tokens for audit export artifacts.
 */
@Injectable()
export class AuditExportStorageService implements OnModuleInit {
  /**
   * Business purpose: Reject an Audit module deployment unable to protect export links.
   * Business rules:
   * - The signing key must be configured with at least 32 bytes before routes serve traffic.
   * Execution flow:
   * 1. Resolve and validate the configured signing key during Nest initialization.
   * Failure cases:
   * - Missing or weak key aborts module startup.
   * Side effects:
   * - Reads configuration; does not persist data.
   */
  onModuleInit(): void {
    this.secret();
  }
  /**
   * Creates a signed relative download URL bound to one export request and expiration time.
   *
   * @param input - Export identity and token expiration timestamp.
   * @returns Relative download URL containing the encoded payload and HMAC signature.
   */
  createSignedDownloadUrl(input: SignedDownloadInput): string {
    const payload: SignedDownloadTokenPayload = {
      exportRequestId: input.exportRequestId,
      expiresAt: input.expiresAt.toISOString(),
    };
    const encodedPayload = Buffer.from(
      JSON.stringify(payload),
      "utf8",
    ).toString("base64url");
    const signature = this.sign(encodedPayload);

    return `/audit-events/export/${encodeURIComponent(input.exportRequestId)}/download?token=${encodedPayload}.${signature}`;
  }

  /**
   * Verifies a signed download token against its signature, route identity, and expiration time.
   *
   * @param token - Encoded payload and signature supplied by the download client.
   * @param exportRequestId - Export request identifier expected by the route.
   * @returns Verified token payload, or null when the token is malformed, forged, mismatched, or expired.
   */
  verifySignedDownloadToken(
    token: string,
    exportRequestId: string,
  ): SignedDownloadTokenPayload | null {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = this.sign(encodedPayload);
    if (!safeCompare(signature, expectedSignature)) {
      return null;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as Partial<SignedDownloadTokenPayload>;
      if (
        payload.exportRequestId !== exportRequestId ||
        typeof payload.expiresAt !== "string"
      ) {
        return null;
      }

      const expiresAt = Date.parse(payload.expiresAt);
      if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
        return null;
      }

      return {
        exportRequestId: payload.exportRequestId,
        expiresAt: payload.expiresAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Computes the HMAC signature for an encoded token payload.
   *
   * @param value - Base64url-encoded token payload to sign.
   * @returns Base64url SHA-256 HMAC signature.
   */
  private sign(value: string): string {
    return createHmac("sha256", this.secret())
      .update(value)
      .digest("base64url");
  }

  /**
   * Business purpose: Resolve the confidential key that protects bearer download links.
   * Business rules:
   * - A configured key must contain at least 32 UTF-8 bytes; no public fallback is permitted.
   * Execution flow:
   * 1. Read the dedicated key or configured app key.
   * 2. Check its byte length and return it to the HMAC operation.
   * Failure cases:
   * - Missing or short configuration throws before any URL can be signed or trusted.
   * Side effects:
   * - Reads process environment; does not persist data.
   */
  private secret(): string {
    const secret =
      process.env.AUDIT_EXPORT_DOWNLOAD_SIGNING_SECRET ??
      process.env.APP_SECRET;
    // A public fallback would let anyone forge a bearer URL for any export ID.
    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error(
        "Audit export signing secret must contain at least 32 bytes",
      );
    }
    return secret;
  }
}

/**
 * Compares two signatures in constant time after rejecting unequal byte lengths.
 *
 * @param left - Supplied signature.
 * @param right - Expected signature.
 * @returns True when both signatures are byte-for-byte equal.
 */
function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
