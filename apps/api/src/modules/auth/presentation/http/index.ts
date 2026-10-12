import { AuthMfaController } from "./auth-mfa.controller.ts";
import { AuthOAuthController } from "./auth-oauth.controller.ts";
import { AuthProfileController } from "./auth-profile.controller.ts";
import { AuthRecoveryController } from "./auth-recovery.controller.ts";
import { AuthController } from "./auth.controller.ts";

export * from "./auth.controller.ts";
export * from "./auth-mfa.controller.ts";
export * from "./auth-profile.controller.ts";
export * from "./auth-recovery.controller.ts";
export * from "./auth-oauth.controller.ts";

export const AUTH_CONTROLLERS = [
  AuthController,
  AuthMfaController,
  AuthProfileController,
  AuthRecoveryController,
  AuthOAuthController,
] as const;
