import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRequire } from "node:module";

import type { AppConfig } from "../../config/config.types.js";

/**
 * Sends application email through the SMTP configuration exposed by the runtime config service.
 */
@Injectable()
export class MailService {
  private transporter: SmtpMailer | null = null;

  /**
   * Creates the mail service with access to application SMTP settings.
   *
   * @param configService - Configuration service used to resolve email transport settings.
   */
  constructor(private readonly configService: ConfigService<AppConfig>) {}

  /**
   * Reports whether the minimum SMTP settings required to send mail are available.
   *
   * @returns True when both SMTP host and sender address are configured.
   */
  isConfigured(): boolean {
    return this.readConfig() !== null;
  }

  /**
   * Sends an email using the lazily created Nodemailer SMTP transporter.
   *
   * @param options - Message recipients, content, subject, and optional sender override.
   * @returns Delivery metadata returned by Nodemailer.
   * @throws When SMTP is not configured.
   */
  async send(options: MailMessage): Promise<MailSendResult> {
    const config = this.readConfig();
    if (!config) {
      throw new Error("SMTP is not configured");
    }

    const transporter = this.getTransporter(config);
    return transporter.sendMail({
      from: options.from ?? config.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }

  /**
   * Creates and caches the SMTP transporter for repeated mail sends.
   *
   * @param config - Normalized SMTP settings used to create the transport.
   * @returns Cached mailer abstraction backed by Nodemailer.
   */
  private getTransporter(config: SmtpConfig): SmtpMailer {
    if (!this.transporter) {
      const transporter = loadNodemailer().createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth:
          config.user && config.password
            ? {
                user: config.user,
                pass: config.password,
              }
            : undefined,
      });
      this.transporter = {
        sendMail: (options) => transporter.sendMail(options),
      };
    }

    return this.transporter;
  }

  /**
   * Reads and normalizes SMTP settings from application configuration.
   *
   * @returns Normalized SMTP configuration, or null when required settings are absent.
   */
  private readConfig(): SmtpConfig | null {
    const emailConfig = this.configService.get<AppConfig["email"]>("email");
    const host = emailConfig?.smtpHost.trim();
    const from = emailConfig?.smtpFrom.trim();
    if (!host || !from) {
      return null;
    }

    const port = emailConfig?.smtpPort ?? 587;
    const secure = emailConfig?.smtpSecure ?? false;

    return {
      host,
      port: Number.isFinite(port) ? port : 587,
      secure,
      user: emailConfig?.smtpUser.trim() || null,
      password: emailConfig?.smtpPass.trim() || null,
      from,
    };
  }
}

export type MailMessage = {
  from?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailSendResult = {
  messageId: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
};

type SmtpTransportAuth = {
  user: string;
  pass: string;
};

type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth?: SmtpTransportAuth;
};

type SmtpMailer = {
  sendMail(options: MailMessage): Promise<MailSendResult>;
};

type NodemailerTransporter = {
  sendMail(options: MailMessage): Promise<MailSendResult>;
};

type NodemailerModule = {
  createTransport(options: SmtpTransportOptions): NodemailerTransporter;
};

const require = createRequire(import.meta.url);

/**
 * Loads Nodemailer at runtime and verifies that its transport factory is usable.
 *
 * @returns Validated Nodemailer module abstraction.
 * @throws When the loaded module does not expose a usable `createTransport` function.
 */
function loadNodemailer(): NodemailerModule {
  const candidate: unknown = require("nodemailer");
  if (!isNodemailerModule(candidate)) {
    throw new Error(
      "nodemailer module is missing a usable createTransport function",
    );
  }
  return candidate;
}

/**
 * Checks whether a dynamically loaded value matches the Nodemailer module contract used here.
 *
 * @param value - Dynamically loaded module value to inspect.
 * @returns True when the value exposes a callable `createTransport` member.
 */
function isNodemailerModule(value: unknown): value is NodemailerModule {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const createTransport = getUnknownProperty(value, "createTransport");
  return typeof createTransport === "function";
}

/**
 * Reads a property from an object without assuming its compile-time shape.
 *
 * @param value - Object whose property should be read.
 * @param propertyName - Property key to retrieve.
 * @returns The property value as unknown.
 */
function getUnknownProperty(value: object, propertyName: string): unknown {
  return Reflect.get(value, propertyName) as unknown;
}
