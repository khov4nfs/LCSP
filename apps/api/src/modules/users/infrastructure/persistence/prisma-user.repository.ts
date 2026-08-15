import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { UserRepository } from "../../application/ports/persistence/user.repository.js";
import { User } from "../../domain/entities/user.entity.js";
import { UserEmail } from "../../domain/value-objects/user-email.value-object.js";
import { UserId } from "../../domain/value-objects/user-id.value-object.js";

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

/**
 * Implements user persistence with Prisma while translating database records back into domain aggregates.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  /**
   * Creates the repository with the application Prisma client.
   *
   * @param prisma - Prisma service used for user persistence and lookups.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists the current state of a user aggregate using an idempotent upsert.
   *
   * @param user - User aggregate to create or update.
   * @returns A promise that resolves after persistence completes.
   */
  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id.toString() },
      create: {
        id: user.id.toString(),
        email: user.email.toString(),
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      update: {
        email: user.email.toString(),
        displayName: user.displayName,
      },
    });
  }

  /**
   * Finds a user aggregate by its identifier.
   *
   * @param id - User identifier to look up.
   * @returns The rehydrated user aggregate, or null when no row exists.
   */
  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });

    return record ? this.rehydrate(record) : null;
  }

  /**
   * Finds a user by email after applying the same trim/lowercase normalization used by the domain.
   *
   * @param email - Raw email address to normalize and look up.
   * @returns The rehydrated user aggregate, or null when no matching row exists.
   */
  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    const record = await this.prisma.user.findUnique({
      where: { email: normalized },
    });

    return record ? this.rehydrate(record) : null;
  }

  /**
   * Reconstructs a user domain aggregate from a Prisma record.
   *
   * @param record - Persisted primitive user fields.
   * @returns A rehydrated user aggregate with value-object identity and email fields.
   */
  private rehydrate(record: UserRecord): User {
    return User.rehydrate({
      id: UserId.create(record.id),
      email: UserEmail.create(record.email),
      displayName: record.displayName,
      createdAt: record.createdAt,
    });
  }
}
