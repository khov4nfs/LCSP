import { describe, it, expect, jest } from "@jest/globals";

import { Assessment } from "./assessment.entity.js";

describe("Assessment", () => {
  describe("create", () => {
    it("creates owner and descriptive state with a generated id", () => {
      const assessment = Assessment.create({
        ownerId: "user-1",
        name: "My AI System Assessment",
      });

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
        createdAt,
        updatedAt,
      });

      expect(assessment.id).toBe("assessment-1");
      expect(assessment.createdAt).toBe(createdAt);
      expect(assessment.updatedAt).toBe(updatedAt);
    });

    it("advances the revision even when rename occurs in the persisted millisecond", () => {
      const persistedAt = new Date("2026-07-02T00:00:00.000Z");
      jest.useFakeTimers({ now: persistedAt });

      try {
        const assessment = Assessment.rehydrate({
          id: "assessment-1",
          ownerId: "user-1",
          name: "Before",
          description: null,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: persistedAt,
        });

        assessment.rename("After");

        expect(assessment.expectedUpdatedAt).toEqual(persistedAt);
        expect(assessment.updatedAt.getTime()).toBeGreaterThan(
          persistedAt.getTime(),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
