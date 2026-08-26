import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_STATUS_CODES,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";

export type AssessmentStatus = AssessmentStatusCode;

type AssessmentProps = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  status: AssessmentStatus;
  createdAt: Date;
  updatedAt: Date;
};

type NewAssessmentProps = Omit<AssessmentProps, "id">;

/**
 * Represents an assessment aggregate and its owner, lifecycle, and descriptive state.
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
   * Creates a new assessment in the wizard-in-progress lifecycle state.
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
      status: ASSESSMENT_STATUS_CODES.wizardInProgress,
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

  /** @returns The current assessment lifecycle status. */
  get status(): AssessmentStatus {
    return this.props.status;
  }

  /** @returns The assessment creation timestamp. */
  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** @returns The most recent assessment update timestamp. */
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
