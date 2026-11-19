import { describe, expect, it } from "@jest/globals";
import { renderMailTemplate } from "./mail-template.renderer.js";

describe("renderMailTemplate", () => {
  it("renders recovery-email.html template with variables substituted", () => {
    const rendered = renderMailTemplate("recovery-email.html", {
      recoveryLink: "https://lcsp.example.com/auth/reset?token=xyz123",
    });

    expect(rendered).toContain("https://lcsp.example.com/auth/reset?token=xyz123");
    expect(rendered).toContain("Password recovery");
    expect(rendered).not.toContain("{{recoveryLink}}");
  });

  it("escapes special HTML characters to prevent XSS injection in email clients", () => {
    const maliciousInput = 'https://lcsp.example.com/reset?a=<script>alert("xss")</script>&b=\'test\'';
    const rendered = renderMailTemplate("recovery-email.html", {
      recoveryLink: maliciousInput,
    });

    expect(rendered).toContain(
      "https://lcsp.example.com/reset?a=&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;b=&#39;test&#39;",
    );
    expect(rendered).not.toContain("<script>");
  });

  it("throws when requested template does not exist on disk", () => {
    expect(() =>
      renderMailTemplate("non-existent-template.html", {}),
    ).toThrow();
  });
});
