import { describe, it, expect } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "./errors";
import { assertRole } from "./role-check";

describe("assertRole", () => {
  it("returns nothing when actual role is in the allowed list", () => {
    expect(() => assertRole("admin", ["admin"])).not.toThrow();
    expect(() => assertRole("admin", ["admin", "teacher"])).not.toThrow();
    expect(() => assertRole("teacher", ["admin", "teacher"])).not.toThrow();
  });

  it("throws ForbiddenError when actual role is not in the allowed list", () => {
    expect(() => assertRole("teacher", ["admin"])).toThrow(ForbiddenError);
    expect(() => assertRole("student", ["admin", "teacher"])).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when actual role is null (profile lookup miss)", () => {
    // Treat missing role same as wrong role — caller doesn't have the
    // required permission either way. UnauthenticatedError is for missing
    // session, NOT for missing profile.
    expect(() => assertRole(null, ["admin"])).toThrow(ForbiddenError);
  });

  it("error message names the allowed role(s) for debuggability", () => {
    expect(() => assertRole("teacher", ["admin"])).toThrow(/not admin\b/);
    expect(() => assertRole("student", ["admin", "teacher"])).toThrow(/not admin or teacher\b/);
  });
});

describe("UnauthenticatedError", () => {
  it("is an instance of ForbiddenError (backward-compat for existing 38 importers)", () => {
    const err = new UnauthenticatedError();
    // The 38 callers all do `if (e instanceof ForbiddenError)` — that branch
    // must still match for unauthed cases. Per ADR-0001.
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err).toBeInstanceOf(UnauthenticatedError);
  });

  it("has name='UnauthenticatedError' so error logging shows the right class", () => {
    expect(new UnauthenticatedError().name).toBe("UnauthenticatedError");
  });

  it("defaults to 'not authenticated' message", () => {
    expect(new UnauthenticatedError().message).toBe("not authenticated");
  });
});
