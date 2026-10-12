import { randomUUID } from "node:crypto";

type AssessmentProps = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type NewAssessmentProps = Omit<AssessmentProps, "id">;

/**
 * Represents an assessment aggregate and its owner and descriptive state.
 */
export class Assessment {
  /**
   * Creates a new aggregate with a generated identifier from already normalized properties.
   *
   * @param props - Assessment properties excluding the generated identifier.
   */
  private constructor(props: NewAssessmentProps) {
    this.props = { ...props, id: randomUUID() };
  }

  private props: AssessmentProps;

  /**
   * Creates the descriptive aggregate; the lifecycle coordinator initializes ALS.
   *
   * @param input - Owner, name, and optional description for the assessment.
   * @returns A newly created assessment aggregate with normalized text fields and timestamps.
   */
  static create(input: {
    ownerId: string;
    name: string;
    description?: string | null;
  }): Assessment {
    const now = new Date();

    return new Assessment({
      ownerId: input.ownerId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstructs an assessment aggregate from persisted properties without changing its identity or timestamps.
   *
   * @param props - Fully populated persisted assessment properties.
   * @returns A rehydrated assessment aggregate.
   */
  static rehydrate(props: AssessmentProps): Assessment {
    const entity = new Assessment(props);
    entity.props = props;
    return entity;
  }

  /** @returns The assessment identifier. */
  get id(): string {
    return this.props.id;
  }

  /** @returns The user who owns the assessment. */
  get ownerId(): string {
    return this.props.ownerId;
  }

  /** @returns The normalized assessment name. */
  get name(): string {
    return this.props.name;
  }

  /** @returns The normalized optional assessment description. */
  get description(): string | null {
    return this.props.description;
  }

  /** @returns The assessment creation timestamp. */
  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** @returns The most recent assessment update timestamp. */
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Renames the assessment while preserving its identity and lifecycle state. */
  rename(name: string): void {
    this.props.name = name.trim();
    this.props.updatedAt = new Date();
  }
}
