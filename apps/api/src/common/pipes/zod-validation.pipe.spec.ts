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

/**
 * Unit test suite for ZodValidationPipe.
 * Verifies that valid inputs pass through with correct types and invalid inputs throw standard RFC 7807 problem exceptions.
 */
describe("ZodValidationPipe", () => {
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
});
