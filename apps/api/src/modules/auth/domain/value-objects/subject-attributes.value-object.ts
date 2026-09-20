export type SubjectAttributeValue = string | string[];
export type SubjectAttributesRecord = Record<string, SubjectAttributeValue>;

export class SubjectAttributes {
  private readonly value: SubjectAttributesRecord;

  private constructor(value: SubjectAttributesRecord) {
    this.value = value;
  }

  static create(value: SubjectAttributesRecord = {}): SubjectAttributes {
    return new SubjectAttributes({ ...value });
  }

  hasRole(): boolean {
    return (
      typeof this.value.role === "string" && this.value.role.trim().length > 0
    );
  }

  get role(): string | undefined {
    return typeof this.value.role === "string" ? this.value.role : undefined;
  }

  toRecord(): SubjectAttributesRecord {
    return { ...this.value };
  }
}
