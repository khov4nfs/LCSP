export const ASSESSMENT_EVENT_TYPES = {
  created: "ASSESSMENT_CREATED",
  createdOutbox: "event.assessment.created.v1",
  lifecycleChangedOutbox: "event.assessment.lifecycle-changed.v1",
  renamed: "ASSESSMENT_RENAMED",
  deleted: "ASSESSMENT_DELETED",
  repositorySetupCompleted: "ASSESSMENT_REPOSITORY_SETUP_COMPLETED",
  interviewAnswerSubmitted: "ASSESSMENT_INTERVIEW_ANSWER_SUBMITTED",
  aiNotDetected: "ASSESSMENT_AI_NOT_DETECTED",
  interviewAgentResumeRequestedOutbox:
    "command.assessment-interview.resume-agent.v1",
  interviewAgentPauseRequestedOutbox:
    "command.assessment-interview.pause-agent.v1",
} as const;
