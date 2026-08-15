import { randomUUID } from "node:crypto";

import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";

import { User } from "../../../domain/entities/user.entity.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { UserMapper } from "../../mappers/user.mapper.js";
import {
  USER_REPOSITORY,
  type UserRepository,
} from "../../ports/persistence/user.repository.js";
import { CreateUserCommand } from "./create-user.command.js";

/**
 * Registers a new user after enforcing email uniqueness and domain invariants.
 */
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  /**
   * Creates the registration handler with the user persistence port.
   *
   * @param userRepository - Repository used to detect duplicates and persist the new user aggregate.
   */
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * Registers and persists a user, then maps the aggregate to the external DTO.
   *
   * @param command - Registration input containing email and display name.
   * @returns The newly registered user DTO.
   * @throws When a user already exists for the requested email or the domain input is invalid.
   */
  async execute(command: CreateUserCommand) {
    const existingUser = await this.userRepository.findByEmail(command.email);

    if (existingUser) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, randomUUID(), {
        status: HttpStatus.CONFLICT,
      });
    }

    const user = User.register({
      email: command.email,
      displayName: command.displayName,
    });

    await this.userRepository.save(user);

    return UserMapper.toDto(user);
  }
}
