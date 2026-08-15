/**
 * Represents a non-empty user identifier and centralizes generation of new user IDs.
 */
export class UserId {
  /**
   * Stores an identifier that has already satisfied the value-object invariant.
   *
   * @param value - Normalized non-empty user identifier.
   */
  private constructor(private readonly value: string) {}

  /**
   * Reconstructs a user identifier from a persisted primitive value.
   *
   * @param value - Raw user identifier to normalize.
   * @returns A validated user identifier value object.
   * @throws When the normalized identifier is empty.
   */
  static create(value: string): UserId {
    const normalized = value.trim();

    if (!normalized) {
      throw new Error("User id is required");
    }

    return new UserId(normalized);
  }

  /**
   * Generates a new application user identifier.
   *
   * @returns A newly generated user identifier value object.
   */
  static generate(): UserId {
    const suffix = Math.random().toString(36).slice(2, 10);

    return new UserId(`user-${suffix}`);
  }

  /**
   * Exposes the identifier as a primitive string.
   *
   * @returns The stored user identifier.
   */
  toString(): string {
    return this.value;
  }
}
