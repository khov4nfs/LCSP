/**
 * Represents a normalized user email address that satisfies the domain's basic email invariant.
 */
export class UserEmail {
  /**
   * Stores an email value that has already been normalized and validated.
   *
   * @param value - Lowercase normalized email address.
   */
  private constructor(private readonly value: string) {}

  /**
   * Normalizes and validates a raw user email address.
   *
   * @param value - Raw email value to trim and lowercase.
   * @returns A validated user email value object.
   * @throws When the normalized value does not contain an email separator.
   */
  static create(value: string): UserEmail {
    const normalized = value.trim().toLowerCase();

    if (!normalized.includes("@")) {
      throw new Error("Valid email is required");
    }

    return new UserEmail(normalized);
  }

  /**
   * Exposes the normalized email as a primitive string.
   *
   * @returns The normalized email address.
   */
  toString(): string {
    return this.value;
  }
}
