export class MfaEnrollment {
  readonly userId: string;
  readonly encryptedSecret: string;
  /** Generation of this enrollment (null only for an unpersisted candidate). */
  readonly mfaGenerationId: string | null;
  readonly enrolledAt: number;
  verifiedAt: number | null;

  constructor(input: {
    userId: string;
    encryptedSecret: string;
    mfaGenerationId?: string | null;
    enrolledAt: number;
    verifiedAt?: number | null;
  }) {
    this.userId = input.userId;
    this.encryptedSecret = input.encryptedSecret;
    this.mfaGenerationId = input.mfaGenerationId ?? null;
    this.enrolledAt = input.enrolledAt;
    this.verifiedAt = input.verifiedAt ?? null;
  }
}
