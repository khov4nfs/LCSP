import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  ACCOUNT_INVITATION_STATUSES as S,
  INVITATION_DELIVERY_STATUSES as D,
  ADMIN_ACCOUNT_OPERATIONS as O,
  ADMIN_ACCOUNT_ERRORS as E,
  ADMIN_ACCOUNT_REFERENCE_TYPES as R,
  AUTH_AUDIT_EVENT_TYPES,
  type AdminInvitationResult,
} from "@lcsp/contracts/auth";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import type { AccountInvitation } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { MailService } from "../../../../../platform/mail/mail.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  fingerprintToken,
  hashSecret,
} from "../../../infrastructure/security/security.utils.js";
import { AuthAuditService } from "../auth-workspace/auth-audit.service.js";
import {
  accountTransaction,
  assertCurrentAdmin,
  receipt,
  replay,
  requestHash,
  type AdminActor,
} from "./admin-account.transaction.js";
import {
  invalid,
  parseInvitation,
  record,
} from "./admin-account.validation.js";

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const DELIVERY_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class AdminAccountInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuthAuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async invite(
    raw: unknown,
    actor: AdminActor,
  ): Promise<AdminInvitationResult> {
    const input = parseInvitation(raw, actor.correlationId);
    // Provisioning must not simulate delivery when SMTP or encryption is absent.
    this.deliveryConfiguration(actor.correlationId);
    const hash = requestHash(O.invite, input);
    const result = await accountTransaction(
      this.prisma,
      actor.correlationId,
      async (tx) => {
        await assertCurrentAdmin(tx, actor);
        const previous = await replay(tx, actor, O.invite, hash);
        if (previous) {
          const pinned = await tx.accountInvitation.findUnique({
            where: { id: previous.resourceId },
          });
          if (!pinned || previous.resourceGeneration !== pinned.generation)
            return this.staleInvitation(actor.correlationId);
          return {
            id: pinned.id,
            generation: pinned.generation,
            replayed: true,
          };
        }
        const existingUser = await tx.user.findFirst({
          where: { email: { equals: input.email, mode: "insensitive" } },
          select: { id: true },
        });
        if (existingUser)
          throw problemException(E.duplicateAccount, actor.correlationId, {
            status: HttpStatus.CONFLICT,
          });
        const existing = await tx.accountInvitation.findUnique({
          where: { email: input.email },
        });
        const now = new Date();
        if (existing?.status === S.pending && existing.expiresAt > now)
          throw problemException(E.duplicateInvitation, actor.correlationId, {
            status: HttpStatus.CONFLICT,
          });
        const id = existing?.id ?? randomUUID();
        const generation = existing ? existing.generation + 1 : 0;
        const token = randomBytes(32).toString("hex");
        const data = {
          generation,
          email: input.email,
          displayName: input.displayName,
          role: input.role,
          status: S.pending,
          tokenHash: fingerprintToken(token),
          encryptedToken: this.encrypt(token, id, actor.correlationId),
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          invitedById: actor.userId,
          deliveryStatus: D.pending,
          deliveredAt: null,
          acceptedAt: null,
          acceptedUserId: null,
          deliveryLeaseId: null,
          deliveryLeaseUntil: null,
        };
        await tx.accountInvitation.upsert({
          where: { id },
          create: { id, ...data },
          update: { ...data, version: { increment: 1 }, createdAt: now },
        });
        await this.audit.writeInTx(
          {
            eventType: AUTH_AUDIT_EVENT_TYPES.authAdminInvitationCreated,
            actorId: actor.userId,
            sessionId: actor.sessionId,
            correlationId: actor.correlationId,
            resourceType: AUDIT_RESOURCE_TYPES.authInvitation,
            resourceId: id,
            decision: AUDIT_DECISIONS.allow,
            payload: {
              invitationId: id,
              intendedRole: input.role,
              expiresAt: data.expiresAt.toISOString(),
              reissued: Boolean(existing),
            },
          },
          tx,
        );
        await receipt(tx, actor, O.invite, hash, id, generation);
        return { id, generation, replayed: false };
      },
    );
    // SMTP runs after commit, outside account/last-admin locks. Retries with the
    // same idempotency key resend the SAME encrypted token, never a new invite.
    await this.deliver(result.id, result.generation, actor.correlationId);
    const invitation = await this.prisma.accountInvitation.findUniqueOrThrow({
      where: { id: result.id },
    });
    if (invitation.generation !== result.generation)
      return this.staleInvitation(actor.correlationId);
    return this.publicInvitation(invitation, result.replayed);
  }

  async accept(
    raw: unknown,
    correlationId: string,
  ): Promise<{ userId: string }> {
    const input = record(raw, correlationId, ["token", "password"]);
    if (typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token))
      return this.invalidInvitation(correlationId);
    if (
      typeof input.password !== "string" ||
      input.password.length < 12 ||
      input.password.length > 256
    )
      return invalid(correlationId);
    const tokenHash = fingerprintToken(input.token);
    // Check the high-entropy token before doing expensive password hashing.
    const candidate = await this.prisma.accountInvitation.findUnique({
      where: { tokenHash },
      select: { status: true, expiresAt: true },
    });
    if (
      !candidate ||
      candidate.status !== S.pending ||
      candidate.expiresAt <= new Date()
    )
      return this.invalidInvitation(correlationId);
    const passwordHash = hashSecret(input.password);
    return accountTransaction(this.prisma, correlationId, async (tx) => {
      const invitation = await tx.accountInvitation.findUnique({
        where: { tokenHash },
      });
      if (
        !invitation ||
        invitation.status !== S.pending ||
        invitation.expiresAt <= new Date()
      )
        return this.invalidInvitation(correlationId);
      const existing = await tx.user.findFirst({
        where: { email: { equals: invitation.email, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing) return this.invalidInvitation(correlationId);
      const userId = randomUUID();
      const now = new Date();
      const consumed = await tx.accountInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash,
          status: S.pending,
          expiresAt: { gt: now },
        },
        data: {
          status: S.accepted,
          acceptedAt: now,
          acceptedUserId: userId,
          encryptedToken: null,
          deliveryLeaseId: null,
          deliveryLeaseUntil: null,
          version: { increment: 1 },
        },
      });
      if (consumed.count !== 1) return this.invalidInvitation(correlationId);
      await tx.user.create({
        data: {
          id: userId,
          email: invitation.email,
          displayName: invitation.displayName,
          role: invitation.role,
          passwordHash,
          emailVerified: true,
          failedLoginCount: 0,
        },
      });
      await this.audit.writeInTx(
        {
          eventType: AUTH_AUDIT_EVENT_TYPES.authInvitationAccepted,
          actorId: userId,
          correlationId,
          resourceType: AUDIT_RESOURCE_TYPES.authInvitation,
          resourceId: invitation.id,
          decision: AUDIT_DECISIONS.allow,
          payload: {
            invitationId: invitation.id,
            targetUserId: userId,
            role: invitation.role,
            timestamp: now.toISOString(),
          },
        },
        tx,
      );
      // No automatic session: normal sign-in and MFA policy are required.
      return { userId };
    });
  }

  private async deliver(
    id: string,
    generation: number,
    correlationId: string,
  ): Promise<void> {
    const invitation = await this.prisma.accountInvitation.findUniqueOrThrow({
      where: { id },
    });
    if (invitation.generation !== generation)
      return this.staleInvitation(correlationId);
    if (invitation.status === S.accepted) return;
    if (invitation.status !== S.pending || invitation.expiresAt <= new Date())
      return this.invalidInvitation(correlationId);
    if (invitation.deliveryStatus === D.sent) return;
    const leaseId = randomUUID();
    const now = new Date();
    const acquired = await this.prisma.accountInvitation.updateMany({
      where: {
        id,
        version: invitation.version,
        status: S.pending,
        deliveryStatus: { not: D.sent },
        OR: [
          { deliveryLeaseUntil: null },
          { deliveryLeaseUntil: { lte: now } },
        ],
      },
      data: {
        deliveryLeaseId: leaseId,
        deliveryLeaseUntil: new Date(now.getTime() + DELIVERY_LEASE_MS),
      },
    });
    if (acquired.count !== 1)
      throw problemException(E.invitationDeliveryPending, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    try {
      const { origin } = this.deliveryConfiguration(correlationId);
      if (!invitation.encryptedToken)
        throw new Error("Invitation delivery material unavailable");
      const token = this.decrypt(invitation.encryptedToken, id, correlationId);
      const link = `${origin}/sign-up#invitation=${encodeURIComponent(token)}`;
      await this.mail.send({
        to: invitation.email,
        subject: "LCSP account invitation",
        text: `You have been invited to LCSP. Set your own password using this one-time link (valid for 48 hours): ${link}`,
        html: `<p>You have been invited to LCSP.</p><p><a href="${link}">Set up your account</a></p><p>This one-time invitation expires in 48 hours. Ignore this message if unexpected.</p>`,
      });
      await this.prisma.accountInvitation.updateMany({
        where: {
          id,
          version: invitation.version,
          deliveryLeaseId: leaseId,
          status: S.pending,
        },
        data: {
          deliveryStatus: D.sent,
          deliveredAt: new Date(),
          encryptedToken: null,
          deliveryLeaseId: null,
          deliveryLeaseUntil: null,
        },
      });
    } catch {
      await this.prisma.accountInvitation.updateMany({
        where: { id, version: invitation.version, deliveryLeaseId: leaseId },
        data: {
          deliveryStatus: D.failed,
          deliveryLeaseId: null,
          deliveryLeaseUntil: null,
        },
      });
      throw problemException(E.invitationDeliveryFailed, correlationId, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
  }

  private publicInvitation(
    i: AccountInvitation,
    replayed: boolean,
  ): AdminInvitationResult {
    return {
      id: `invitation:${i.id}`,
      referenceType: R.invitation,
      email: i.email,
      fullName: i.displayName,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      deliveryStatus: i.deliveryStatus,
      replayed,
    };
  }
  private staleInvitation(correlationId: string): never {
    throw problemException(E.staleInvitation, correlationId, {
      status: HttpStatus.CONFLICT,
    });
  }
  private invalidInvitation(correlationId: string): never {
    throw problemException(E.invalidInvitation, correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
  private deliveryConfiguration(correlationId: string) {
    const secret = this.config.get<string>("ADMIN_INVITATION_ENCRYPTION_KEY");
    const rawOrigin = this.config.get<string>("ADMIN_INVITATION_WEB_ORIGIN");
    let origin: string;
    try {
      const url = new URL(rawOrigin ?? "");
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
          ))
      )
        throw new Error("Invalid origin");
      origin = url.origin;
    } catch {
      throw problemException(E.invitationUnavailable, correlationId, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    if (!this.mail.isConfigured() || !secret || secret.length < 32)
      throw problemException(E.invitationUnavailable, correlationId, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    return { key: createHash("sha256").update(secret).digest(), origin };
  }
  private encrypt(token: string, id: string, correlationId: string): string {
    const { key } = this.deliveryConfiguration(correlationId);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(id));
    const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), bytes]
      .map((part) => part.toString("hex"))
      .join(".");
  }
  private decrypt(value: string, id: string, correlationId: string): string {
    const [iv, tag, bytes] = value
      .split(".")
      .map((part) => Buffer.from(part, "hex"));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.deliveryConfiguration(correlationId).key,
      iv,
    );
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes), decipher.final()]).toString(
      "utf8",
    );
  }
}
