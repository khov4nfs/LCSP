import { Command } from "@nestjs/cqrs";

import type { UserDto } from "../../contracts/user/user.dto.js";

/**
 * Carries the user-registration input into the CQRS command pipeline.
 */
export class CreateUserCommand extends Command<UserDto> {
  /**
   * Creates a user-registration command.
   *
   * @param email - Email address requested for the new user account.
   * @param displayName - Human-readable display name requested for the new user.
   */
  constructor(
    public readonly email: string,
    public readonly displayName: string,
  ) {
    super();
  }
}
