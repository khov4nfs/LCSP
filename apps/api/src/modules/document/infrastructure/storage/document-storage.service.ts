import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

interface SignedDownloadInput {
  assessmentId: string;
  documentRequestId: string;
  documentUrl: string;
  expiresAt: Date;
}

interface SignedDownloadTokenPayload {
  assessmentId: string;
  documentRequestId: string;
  documentUrl: string;
  expiresAt: string;
}

interface VerifiedDownloadToken extends SignedDownloadTokenPayload {
  expiresAt: string;
}

/**
 * Creates and verifies HMAC-signed, expiring download tokens for generated document artifacts.
 */
@Injectable()
export class DocumentStorageService {
  /**
   * Creates a signed relative download URL bound to an assessment, document request, backing URL, and expiration time.
   *
   * @param input - Document identity, backing artifact URL, and expiration timestamp.
   * @returns Relative API download URL carrying the encoded token payload and signature.
   */
  createSignedDownloadUrl(input: SignedDownloadInput): string {
    const payload: SignedDownloadTokenPayload = {
      assessmentId: input.assessmentId,
      documentRequestId: input.documentRequestId,
      documentUrl: input.documentUrl,
      expiresAt: input.expiresAt.toISOString(),
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);

    return `/assessments/${encodeURIComponent(input.assessmentId)}/documents/${encodeURIComponent(input.documentRequestId)}/download?token=${encodedPayload}.${signature}`;
  }

  /**
   * Verifies a download token's signature, assessment/request binding, payload shape, and expiration.
   *
   * @param token - Encoded payload and signature supplied by the client.
   * @param assessmentId - Assessment identifier expected by the route.
   * @param documentRequestId - Document request identifier expected by the route.
   * @returns Verified token including the backing document URL, or null when validation fails.
   */
  verifySignedDownloadToken(
    token: string,
    assessmentId: string,
    documentRequestId: string,
  ): VerifiedDownloadToken | null {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = this.sign(encodedPayload);
    const validSignature = safeCompare(signature, expectedSignature);
    if (!validSignature) {
      return null;
    }

    const payload = parsePayload(encodedPayload);
    if (!payload) {
      return null;
    }

    if (
      payload.assessmentId !== assessmentId ||
      payload.documentRequestId !== documentRequestId
    ) {
      return null;
    }

    const expiresAt = Date.parse(payload.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

    return payload;
  }

  /**
   * Computes the HMAC signature for an encoded document token payload.
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
   * Resolves the document download signing secret with a local-development fallback.
   *
   * @returns Secret used to sign and verify document download tokens.
   */
  private secret(): string {
    return (
      process.env.DOCUMENT_DOWNLOAD_SIGNING_SECRET ??
      process.env.APP_SECRET ??
      "lcsp-local-document-download-secret"
    );
  }
}

/**
 * Decodes and validates the structural shape of a signed document token payload.
 *
 * @param encodedPayload - Base64url token payload.
 * @returns Parsed token payload, or null when decoding/JSON/shape validation fails.
 */
function parsePayload(encodedPayload: string): VerifiedDownloadToken | null {
  try {
    const raw = base64UrlDecode(encodedPayload);
    const parsed = JSON.parse(raw) as Partial<SignedDownloadTokenPayload>;
    if (
      typeof parsed.assessmentId !== "string" ||
      typeof parsed.documentRequestId !== "string" ||
      typeof parsed.documentUrl !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }

    return {
      assessmentId: parsed.assessmentId,
      documentRequestId: parsed.documentRequestId,
      documentUrl: parsed.documentUrl,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Encodes UTF-8 text using URL-safe Base64.
 *
 * @param value - Plain UTF-8 text to encode.
 * @returns Base64url representation.
 */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Decodes URL-safe Base64 back to UTF-8 text.
 *
 * @param value - Base64url value to decode.
 * @returns Decoded UTF-8 text.
 */
function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
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
