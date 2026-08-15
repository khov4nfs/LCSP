import { User } from "../../domain/entities/user.entity.js";
import type { UserDto } from "../contracts/user/user.dto.js";

/**
 * Maps user domain aggregates to application-facing DTO representations.
 */
export class UserMapper {
  /**
   * Converts a user aggregate into its serialized DTO shape.
   *
   * @param user - User aggregate to serialize.
   * @returns DTO containing primitive user identity and creation fields.
   */
  static toDto(user: User): UserDto {
    return {
      id: user.id.toString(),
      email: user.email.toString(),
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
