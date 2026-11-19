import { describe, expect, it, jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../config/config.types.js";

const mockSendMail = jest.fn<
  (options: unknown) => Promise<{ messageId: string }>
>(() => Promise.resolve({ messageId: "msg-123" }));

const mockCreateTransport = jest.fn<
  (options: unknown) => { sendMail: typeof mockSendMail }
>((_options) => ({
  sendMail: mockSendMail,
}));

jest.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport,
  },
  createTransport: mockCreateTransport,
}));

import { MailService } from "./mail.service.js";

function createMockConfigService(
  emailConfig?: Partial<AppConfig["email"]>,
): ConfigService<AppConfig> {
  return {
    get: jest.fn((key: string) => {
      if (key === "email") {
        return emailConfig ?? null;
      }
      return null;
    }),
  } as unknown as ConfigService<AppConfig>;
}

describe("MailService", () => {
  it("reports isConfigured false when email config is missing", () => {
    const configService = createMockConfigService();
    const service = new MailService(configService);

    expect(service.isConfigured()).toBe(false);
  });

  it("reports isConfigured false when email config is an empty object", () => {
    const configService = createMockConfigService({});
    const service = new MailService(configService);

    expect(service.isConfigured()).toBe(false);
  });

  it("reports isConfigured false when host or from address is blank", () => {
    const configService = createMockConfigService({
      smtpHost: "   ",
      smtpFrom: "noreply@example.com",
    });
    const service = new MailService(configService);

    expect(service.isConfigured()).toBe(false);

    const configServiceNoFrom = createMockConfigService({
      smtpHost: "smtp.example.com",
      smtpFrom: "   ",
    });
    const serviceNoFrom = new MailService(configServiceNoFrom);

    expect(serviceNoFrom.isConfigured()).toBe(false);
  });

  it("reports isConfigured true when host and from address are set", () => {
    const configService = createMockConfigService({
      smtpHost: "smtp.example.com",
      smtpFrom: "noreply@example.com",
    });
    const service = new MailService(configService);

    expect(service.isConfigured()).toBe(true);
  });

  it("throws when send is called but SMTP is not configured", async () => {
    const configService = createMockConfigService();
    const service = new MailService(configService);

    await expect(
      service.send({
        to: "user@example.com",
        subject: "Test",
        text: "Plain",
        html: "<p>HTML</p>",
      }),
    ).rejects.toThrow("SMTP is not configured");
  });

  it("sends email and reuses cached transporter across calls", async () => {
    const configService = createMockConfigService({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "mailer",
      smtpPass: "secret",
      smtpFrom: "system@example.com",
    });
    const service = new MailService(configService);

    const result = await service.send({
      to: "recipient@example.com",
      subject: "Hello",
      text: "World",
      html: "<p>World</p>",
    });

    expect(result).toEqual({ messageId: "msg-123" });
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: {
        user: "mailer",
        pass: "secret",
      },
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "system@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      text: "World",
      html: "<p>World</p>",
    });

    // Send again to verify transporter caching
    await service.send({
      from: "custom@example.com",
      to: "recipient2@example.com",
      subject: "Second",
      text: "Two",
      html: "<p>Two</p>",
    });

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it("creates transporter without auth options when SMTP credentials are not configured", async () => {
    mockCreateTransport.mockClear();
    mockSendMail.mockClear();

    const configService = createMockConfigService({
      smtpHost: "relay.internal.net",
      smtpPort: 25,
      smtpSecure: false,
      smtpFrom: "noreply@internal.net",
    });
    const service = new MailService(configService);

    await service.send({
      to: "recipient@internal.net",
      subject: "Relay Test",
      text: "No Auth",
      html: "<p>No Auth</p>",
    });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "relay.internal.net",
      port: 25,
      secure: false,
      auth: undefined,
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "noreply@internal.net",
      to: "recipient@internal.net",
      subject: "Relay Test",
      text: "No Auth",
      html: "<p>No Auth</p>",
    });
  });
});
