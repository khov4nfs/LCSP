import { Query } from "@nestjs/cqrs";

import type { UserDto } from "../../contracts/user/user.dto.js";

/**
 * Requests one user DTO by its domain identifier.
 */
export class GetUserByIdQuery extends Query<UserDto> {
  /**
   * Creates the user lookup query.
   *
   * @param id - User identifier to retrieve.
   */
  constructor(public readonly id: string) {
    super();
  }
}
