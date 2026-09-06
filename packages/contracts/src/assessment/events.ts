export const ASSESSMENT_EVENT_TYPES = {
  created: "ASSESSMENT_CREATED",
  createdOutbox: "event.assessment.created.v1",
  repositorySetupCompleted: "ASSESSMENT_REPOSITORY_SETUP_COMPLETED",
  interviewAnswerSubmitted: "ASSESSMENT_INTERVIEW_ANSWER_SUBMITTED",
  interviewAgentResumeRequestedOutbox:
    "command.assessment-interview.resume-agent.v1",
} as const;
