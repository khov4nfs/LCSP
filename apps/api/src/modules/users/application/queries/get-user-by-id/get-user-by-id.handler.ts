import { randomUUID } from "node:crypto";

import { HttpStatus, Inject } from "@nestjs/common";
import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";

import { UserMapper } from "../../mappers/user.mapper.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  USER_REPOSITORY,
  type UserRepository,
} from "../../ports/persistence/user.repository.js";
import { GetUserByIdQuery } from "./get-user-by-id.query.js";

/**
 * Resolves a user lookup query through the user repository and DTO mapper.
 */
@QueryHandler(GetUserByIdQuery)
export class GetUserByIdHandler implements IQueryHandler<GetUserByIdQuery> {
  /**
   * Creates the query handler with the user persistence port.
   *
   * @param userRepository - Repository used to retrieve the requested user aggregate.
   */
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * Retrieves one user by identifier and maps it to the application DTO.
   *
   * @param query - User lookup query containing the requested identifier.
   * @returns The matching user DTO.
   * @throws When no user exists for the supplied identifier.
   */
  async execute(query: GetUserByIdQuery) {
    const user = await this.userRepository.findById(query.id);

    if (!user) {
      throw problemException(AUTH_ERROR_CODES.accountNotFound, randomUUID(), {
        status: HttpStatus.NOT_FOUND,
      });
    }

    return UserMapper.toDto(user);
  }
}
