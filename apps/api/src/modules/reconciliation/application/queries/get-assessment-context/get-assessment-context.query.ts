import type {
  AssessmentContextAnswerField,
  AssessmentContextInclude,
} from "../../contracts/reconciliation/assessment-context.contract.js";

export class GetAssessmentContextQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly wizardProfileId: string,
    public readonly includes: AssessmentContextInclude[],
    public readonly answerFields: AssessmentContextAnswerField[],
    public readonly correlationId: string,
  ) {}
}
