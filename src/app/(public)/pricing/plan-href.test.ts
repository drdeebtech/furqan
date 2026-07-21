import { describe, it, expect } from "vitest";
import { planHref } from "./content";

/**
 * A signed-in student who picks a plan on /pricing used to be sent to
 * /register. proxy.ts redirects authenticated users off every auth route to
 * /<role>/dashboard WITHOUT the query string, so the plan was silently
 * discarded and they landed somewhere unrelated having lost their choice.
 *
 * These assert the routing rule itself, not the string formatting: each
 * audience must reach a destination that can actually consume the plan.
 */
describe("planHref", () => {
  it("sends a signed-in student to checkout, not to a registration page", () => {
    const href = planHref("hifz_individual_6h", true);

    expect(href).toBe("/subscribe?plan=hifz_individual_6h");
    // The regression that started this: /register drops the plan for authed users.
    expect(href).not.toContain("/register");
  });

  it("sends a signed-out visitor to register, which carries the plan into signup", () => {
    const href = planHref("hifz_individual_6h", false);

    expect(href).toBe("/register?plan=hifz_individual_6h");
  });

  it("preserves the plan code in the query string for both audiences", () => {
    for (const authed of [true, false]) {
      const url = new URL(planHref("hifz_group_8", authed), "https://furqan.today");
      expect(url.searchParams.get("plan")).toBe("hifz_group_8");
    }
  });

  it("url-encodes the plan code so a hostile value cannot forge extra params", () => {
    const href = planHref("evil&redirect=/attacker", false);

    expect(href).not.toContain("&redirect=");
    const url = new URL(href, "https://furqan.today");
    expect(url.searchParams.get("plan")).toBe("evil&redirect=/attacker");
    expect(url.searchParams.get("redirect")).toBeNull();
  });

  it("covers every live plan code", () => {
    const codes = [
      "hifz_group_4",
      "hifz_group_6",
      "hifz_group_8",
      "hifz_individual_4h",
      "hifz_individual_6h",
      "hifz_individual_8h",
    ];

    for (const code of codes) {
      expect(planHref(code, true)).toBe(`/subscribe?plan=${code}`);
      expect(planHref(code, false)).toBe(`/register?plan=${code}`);
    }
  });
});
