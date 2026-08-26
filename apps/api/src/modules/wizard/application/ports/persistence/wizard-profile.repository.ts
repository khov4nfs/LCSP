import { WizardProfileEntity } from "../../../domain/entities/wizard-profile.entity.js";

export const WIZARD_PROFILE_REPOSITORY = Symbol("WIZARD_PROFILE_REPOSITORY");

export interface WizardProfileRepository {
  /**
   * Verifies that the assessment exists and is owned by the specified owner.
   * Returns true if verification passes, false otherwise.
   */
  verifyAssessmentOwnership(
    assessmentId: string,
    ownerId: string,
  ): Promise<boolean>;

  /**
   * Finds a WizardProfile by its assessmentId.
   */
  findByAssessmentId(assessmentId: string): Promise<WizardProfileEntity | null>;

  /**
   * Creates or updates a WizardProfile draft.
   */
  upsertDraft(profile: WizardProfileEntity): Promise<WizardProfileEntity>;
}
