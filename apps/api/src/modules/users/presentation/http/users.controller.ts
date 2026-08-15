import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import { CreateUserCommand } from "../../application/commands/create-user/create-user.command.js";
import { GetUserByIdQuery } from "../../application/queries/get-user-by-id/get-user-by-id.query.js";
import { CreateUserRequest } from "./dto/create-user.request.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";

/**
 * Exposes user registration and lookup endpoints through the CQRS application layer.
 */
@Controller("users")
export class UsersController {
  /**
   * Creates the controller with command and query dispatchers.
   *
   * @param commandBus - CQRS command bus used for user mutations.
   * @param queryBus - CQRS query bus used for user reads.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Registers a new user from the HTTP request body.
   *
   * @param body - User registration request containing email and display name.
   * @returns The standard result envelope containing the newly registered user DTO.
   */
  @Post()
  async createUser(@Body() body: CreateUserRequest) {
    return resultEnvelope(
      await this.commandBus.execute(
        new CreateUserCommand(body.email, body.displayName),
      ),
    );
  }

  /**
   * Retrieves one user by its route identifier.
   *
   * @param id - User identifier from the request path.
   * @returns The standard result envelope containing the matching user DTO.
   */
  @Get(":id")
  async getUserById(@Param("id") id: string) {
    return resultEnvelope(
      await this.queryBus.execute(new GetUserByIdQuery(id)),
    );
  }
}
