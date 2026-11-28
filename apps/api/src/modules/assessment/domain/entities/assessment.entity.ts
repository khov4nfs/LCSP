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
    this._isNew = true;
    this._expectedUpdatedAt = null;
  }

  private props: AssessmentProps;
  private _isNew: boolean = false;
  private _expectedUpdatedAt: Date | null = null;

  /**
   * Business purpose: Construct a new unpersisted assessment aggregate with generated identifier.
   *
   * Business rules:
   * - Only valid ownerId and normalized name are accepted.
   * - Sets isNew to true and expectedUpdatedAt to null to trigger persistence create path.
   *
   * Execution flow:
   * 1. Capture current UTC timestamp for initial creation and update timestamps.
   * 2. Normalize and trim name and optional description fields.
   * 3. Instantiate Assessment aggregate with generated unique identifier.
   *
   * Failure cases:
   * - None; factory requires valid caller inputs.
   *
   * Side effects:
   * - Allocates memory state; no external or persistent side effects.
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

    const entity = new Assessment({
      ownerId: input.ownerId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    entity._isNew = true;
    entity._expectedUpdatedAt = null;
    return entity;
  }

  /**
   * Business purpose: Reconstruct an existing persisted assessment aggregate from database records.
   *
   * Business rules:
   * - Preserves persisted identifiers and timestamps verbatim without generating new IDs.
   * - Sets isNew to false and expectedUpdatedAt to persisted updatedAt for optimistic concurrency checks.
   *
   * Execution flow:
   * 1. Instantiate Assessment aggregate from existing property values.
   * 2. Mark entity as existing (isNew = false) with expectedUpdatedAt matching persisted revision.
   * 3. Return rehydrated aggregate ready for domain operations or read projections.
   *
   * Failure cases:
   * - None; caller provides validated database record.
   *
   * Side effects:
   * - Pure in-memory reconstruction; no side effects.
   *
   * @param props - Fully populated persisted assessment properties.
   * @returns A rehydrated assessment aggregate.
   */
  static rehydrate(props: AssessmentProps): Assessment {
    const entity = new Assessment(props);
    entity.props = props;
    entity._isNew = false;
    entity._expectedUpdatedAt = props.updatedAt;
    return entity;
  }

  /**
   * Business purpose: Indicate whether the aggregate is freshly instantiated and not yet saved in database.
   *
   * Business rules:
   * - Returns true for newly created aggregates, false for rehydrated or persisted aggregates.
   *
   * Execution flow:
   * 1. Return the internal boolean flag tracking new creation versus rehydrated state.
   *
   * Failure cases:
   * - None; accessor is pure and safe.
   *
   * Side effects:
   * - Pure accessor without side effects.
   */
  get isNew(): boolean {
    return this._isNew;
  }

  /**
   * Business purpose: Provide the expected base timestamp for optimistic concurrency compare-and-set updates.
   *
   * Business rules:
   * - Returns null for new aggregates; returns persisted timestamp for rehydrated aggregates.
   *
   * Execution flow:
   * 1. Return the expected base updatedAt timestamp used for CAS where clause matching.
   *
   * Failure cases:
   * - None; accessor is pure and safe.
   *
   * Side effects:
   * - Pure accessor without side effects.
   */
  get expectedUpdatedAt(): Date | null {
    return this._expectedUpdatedAt;
  }

  /**
   * Business purpose: Synchronize aggregate persistence state after successful database write.
   *
   * Business rules:
   * - Flips isNew flag to false and updates expectedUpdatedAt to current updatedAt.
   *
   * Execution flow:
   * 1. Update internal isNew flag to false indicating durable persistence.
   * 2. Set expectedUpdatedAt to match current aggregate updatedAt timestamp.
   *
   * Failure cases:
   * - None; in-memory mutation.
   *
   * Side effects:
   * - Mutates internal persistence tracking state.
   */
  markPersisted(): void {
    this._isNew = false;
    this._expectedUpdatedAt = this.props.updatedAt;
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

  /**
   * Business purpose: Rename the assessment while advancing its modification timestamp.
   *
   * Business rules:
   * - Trims leading and trailing whitespace from the new name.
   * - Preserves aggregate identifier and creation timestamp.
   * - Advances updatedAt strictly beyond the prior timestamp while leaving expectedUpdatedAt at base revision.
   *
   * Execution flow:
   * 1. Trim supplied name string to canonical form.
   * 2. Assign trimmed name to internal aggregate state.
   * 3. Update updatedAt to the later of current time or one millisecond after the prior revision.
   *
   * Failure cases:
   * - None; input normalization guarantees trimmed string assignment.
   *
   * Side effects:
   * - Mutates name and updatedAt properties in-place.
   */
  rename(name: string): void {
    // Explanatory comment (ASM-11 / ASM-RENAME-01):
    // Rationale (Why): When renaming an assessment, the aggregate must advance its updatedAt timestamp
    // to record a new revision while preserving expectedUpdatedAt as the base revision for CAS.
    // Mechanism (How): Advance updatedAt by at least one millisecond even when the
    // system clock has not moved since the persisted revision.
    // Invariants: Base revision in expectedUpdatedAt is untouched, while the next
    // revision is always distinct so a successful CAS fences every stale writer.
    this.props.name = name.trim();
    this.props.updatedAt = new Date(
      Math.max(Date.now(), this.props.updatedAt.getTime() + 1),
    );
  }
}
