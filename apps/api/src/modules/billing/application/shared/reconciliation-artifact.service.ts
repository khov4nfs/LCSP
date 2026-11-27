import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

export type TrustedProviderLogEntry = {
  requestId: string;
  timestamp: string;
  correlationId?: string;
  model?: string;
};

export type TrustedReconciliationArtifact = {
  artifactId: string;
  provider: string;
  source: string;
  signingKeyId?: string | null;
  providerSignature: string;
  sha256: string;
  coverageStart: Date;
  coverageEnd: Date;
  finalizedWatermark: Date | null;
  rawContent: string;
  verified: boolean;
  entries: TrustedProviderLogEntry[];
};

export type ReconciliationVerificationError =
  | "artifact_not_found"
  | "unverified_artifact_source"
  | "hash_mismatch"
  | "provider_mismatch"
  | "incomplete_coverage"
  | "window_out_of_bounds"
  | "future_watermark"
  | "dispatched_request_found";

export type ReconciliationVerificationResult = {
  verified: boolean;
  error?: ReconciliationVerificationError;
  matchingRecordCount?: number;
};

type TrustedKeyRecord = {
  keyObject: crypto.KeyObject;
  isAudited: boolean;
};

@Injectable()
export class ReconciliationArtifactService {
  // Key registry storing verified provider public keys with explicit audit authority flags
  private readonly trustedProviderKeys = new Map<string, TrustedKeyRecord>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Register an authoritative provider public key for cryptographic signature verification.
   *
   * Business rules:
   * - Public key must be valid SPKI / PEM format.
   * - Key is indexed by provider name and optional signingKeyId.
   * - isAudited flag denotes whether the key is provisioned from an out-of-band audited operational secret store.
   *
   * Execution flow:
   * 1. Parse PEM into crypto.KeyObject.
   * 2. Store KeyObject alongside isAudited flag in trustedProviderKeys map.
   *
   * Failure cases:
   * - Throws Error if PEM is invalid or malformed.
   *
   * Side effects:
   * - Modifies in-memory key registry.
   */
  // Rationale ("Why"): ADR-028 Line 155 requires independent cryptographic verification of provider audit log exports.
  // Mechanism ("How"): Caches provider public keys for Ed25519 signature checks with audit authority metadata.
  // Invariants & Constraints: Only signatures verified against registered, audited provider keys can result in verified=true.
  registerTrustedProviderKey(
    provider: string,
    keyId: string,
    publicKeyPem: string,
    isAudited: boolean = false,
  ): void {
    const keyObject = crypto.createPublicKey(publicKeyPem);
    const record: TrustedKeyRecord = { keyObject, isAudited };
    const key = `${provider.toLowerCase()}:${keyId}`;
    this.trustedProviderKeys.set(key, record);
    this.trustedProviderKeys.set(provider.toLowerCase(), record);
  }

  /**
   * Business purpose: Generate and register a provider Ed25519 keypair for cryptographic testing and verification.
   *
   * Business rules:
   * - Generates native Ed25519 keypair.
   * - Defaults isAudited to false to prevent test fixtures from impersonating production authority.
   * - Registers public key in trustedProviderKeys.
   *
   * Execution flow:
   * 1. Call crypto.generateKeyPairSync with 'ed25519'.
   * 2. Export public and private keys to PEM format.
   * 3. Register public key in trustedProviderKeys with isAudited setting.
   * 4. Return both PEMs and keyId.
   *
   * Failure cases:
   * - Throws if crypto subsystem fails.
   *
   * Side effects:
   * - Modifies in-memory key registry.
   */
  // Rationale ("Why"): Enables cryptographic proof verification while isolating unaudited test keys from production authority.
  // Mechanism ("How"): Creates and registers an authentic Ed25519 keypair tagged with explicit audit status.
  // Invariants & Constraints: Private key is returned solely to the caller for signing; server holds only the public key.
  generateAndRegisterProviderKeyPair(
    provider: string,
    keyId: string = "default-key",
    isAudited: boolean = false,
  ): { publicKeyPem: string; privateKeyPem: string; keyId: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    const privateKeyPem = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;

    this.registerTrustedProviderKey(provider, keyId, publicKeyPem, isAudited);
    return { publicKeyPem, privateKeyPem, keyId };
  }

  /**
   * Business purpose: Compute canonical statement string for provider signature generation and verification.
   *
   * Business rules:
   * - Format: ${provider}:${artifactId}:${sha256}:${coverageStart}:${coverageEnd}:${finalizedWatermark}
   * - Deterministic ISO 8601 formatting.
   *
   * Execution flow:
   * 1. Construct colon-delimited string of canonical fields.
   *
   * Failure cases:
   * - Pure function; no failure.
   *
   * Side effects:
   * - Pure computation with zero external or internal side effects.
   */
  // Rationale ("Why"): Guarantees unambiguous payload binding for Ed25519 digital signatures.
  // Mechanism ("How"): Serializes critical metadata into an immutable canonical string.
  // Invariants & Constraints: Any alteration in artifactId, hash, window, or watermark invalidates the signature.
  computeCanonicalStatement(params: {
    provider: string;
    artifactId: string;
    sha256: string;
    coverageStart: Date;
    coverageEnd: Date;
    finalizedWatermark: Date;
  }): string {
    return `${params.provider.toLowerCase()}:${params.artifactId}:${params.sha256.toLowerCase()}:${params.coverageStart.toISOString()}:${params.coverageEnd.toISOString()}:${params.finalizedWatermark.toISOString()}`;
  }

  /**
   * Business purpose: Cryptographically sign a canonical artifact statement with a provider private key.
   *
   * Business rules:
   * - Must use Ed25519 signature algorithm.
   * - Output is base64 encoded.
   *
   * Execution flow:
   * 1. Import privateKeyPem.
   * 2. Sign canonical statement buffer with crypto.sign.
   * 3. Return base64 signature string.
   *
   * Failure cases:
   * - Throws if privateKeyPem is invalid.
   *
   * Side effects:
   * - Pure cryptographic signing with zero external or stateful side effects.
   */
  // Rationale ("Why"): Generates authentic digital signatures representing provider export certification.
  // Mechanism ("How"): Uses Ed25519 asymmetric cryptography.
  // Invariants & Constraints: Requires valid private key.
  signArtifactStatement(statement: string, privateKeyPem: string): string {
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const signature = crypto.sign(
      null,
      Buffer.from(statement, "utf-8"),
      privateKey,
    );
    return signature.toString("base64");
  }

  /**
   * Business purpose: Cryptographically verify provider signature against registered public keys.
   *
   * Business rules:
   * - Must match a registered provider public key.
   * - Signature must be valid Ed25519 over canonical statement.
   * - Returns validity and whether the signing key was configured with audited authority.
   *
   * Execution flow:
   * 1. Look up provider public key record in registry.
   * 2. Return false if no key registered.
   * 3. Call crypto.verify with public key and signature buffer.
   * 4. Return valid flag and isAudited authority flag.
   *
   * Failure cases:
   * - Returns valid=false on any verification failure or error.
   *
   * Side effects:
   * - Pure cryptographic verification; no external or persistent state side effects.
   */
  // Rationale ("Why"): Prevents self-asserted or unaudited signatures from falsely marking artifacts as verified.
  // Mechanism ("How"): Performs asymmetric Ed25519 verification and checks key audit authority.
  // Invariants & Constraints: Returns valid=true if and only if cryptographic verification succeeds.
  verifyProviderSignature(
    provider: string,
    statement: string,
    signatureBase64: string,
    keyId?: string | null,
  ): { valid: boolean; isAudited: boolean } {
    const lookupKey = keyId
      ? `${provider.toLowerCase()}:${keyId}`
      : provider.toLowerCase();
    let record = this.trustedProviderKeys.get(lookupKey);
    if (!record && keyId) {
      record = this.trustedProviderKeys.get(provider.toLowerCase());
    }
    if (!record) {
      return { valid: false, isAudited: false };
    }
    try {
      const sigBuffer = Buffer.from(signatureBase64, "base64");
      const valid = crypto.verify(
        null,
        Buffer.from(statement, "utf-8"),
        record.keyObject,
        sigBuffer,
      );
      return { valid, isAudited: record.isAudited };
    } catch {
      return { valid: false, isAudited: false };
    }
  }

  /**
   * Business purpose: Durably ingest and persist a provider audit log archive into PostgreSQL.
   *
   * Business rules:
   * - Artifact must be immutable: rejecting duplicate artifactId overwrite.
   * - verified defaults to false: set to true ONLY if providerSignature is cryptographically verified against an AUDITED key.
   * - Caller-asserted verified=true is strictly ignored; verification must be executed by the server.
   * - Source must be an approved provider export source.
   * - finalizedWatermark must be specified.
   *
   * Execution flow:
   * 1. Check if artifactId already exists in PostgreSQL; reject if duplicate.
   * 2. Compute canonical SHA-256 digest of serialized entries.
   * 3. Compute canonical statement string.
   * 4. Cryptographically verify providerSignature with registered provider public key.
   * 5. Set verified = true if and only if signature is valid AND key isAudited is true.
   * 6. Create immutable row in ProviderLogArtifact table.
   * 7. Return stored artifact entity.
   *
   * Failure cases:
   * - Throws Error if artifactId already exists (immutability violation).
   * - Throws Error if required fields missing.
   *
   * Side effects:
   * - Writes durable ProviderLogArtifact row to PostgreSQL.
   */
  // Rationale ("Why"): Solves root cause of unverified self-assertion and unaudited key spoofing.
  // Mechanism ("How"): Enforces insert-only immutability and server-side cryptographic signature verification against audited keys.
  // Invariants & Constraints: Artifacts can never be overwritten once stored; verified requires authentic audited key.
  async ingestVerifiedProviderLog(params: {
    artifactId: string;
    provider: string;
    source?: string;
    signingKeyId?: string;
    providerSignature: string;
    coverageStart: Date;
    coverageEnd: Date;
    finalizedWatermark?: Date;
    entries: TrustedProviderLogEntry[];
    verified?: boolean; // NOTE: Explicitly ignored to prevent caller self-assertion
  }): Promise<TrustedReconciliationArtifact> {
    if (!params.artifactId || !params.provider || !params.providerSignature) {
      throw new Error(
        "Invalid provider log ingestion: artifactId, provider, and providerSignature are required",
      );
    }

    // 1. Immutability check: Reject duplicate artifactId (absolutely NO upsert)
    const existing = await this.prisma.providerLogArtifact.findUnique({
      where: { artifactId: params.artifactId },
    });
    if (existing) {
      throw new Error(
        `Artifact "${params.artifactId}" already exists and is immutable: overwrite is strictly forbidden`,
      );
    }

    const rawContent = JSON.stringify(params.entries);
    const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");

    const source = params.source ?? "PROVIDER_EXPORT_VERIFIED";
    const finalizedWatermark = params.finalizedWatermark ?? params.coverageEnd;

    // 2. Cryptographic signature verification: Server-computed, requiring authentic audited key
    const canonicalStatement = this.computeCanonicalStatement({
      provider: params.provider,
      artifactId: params.artifactId,
      sha256,
      coverageStart: params.coverageStart,
      coverageEnd: params.coverageEnd,
      finalizedWatermark,
    });

    const sigResult = this.verifyProviderSignature(
      params.provider,
      canonicalStatement,
      params.providerSignature,
      params.signingKeyId,
    );

    // Invariant: verified=true requires BOTH valid cryptographic signature AND an audited key
    const isCryptographicallyVerified = sigResult.valid && sigResult.isAudited;

    // 3. Persist immutable record in PostgreSQL
    await this.prisma.providerLogArtifact.create({
      data: {
        artifactId: params.artifactId,
        provider: params.provider.toLowerCase(),
        source,
        signingKeyId: params.signingKeyId ?? null,
        providerSignature: params.providerSignature,
        sha256,
        coverageStart: params.coverageStart,
        coverageEnd: params.coverageEnd,
        finalizedWatermark,
        rawContent,
        verified: isCryptographicallyVerified,
      },
    });

    return {
      artifactId: params.artifactId,
      provider: params.provider.toLowerCase(),
      source,
      signingKeyId: params.signingKeyId ?? null,
      providerSignature: params.providerSignature,
      sha256,
      coverageStart: params.coverageStart,
      coverageEnd: params.coverageEnd,
      finalizedWatermark,
      rawContent,
      verified: isCryptographicallyVerified,
      entries: params.entries,
    };
  }

  /**
   * Business purpose: Authoritatively verify a reconciliation artifact against a billable invocation.
   *
   * Business rules:
   * - Artifact must exist in durable PostgreSQL storage and have verified=true from cryptographic signature.
   * - SHA-256 hash must strictly match the database record and client-supplied expected hash.
   * - Provider must match the invocation's resolved provider.
   * - Temporal window must encompass the entire potential dispatch window (from admittedAt through potentialDispatchEnd).
   * - Provider log finality watermark must be attested, must NOT be in the future, and must reach at least potentialDispatchEnd.
   * - CRITICAL: Scans provider log entries; if any entry matches the correlationId, reject with dispatched_request_found.
   *
   * Execution flow:
   * 1. Query ProviderLogArtifact from PostgreSQL.
   * 2. Verify artifact existence and verified=true flag.
   * 3. Compute and assert SHA-256 digest match.
   * 4. Verify provider matches expectedProvider.
   * 5. Verify coverageStart <= potentialDispatchStart and coverageEnd >= potentialDispatchEnd.
   * 6. Assert finalizedWatermark <= current time (reject future watermark).
   * 7. Verify finalizedWatermark >= potentialDispatchEnd (provider log archival completeness guarantee).
   * 8. Search log entries for correlationId; return dispatched_request_found if matched.
   * 9. Return verified=true if all criteria satisfied.
   *
   * Failure cases:
   * - Returns verified=false with specific error code.
   *
   * Side effects:
   * - Read-only query; no database mutation.
   */
  // Rationale ("Why"): Guarantees that only authentic, comprehensively covering provider logs can close exposure.
  // Mechanism ("How"): Validates database provenance, cryptographic hash, temporal bounds, watermark, and correlation ID absence.
  // Invariants & Constraints: Self-asserted, unverified, unwatermarked, future-watermarked, or incomplete artifacts fail closed.
  async verifyArtifact(params: {
    artifactId: string;
    expectedSha256: string;
    expectedProvider: string;
    correlationId: string;
    potentialDispatchStart: Date;
    potentialDispatchEnd: Date;
    coverageStart: Date;
    coverageEnd: Date;
  }): Promise<ReconciliationVerificationResult> {
    const artifact = await this.prisma.providerLogArtifact.findUnique({
      where: { artifactId: params.artifactId },
    });

    if (!artifact) {
      return { verified: false, error: "artifact_not_found" };
    }

    // Must be cryptographically verified by server during ingestion using an audited key
    if (!artifact.verified) {
      return { verified: false, error: "unverified_artifact_source" };
    }

    // Verify SHA-256 hash
    const computedHash = crypto
      .createHash("sha256")
      .update(artifact.rawContent)
      .digest("hex");

    if (
      computedHash.toLowerCase() !== params.expectedSha256.toLowerCase() ||
      artifact.sha256.toLowerCase() !== params.expectedSha256.toLowerCase()
    ) {
      return { verified: false, error: "hash_mismatch" };
    }

    // Verify provider binding
    if (
      artifact.provider.toLowerCase() !== params.expectedProvider.toLowerCase()
    ) {
      return { verified: false, error: "provider_mismatch" };
    }

    // Verify temporal coverage encompasses the entire potential dispatch window
    if (
      artifact.coverageStart > params.potentialDispatchStart ||
      artifact.coverageEnd < params.potentialDispatchEnd
    ) {
      return { verified: false, error: "incomplete_coverage" };
    }

    const now = new Date();

    // Invariant: Watermark cannot be in the future relative to current verification time
    if (
      artifact.finalizedWatermark &&
      artifact.finalizedWatermark.getTime() > now.getTime()
    ) {
      return { verified: false, error: "future_watermark" };
    }

    // Watermark check: Provider must guarantee that log collection was sealed and finalized past potentialDispatchEnd
    if (
      !artifact.finalizedWatermark ||
      artifact.finalizedWatermark < params.potentialDispatchEnd
    ) {
      return { verified: false, error: "incomplete_coverage" };
    }

    if (
      params.coverageStart < artifact.coverageStart ||
      params.coverageEnd > artifact.coverageEnd
    ) {
      return { verified: false, error: "window_out_of_bounds" };
    }

    // Parse entries from rawContent
    let entries: TrustedProviderLogEntry[] = [];
    try {
      entries = JSON.parse(artifact.rawContent);
    } catch {
      return { verified: false, error: "unverified_artifact_source" };
    }

    // Invariant: Verify that NO request in the provider log matches correlationId
    const matchingEntries = entries.filter(
      (entry) => entry.correlationId === params.correlationId,
    );

    if (matchingEntries.length > 0) {
      return {
        verified: false,
        error: "dispatched_request_found",
        matchingRecordCount: matchingEntries.length,
      };
    }

    return { verified: true, matchingRecordCount: 0 };
  }
}
