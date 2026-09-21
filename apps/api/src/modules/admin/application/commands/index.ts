import { SuspendUserHandler } from "./suspend-user/suspend-user.handler.js";
import { RestoreUserHandler } from "./restore-user/restore-user.handler.js";

export * from "./suspend-user/suspend-user.command.js";
export * from "./suspend-user/suspend-user.handler.js";
export * from "./restore-user/restore-user.command.js";
export * from "./restore-user/restore-user.handler.js";

export const ADMIN_COMMAND_HANDLERS = [
  SuspendUserHandler,
  RestoreUserHandler,
] as const;
