import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

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
export class AuditExportStorageService {
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
   * Resolves the download-signing secret from environment configuration with a local-development fallback.
   *
   * @returns Secret used to sign and verify audit download tokens.
   */
  private secret(): string {
    return (
      process.env.AUDIT_EXPORT_DOWNLOAD_SIGNING_SECRET ??
      process.env.APP_SECRET ??
      "lcsp-local-audit-export-download-secret"
    );
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
