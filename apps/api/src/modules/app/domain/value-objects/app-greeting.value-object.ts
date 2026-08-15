/**
 * Represents a non-empty, normalized application greeting.
 */
export class AppGreeting {
  /**
   * Stores a greeting that has already satisfied the value-object invariant.
   *
   * @param value - Normalized non-empty greeting value.
   */
  private constructor(private readonly value: string) {}

  /**
   * Creates an application greeting after trimming surrounding whitespace and rejecting empty values.
   *
   * @param value - Raw greeting value to normalize.
   * @returns A validated application greeting value object.
   * @throws When the normalized greeting is empty.
   */
  static create(value: string): AppGreeting {
    const normalized = value.trim();

    if (!normalized) {
      throw new Error("App greeting is required");
    }

    return new AppGreeting(normalized);
  }

  /**
   * Exposes the normalized greeting as a primitive string.
   *
   * @returns The stored greeting value.
   */
  toString(): string {
    return this.value;
  }
}
