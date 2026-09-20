export class MfaEnrollment {
  readonly userId: string;
  readonly encryptedSecret: string;
  readonly enrolledAt: number;
  verifiedAt: number | null;

  constructor(input: {
    userId: string;
    encryptedSecret: string;
    enrolledAt: number;
    verifiedAt?: number | null;
  }) {
    this.userId = input.userId;
    this.encryptedSecret = input.encryptedSecret;
    this.enrolledAt = input.enrolledAt;
    this.verifiedAt = input.verifiedAt ?? null;
  }
}
