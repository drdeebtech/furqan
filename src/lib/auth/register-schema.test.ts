import { describe, it, expect } from "vitest";
import { registerSchema, registerErrorMessage } from "./register-schema";

const valid = {
  full_name: "محمد أحمد",
  email: "user@example.com",
  password: "Str0ngPass!",
  confirm_password: "Str0ngPass!",
  consent: "yes",
};

describe("registerSchema — consent enforcement (Wave 0 compliance)", () => {
  it("accepts a complete submission with consent", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when the consent field is ABSENT entirely (hostile client strips the checkbox)", () => {
    const { consent: _consent, ...withoutConsent } = valid;
    const result = registerSchema.safeParse(withoutConsent);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(registerErrorMessage(result.error)).toContain("الموافقة");
    }
  });

  it("rejects when consent is any value other than the literal yes", () => {
    for (const bad of ["", "no", "true", "on", "1"]) {
      const result = registerSchema.safeParse({ ...valid, consent: bad });
      expect(result.success, `consent="${bad}" must fail`).toBe(false);
    }
  });

  it("consent error message wins over other field errors (user fixes the blocking one first)", () => {
    const result = registerSchema.safeParse({ ...valid, consent: "no", email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(registerErrorMessage(result.error)).toContain("الموافقة");
    }
  });

  it("rejects invalid email and short password with tailored messages", () => {
    const badEmail = registerSchema.safeParse({ ...valid, email: "nope" });
    expect(badEmail.success).toBe(false);
    if (!badEmail.success) {
      expect(registerErrorMessage(badEmail.error)).toContain("البريد");
    }

    const shortPw = registerSchema.safeParse({ ...valid, password: "short", confirm_password: "short" });
    expect(shortPw.success).toBe(false);
    if (!shortPw.success) {
      expect(registerErrorMessage(shortPw.error)).toContain("كلمة المرور");
    }
  });

  it("tolerates a missing plan (nullish) but caps its length", () => {
    expect(registerSchema.safeParse({ ...valid, plan: null }).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, plan: "x".repeat(101) }).success).toBe(false);
  });
});
