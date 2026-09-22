import { describe, expect, it, jest } from "@jest/globals";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import {
  ADMIN_ACCOUNT_ERRORS,
  adminListUsersQuerySchema,
  adminOverviewQuerySchema,
  adminUserActionSchema,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { AdminUsersController } from "./admin-users.controller.js";

type ProblemResponse = {
  ok: boolean;
  problem: {
    code: string;
    status: number;
  };
};

describe("Admin HTTP Input Validation & Contract Compatibility", () => {
  const queryPipe = new ZodValidationPipe(
    adminListUsersQuerySchema,
    ADMIN_ACCOUNT_ERRORS.invalidInput,
  );
  const actionPipe = new ZodValidationPipe(
    adminUserActionSchema,
    ADMIN_ACCOUNT_ERRORS.invalidInput,
  );
  const overviewPipe = new ZodValidationPipe(
    adminOverviewQuerySchema,
    ADMIN_ACCOUNT_ERRORS.invalidInput,
  );

  describe("Query Parameter Validation (adminListUsersQuerySchema)", () => {
    it("rejects conflicting q and query parameters with 400 and ADMIN_ACCOUNT_INVALID_INPUT", () => {
      expect(() => queryPipe.transform({ q: "alice", query: "bob" })).toThrow();

      try {
        queryPipe.transform({ q: "alice", query: "bob" });
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const exception = error as HttpException;
        expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const response = exception.getResponse() as ProblemResponse;
        expect(response.problem.code).toBe(ADMIN_ACCOUNT_ERRORS.invalidInput);
      }
    });

    it("rejects conflicting pageSize and page_size parameters with 400 and ADMIN_ACCOUNT_INVALID_INPUT", () => {
      try {
        queryPipe.transform({ pageSize: "10", page_size: "20" });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const exception = error as HttpException;
        expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const response = exception.getResponse() as ProblemResponse;
        expect(response.problem.code).toBe(ADMIN_ACCOUNT_ERRORS.invalidInput);
      }
    });

    it("accepts identical or single alias query parameters", () => {
      expect(queryPipe.transform({ q: "alice" })).toMatchObject({
        q: "alice",
        page: 1,
      });
      expect(queryPipe.transform({ query: "alice" })).toMatchObject({
        query: "alice",
        page: 1,
      });
      expect(
        queryPipe.transform({
          q: "alice",
          query: "alice",
        }),
      ).toMatchObject({
        q: "alice",
        query: "alice",
        page: 1,
      });
      expect(queryPipe.transform({ pageSize: "10" })).toMatchObject({
        pageSize: 10,
        page: 1,
      });
      expect(queryPipe.transform({ page_size: "20" })).toMatchObject({
        page_size: 20,
        page: 1,
      });
      expect(
        queryPipe.transform({ pageSize: "10", page_size: "10" }),
      ).toMatchObject({
        pageSize: 10,
        page_size: 10,
        page: 1,
      });
    });

    it("accepts canonical string and number pagination parameters", () => {
      expect(queryPipe.transform({ page: "2", pageSize: "10" })).toMatchObject({
        page: 2,
        pageSize: 10,
      });
      expect(queryPipe.transform({ page: 2, pageSize: 10 })).toMatchObject({
        page: 2,
        pageSize: 10,
      });
    });

    it("rejects non-canonical pagination strings and forms with 400 and ADMIN_ACCOUNT_INVALID_INPUT", () => {
      const nonCanonicalCases = [
        { page: "01" },
        { page: "1e2" },
        { page: "+1" },
        { page: " 2 " },
        { page: "2.0" },
        { pageSize: "+10" },
        { pageSize: ["10"] },
        { page: ["2"] },
        { pageSize: "010", page_size: "10" },
      ];

      for (const params of nonCanonicalCases) {
        try {
          queryPipe.transform(params);
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          const exception = error as HttpException;
          expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          const response = exception.getResponse() as ProblemResponse;
          expect(response.problem.code).toBe(ADMIN_ACCOUNT_ERRORS.invalidInput);
        }
      }
    });

    it("rejects out-of-bound or invalid pagination and filter parameters", () => {
      for (const invalidParams of [
        { pageSize: "101" },
        { pageSize: "0" },
        { page: "0" },
        { role: "ROOT" },
        { status: "LOCKED" },
        { query: "a".repeat(201) },
      ]) {
        try {
          queryPipe.transform(invalidParams);
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          const exception = error as HttpException;
          expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          const response = exception.getResponse() as ProblemResponse;
          expect(response.problem.code).toBe(ADMIN_ACCOUNT_ERRORS.invalidInput);
        }
      }
    });
  });

  describe("Idempotency-Key Header Bound Validation", () => {
    const mockQueryBus = {
      execute: jest.fn<() => Promise<unknown>>(),
    } as unknown as QueryBus;
    const mockCommandBus = {
      execute: jest.fn<() => Promise<unknown>>(),
    } as unknown as CommandBus;
    const controller = new AdminUsersController(mockQueryBus, mockCommandBus);

    const mockRequest: AuthenticatedRequest = {
      correlationId: "test-corr-id",
      rbacContext: {
        userId: "admin-1",
        sessionId: "sess-1",
        role: AUTH_USER_ROLES.admin,
        scope: "ALL",
      },
    } as unknown as AuthenticatedRequest;

    it("accepts valid Idempotency-Key format and length <= 128", async () => {
      (
        mockCommandBus.execute as jest.Mock<() => Promise<unknown>>
      ).mockResolvedValueOnce({ id: "user-1" });
      const validKey = "retry-299:1";
      await expect(
        controller.suspendUser(
          "user-1",
          { expectedVersion: 0 },
          validKey,
          mockRequest,
        ),
      ).resolves.toBeDefined();
    });

    it("rejects invalid Idempotency-Key formats with 400 ADMIN_IDEMPOTENCY_KEY_REQUIRED", async () => {
      const invalidKeys = [
        "",
        "   ",
        "key with space",
        "a".repeat(129),
        "ümlaut",
        "key@invalid!",
        null,
        undefined,
        123,
      ];

      for (const invalidKey of invalidKeys) {
        try {
          await controller.suspendUser(
            "user-1",
            { expectedVersion: 0 },
            invalidKey as unknown as string | undefined,
            mockRequest,
          );
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          const exception = error as HttpException;
          expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          const response = exception.getResponse() as ProblemResponse;
          expect(response.problem.code).toBe(
            ADMIN_ACCOUNT_ERRORS.idempotencyRequired,
          );
        }
      }
    });
  });

  describe("Body Action Schema Validation (adminUserActionSchema)", () => {
    it("rejects non-strict keys and invalid types with ADMIN_ACCOUNT_INVALID_INPUT", () => {
      const invalidBodies = [
        {},
        { expectedVersion: -1 },
        { expectedVersion: "1" },
        { expectedVersion: 0, role: "ADMIN" },
        { expectedVersion: 0, extra: true },
        { expectedVersion: 0, reason: "" },
        { expectedVersion: 0, reason: "a".repeat(501) },
      ];

      for (const body of invalidBodies) {
        try {
          actionPipe.transform(body);
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          const exception = error as HttpException;
          expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
          const response = exception.getResponse() as ProblemResponse;
          expect(response.problem.code).toBe(ADMIN_ACCOUNT_ERRORS.invalidInput);
        }
      }
    });

    it("accepts valid action bodies", () => {
      expect(actionPipe.transform({ expectedVersion: 0 })).toEqual({
        expectedVersion: 0,
      });
      expect(
        actionPipe.transform({
          expectedVersion: 1,
          reason: "Policy violation",
        }),
      ).toEqual({
        expectedVersion: 1,
        reason: "Policy violation",
      });
    });
  });

  describe("Overview Query Validation (adminOverviewQuerySchema)", () => {
    it("preserves legacy 30D fallback for missing, unsupported, or arbitrary periods", () => {
      expect(overviewPipe.transform({})).toEqual({
        period: "30D",
      });
      expect(overviewPipe.transform({ period: "7D" })).toEqual({
        period: "7D",
      });
      expect(overviewPipe.transform({ period: "30D" })).toEqual({
        period: "30D",
      });
      expect(overviewPipe.transform({ period: "90D" })).toEqual({
        period: "90D",
      });
      expect(overviewPipe.transform({ period: "180D" })).toEqual({
        period: "30D",
      });
      expect(overviewPipe.transform({ period: "foo" })).toEqual({
        period: "30D",
      });
    });
  });
});
