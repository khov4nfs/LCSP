import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { GitHubAppInstallStateRepository } from "../../application/ports/persistence/github-app-install-state.repository.js";
import { GitHubAppInstallState } from "../../domain/entities/github-app-install-state.entity.js";

/**
 * Persists short-lived GitHub App installation state with Prisma and rehydrates it into the domain entity.
 */
@Injectable()
export class PrismaGitHubAppInstallStateRepository implements GitHubAppInstallStateRepository {
  /**
   * Creates the repository with the application Prisma client.
   *
   * @param prisma - Prisma service used for installation-state persistence.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a newly generated GitHub App installation state.
   *
   * @param installState - Opaque installation-state aggregate to store until callback consumption or expiry.
   * @returns A promise that resolves after persistence completes.
   */
  async save(installState: GitHubAppInstallState): Promise<void> {
    await this.prisma.gitHubAppInstallState.create({
      data: {
        id: installState.id,
        state: installState.state,
        assessmentId: installState.assessmentId,
        organizationId: installState.organizationId,
        userId: installState.userId,
        redirectUri: installState.redirectUri,
        expiresAt: installState.expiresAt,
        createdAt: installState.createdAt,
      },
    });
  }

  /**
   * Finds and rehydrates installation state by its opaque callback value.
   *
   * @param state - Opaque GitHub callback state to look up.
   * @returns Rehydrated install-state aggregate, or null when no state exists.
   */
  async findByState(state: string): Promise<GitHubAppInstallState | null> {
    const row = await this.prisma.gitHubAppInstallState.findUnique({
      where: { state },
    });
    if (!row) {
      return null;
    }
    return GitHubAppInstallState.rehydrate({
      id: row.id,
      state: row.state,
      assessmentId: row.assessmentId,
      organizationId: row.organizationId,
      userId: row.userId,
      redirectUri: row.redirectUri,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    });
  }

  /**
   * Deletes installation state after callback consumption so the opaque state cannot be replayed.
   *
   * @param id - Install-state entity identifier to remove.
   * @returns A promise that resolves after deletion completes.
   */
  async deleteById(id: string): Promise<void> {
    await this.prisma.gitHubAppInstallState.deleteMany({ where: { id } });
  }
}
