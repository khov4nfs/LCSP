export const ASSESSMENT_EVENT_TYPES = {
  created: "ASSESSMENT_CREATED",
  createdOutbox: "event.assessment.created.v1",
  lifecycleChangedOutbox: "event.assessment.lifecycle-changed.v1",
  eventRecordedOutbox: "event.assessment.event-recorded.v1",
  renamed: "ASSESSMENT_RENAMED",
  deleted: "ASSESSMENT_DELETED",
  repositorySetupCompleted: "ASSESSMENT_REPOSITORY_SETUP_COMPLETED",
} as const;
