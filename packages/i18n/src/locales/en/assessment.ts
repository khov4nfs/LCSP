import type { AssessmentMessages } from "../../types.ts";

export const enAssessment: AssessmentMessages = {
  activity: {
    factAccepted: "Fact accepted",
    ruleInvestigationStarted: "Rule investigation started",
    rootStarted: "Assessment started",
    taskStarted: "Repository research started",
    taskFinished: "Repository research finished",
    modelStepCompleted: "Assessment reasoning completed",
    repositoryInspected: "Repository evidence inspected",
  },
  tracking: {
    reportReadyTitle: "Final Report available for {name}",
    reportReadyDescription: "Canonical compliance report is ready for download.",
    reassessmentRequiredTitle: "New commit detected for {name}",
    reassessmentRequiredDescription: "Repository has newer commit ({commit}) than assessed snapshot. Reassessment required.",
    outcomeCompletedTitle: "Assessment completed for {name}",
    outcomeCompletedDescription: "Evaluation completed across canonical rules.",
  },
};
