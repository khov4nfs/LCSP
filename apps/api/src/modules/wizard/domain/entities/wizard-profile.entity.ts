import { randomUUID } from "node:crypto";

import type { PersistedWizardStatusCode } from "@lcsp/contracts/assessment";

import type { WizardAnswer } from "@lcsp/contracts/wizard";

type WizardProfileEntityInput = {
  assessmentId: string;
  ownerId?: string;
  version?: number;
  status?: PersistedWizardStatusCode;
  answers?: WizardAnswer[];
  submittedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export class WizardProfileEntity {
  id: string;
  assessmentId: string;
  ownerId: string;
  version: number;
  status: PersistedWizardStatusCode;
  answers: WizardAnswer[];
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: WizardProfileEntityInput) {
    Object.assign(this, props, { id: randomUUID() });
  }

  static rehydrate(
    props: WizardProfileEntityInput & { id: string },
  ): WizardProfileEntity {
    const entity = new WizardProfileEntity(props);
    Object.assign(entity, { id: props.id });
    return entity;
  }
}
