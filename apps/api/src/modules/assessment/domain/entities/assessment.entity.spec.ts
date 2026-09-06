import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { describe, it, expect } from "@jest/globals";

import { Assessment } from "./assessment.entity.js";

describe("Assessment", () => {
  describe("create", () => {
    it("starts in WIZARD_IN_PROGRESS status with a generated id", () => {
      const assessment = Assessment.create({
        ownerId: "user-1",
        name: "My AI System Assessment",
      });

      expect(assessment.status).toBe(ASSESSMENT_STATUS_CODES.wizardInProgress);
      expect(assessment.id).toBeTruthy();
      expect(assessment.ownerId).toBe("user-1");
      expect(assessment.name).toBe("My AI System Assessment");
      expect(assessment.description).toBeNull();
    });

    it("trims the name and keeps an optional description", () => {
      const assessment = Assessment.create({
        ownerId: "user-1",
        name: "  Padded Name  ",
        description: "Some context",
      });

      expect(assessment.name).toBe("Padded Name");
      expect(assessment.description).toBe("Some context");
    });

    it("generates a distinct id for each assessment", () => {
      const first = Assessment.create({
        ownerId: "user-1",
        name: "First",
      });
      const second = Assessment.create({
        ownerId: "user-1",
        name: "Second",
      });

      expect(first.id).not.toBe(second.id);
    });
  });

  describe("rehydrate", () => {
    it("restores an assessment from persisted fields", () => {
      const createdAt = new Date("2026-07-01T00:00:00.000Z");
      const updatedAt = new Date("2026-07-02T00:00:00.000Z");

      const assessment = Assessment.rehydrate({
        id: "assessment-1",
        ownerId: "user-1",
        name: "Rehydrated",
        description: null,
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
        createdAt,
        updatedAt,
      });

      expect(assessment.id).toBe("assessment-1");
      expect(assessment.createdAt).toBe(createdAt);
      expect(assessment.updatedAt).toBe(updatedAt);
    });
  });

  describe("completeRepositorySetup", () => {
    it("moves repository-ready assessments to WIZARD_SUBMITTED", () => {
      const assessment = Assessment.create({
        ownerId: "user-1",
        name: "Repository first",
      });

      assessment.completeRepositorySetup();

      expect(assessment.status).toBe(ASSESSMENT_STATUS_CODES.wizardSubmitted);
    });

    it("is idempotent after repository setup has completed", () => {
      const assessment = Assessment.create({
        ownerId: "user-1",
        name: "Repository first",
      });
      assessment.completeRepositorySetup();
      const updatedAt = assessment.updatedAt;

      assessment.completeRepositorySetup();

      expect(assessment.status).toBe(ASSESSMENT_STATUS_CODES.wizardSubmitted);
      expect(assessment.updatedAt).toBe(updatedAt);
    });
  });
});
