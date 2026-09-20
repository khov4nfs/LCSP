const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export class EmailAddress {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static isValid(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return (
      normalized.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(normalized)
    );
  }

  static create(value: string): EmailAddress {
    const normalized = value.trim().toLowerCase();

    if (!EmailAddress.isValid(normalized)) {
      throw new Error("Valid email is required");
    }

    return new EmailAddress(normalized);
  }

  toString(): string {
    return this.value;
  }
}
