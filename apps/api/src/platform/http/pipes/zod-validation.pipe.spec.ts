import {
  AUTH_ERROR_CODES,
  confirmPasswordRecoverySchema,
  passwordReauthSchema,
  signUpSchema,
  updateProfileSchema,
} from "@lcsp/contracts/auth";
import { describe, expect, it } from "@jest/globals";
import { HttpException, HttpStatus } from "@nestjs/common";
import { z } from "zod";

import { ZodValidationPipe } from "./zod-validation.pipe.ts";
import { requestStorage } from "../../logging/logging-context.js";
import type { Request } from "express";

/**
 * Unit test suite for ZodValidationPipe.
 * Verifies that valid inputs pass through with correct types and invalid inputs throw standard RFC 7807 problem exceptions.
 */
describe("ZodValidationPipe", () => {
  it("explains missing required arrays using schema types without input values", () => {
    const detailed = new ZodValidationPipe(
      z.object({
        packet: z.object({
          assessmentRules: z.array(
            z.object({
              startingNodeTypes: z.array(z.string()),
              investigationGoals: z.array(z.string()),
            }),
          ),
        }),
      }),
      AUTH_ERROR_CODES.validationFailed,
      HttpStatus.BAD_REQUEST,
      true,
    );
    try {
      detailed.transform({
        packet: { assessmentRules: [{ privateValue: "must-not-echo" }] },
      });
      throw new Error("Expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse();
      expect(response).toMatchObject({
        ok: false,
        problem: {
          status: HttpStatus.BAD_REQUEST,
          meta: {
            requirements:
              "packet.assessmentRules.0.startingNodeTypes requires array | packet.assessmentRules.0.investigationGoals requires array",
          },
        },
      });
      expect(JSON.stringify(response)).not.toContain("must-not-echo");
    }
  });

  const schema = z.object({
    email: z.string().email(),
    age: z.number().min(18),
  });

  const pipe = new ZodValidationPipe(schema);

  it("passes valid data through correctly", () => {
    const input = { email: "test@example.com", age: 25 };
    const output = pipe.transform(input);
    expect(output).toEqual(input);
  });

  it("throws standard validation problem HttpException on invalid data", () => {
    const invalidInput = { email: "not-an-email", age: 10 };
    try {
      pipe.transform(invalidInput);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpException = error as HttpException;
      expect(httpException.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      const response = httpException.getResponse() as {
        ok: boolean;
        problem: { code: string; status: number };
      };
      expect(response.ok).toBe(false);
      expect(response.problem.code).toBe(AUTH_ERROR_CODES.validationFailed);
      expect(response.problem.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.problem).not.toHaveProperty("meta.issues");
    }
  });

  it("keeps the configured HTTP status and bounded issue paths without input values", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`field${index}`, z.string()]),
    );
    const detailed = new ZodValidationPipe(
      z.object(fields),
      AUTH_ERROR_CODES.validationFailed,
      HttpStatus.UNPROCESSABLE_ENTITY,
      true,
    );
    try {
      detailed.transform({ field0: { privateValue: "secret" } });
      throw new Error("Expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(exception.getResponse()).toMatchObject({
        ok: false,
        problem: {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: AUTH_ERROR_CODES.validationFailed,
          meta: {
            issues: Array.from(
              { length: 20 },
              (_, index) => `field${index}`,
            ).join(","),
          },
        },
      });
      expect(JSON.stringify(exception.getResponse())).not.toContain("secret");
    }
  });

  it("validates confirmPasswordRecoverySchema correctly rejecting short passwords", () => {
    const recoveryPipe = new ZodValidationPipe(confirmPasswordRecoverySchema);

    // Rejects password < 12 characters
    expect(() =>
      recoveryPipe.transform({
        token: "valid-tok",
        new_password: "shortpass8",
      }),
    ).toThrow(HttpException);

    // Accepts token with >= 12 characters password
    const validWithToken = recoveryPipe.transform({
      token: "valid-tok",
      new_password: "ValidPassword123!",
    });
    expect(validWithToken).toEqual({
      token: "valid-tok",
      new_password: "ValidPassword123!",
    });

    // Normalizes recovery_token to token
    const validWithRecoveryToken = recoveryPipe.transform({
      recovery_token: "rec-tok-123",
      new_password: "ValidPassword123!",
    });
    expect(validWithRecoveryToken).toEqual({
      recovery_token: "rec-tok-123",
      token: "rec-tok-123",
      new_password: "ValidPassword123!",
    });
  });

  it("validates signUpSchema correctly rejecting missing display name, bad email, or short password", () => {
    const signUpPipe = new ZodValidationPipe(signUpSchema);

    // Rejects missing display_name
    expect(() =>
      signUpPipe.transform({
        email: "user@example.com",
        password: "ValidPassword123!",
      }),
    ).toThrow(HttpException);

    // Rejects whitespace-only display_name
    expect(() =>
      signUpPipe.transform({
        display_name: "   ",
        email: "user@example.com",
        password: "ValidPassword123!",
      }),
    ).toThrow(HttpException);

    // Rejects invalid email
    expect(() =>
      signUpPipe.transform({
        display_name: "Valid Name",
        email: "not-an-email",
        password: "ValidPassword123!",
      }),
    ).toThrow(HttpException);

    // Rejects password < 12 characters
    expect(() =>
      signUpPipe.transform({
        display_name: "Valid Name",
        email: "user@example.com",
        password: "short-pass",
      }),
    ).toThrow(HttpException);

    // Accepts valid self-service sign-up payload
    const validPayload = {
      display_name: "Valid Name",
      email: "user@example.com",
      password: "ValidPassword123!",
    };
    const parsed = signUpPipe.transform(validPayload);
    expect(parsed).toEqual(validPayload);
  });

  it("validates updateProfileSchema rejecting empty or unknown-only updates", () => {
    const updatePipe = new ZodValidationPipe(updateProfileSchema);

    // Rejects empty payload
    expect(() => updatePipe.transform({})).toThrow(HttpException);

    // Rejects payload with only unknown fields
    expect(() => updatePipe.transform({ unknown_field: "some_value" })).toThrow(
      HttpException,
    );

    // Accepts valid display_name update
    const validDisplayUpdate = updatePipe.transform({
      display_name: "Updated Name",
    });
    expect(validDisplayUpdate).toEqual({
      display_name: "Updated Name",
    });

    // Accepts valid recovery_email update
    const validEmailUpdate = updatePipe.transform({
      recovery_email: "recovery@example.com",
    });
    expect(validEmailUpdate).toEqual({
      recovery_email: "recovery@example.com",
    });
  });

  it("validates passwordReauthSchema rejecting empty or whitespace-only passwords", () => {
    const reauthPipe = new ZodValidationPipe(passwordReauthSchema);

    // Rejects empty string
    expect(() => reauthPipe.transform({ password: "" })).toThrow(HttpException);

    // Rejects whitespace-only string
    expect(() => reauthPipe.transform({ password: "   " })).toThrow(
      HttpException,
    );

    // Accepts valid password
    const valid = reauthPipe.transform({ password: "secure-password" });
    expect(valid).toEqual({ password: "secure-password" });
  });

  describe("distributed tracing correlationId propagation", () => {
    const testSchema = z.object({ value: z.string().min(5) });
    const testPipe = new ZodValidationPipe(testSchema);

    it("generates a non-empty UUID fallback correlationId when outside request context", () => {
      try {
        testPipe.transform({ value: "bad" });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const res = (err as HttpException).getResponse() as {
          problem: { correlationId: string };
        };
        expect(res.problem.correlationId).toBeDefined();
        expect(typeof res.problem.correlationId).toBe("string");
        expect(res.problem.correlationId.length).toBeGreaterThan(0);
        expect(res.problem.correlationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it("propagates correlationId from req.correlationId when requestStorage is active", () => {
      const mockReq = {
        correlationId: "trace-ctx-abc-123",
        headers: {},
      } as unknown as Request;

      requestStorage.run(mockReq, () => {
        try {
          testPipe.transform({ value: "bad" });
          expect(true).toBe(false);
        } catch (err) {
          expect(err).toBeInstanceOf(HttpException);
          const res = (err as HttpException).getResponse() as {
            problem: { correlationId: string };
          };
          expect(res.problem.correlationId).toBe("trace-ctx-abc-123");
        }
      });
    });

    it("propagates correlationId from x-correlation-id header when requestStorage is active", () => {
      const mockReq = {
        headers: {
          "x-correlation-id": "header-trace-xyz-789",
        },
      } as unknown as Request;

      requestStorage.run(mockReq, () => {
        try {
          testPipe.transform({ value: "bad" });
          expect(true).toBe(false);
        } catch (err) {
          expect(err).toBeInstanceOf(HttpException);
          const res = (err as HttpException).getResponse() as {
            problem: { correlationId: string };
          };
          expect(res.problem.correlationId).toBe("header-trace-xyz-789");
        }
      });
    });
  });
});
