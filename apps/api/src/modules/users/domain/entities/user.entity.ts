import { UserEmail } from "../value-objects/user-email.value-object.js";
import { UserId } from "../value-objects/user-id.value-object.js";

type UserProps = {
  id: UserId;
  email: UserEmail;
  displayName: string;
  createdAt: Date;
};

type NewUserProps = Omit<UserProps, "id">;

/**
 * Represents a user aggregate with validated identity, email, display name, and creation metadata.
 */
export class User {
  private readonly props: UserProps;

  /**
   * Creates a user aggregate from validated properties, generating an identifier when one is not supplied.
   *
   * @param props - Validated user properties excluding the identifier.
   * @param id - Existing identifier when rehydrating, or a generated identifier for new users.
   */
  private constructor(props: NewUserProps, id = UserId.generate()) {
    this.props = { ...props, id };
  }

  /**
   * Registers a new user after normalizing the display name and validating the email value object.
   *
   * @param input - Raw email and display name supplied for registration.
   * @returns A newly registered user aggregate.
   * @throws When the display name is empty or the email violates its value-object invariant.
   */
  static register(input: { email: string; displayName: string }): User {
    const displayName = input.displayName.trim();

    if (!displayName) {
      throw new Error("Display name is required");
    }

    return new User({
      email: UserEmail.create(input.email),
      displayName,
      createdAt: new Date(),
    });
  }

  /**
   * Reconstructs a user aggregate from persisted domain properties without generating a new identifier.
   *
   * @param props - Fully populated persisted user properties.
   * @returns A rehydrated user aggregate.
   */
  static rehydrate(props: UserProps): User {
    return new User(props, props.id);
  }

  /** @returns The user's domain identifier. */
  get id(): UserId {
    return this.props.id;
  }

  /** @returns The user's normalized email value object. */
  get email(): UserEmail {
    return this.props.email;
  }

  /** @returns The user's normalized display name. */
  get displayName(): string {
    return this.props.displayName;
  }

  /** @returns The timestamp at which the user was created. */
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
