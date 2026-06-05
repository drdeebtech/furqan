import { describe, it, expect, vi } from "vitest";

// server-only is a runtime guard — no-op in test environment
vi.mock("server-only", () => ({}));

// shared.ts imports from @/types/supabase.generated via AdminClient typedef —
// that import is type-only so no runtime mock is needed here.

import { assertCanManage } from "./shared";
import { FollowUpUserError } from "./types";

// ---------------------------------------------------------------------------
// assertCanManage(actor, ownerTeacherId, message)
//
// actor: { id: string; isAdmin: boolean }  (FollowUpActor)
// Allows when:  actor.id === ownerTeacherId  OR  actor.isAdmin === true
// Throws FollowUpUserError otherwise.
// ---------------------------------------------------------------------------

describe("assertCanManage", () => {
  const OWNER_ID = "teacher-owner-1";
  const OTHER_ID = "teacher-other-2";
  const AUTH_MSG = "غير مصرح بهذه العملية";

  it("throws FollowUpUserError (غير مصرح) when actor is a non-owner, non-admin (student role equivalent)", () => {
    // Represents a student: isAdmin=false and id does not match owner
    const actor = { id: "student-99", isAdmin: false };
    expect(() => assertCanManage(actor, OWNER_ID, AUTH_MSG)).toThrow(
      FollowUpUserError,
    );
    expect(() => assertCanManage(actor, OWNER_ID, AUTH_MSG)).toThrow(
      /غير مصرح/,
    );
  });

  it("throws FollowUpUserError (غير مصرح) when actor is a non-owner teacher (isAdmin=false, id ≠ ownerId)", () => {
    const actor = { id: OTHER_ID, isAdmin: false };
    expect(() => assertCanManage(actor, OWNER_ID, AUTH_MSG)).toThrow(
      FollowUpUserError,
    );
    expect(() => assertCanManage(actor, OWNER_ID, AUTH_MSG)).toThrow(
      /غير مصرح/,
    );
  });

  it("does NOT throw when actor is the owning teacher (isAdmin=false, id === ownerId)", () => {
    const actor = { id: OWNER_ID, isAdmin: false };
    expect(() => assertCanManage(actor, OWNER_ID, AUTH_MSG)).not.toThrow();
  });

  it("does NOT throw when actor is an admin regardless of owner id", () => {
    const actor = { id: "admin-77", isAdmin: true };
    expect(() => assertCanManage(actor, OWNER_ID, AUTH_MSG)).not.toThrow();
  });
});
