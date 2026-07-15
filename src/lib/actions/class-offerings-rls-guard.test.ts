import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * PR #702 — permanent regression guard for the class_offerings role gate.
 *
 * The "teacher rw own offerings" RLS policy MUST require the owner to hold
 * the 'teacher' role (profiles.roles), not just teacher_id = auth.uid().
 * Without the role predicate any authenticated user (e.g. a student) can
 * self-publish a paid group class (IDOR / missing RBAC at the data layer —
 * proven live on 2026-07-15, see PR #702).
 *
 * pgTAP doesn't run in this repo's CI, so this follows the established
 * static-migration-guard pattern (see no-debit-invariant.test.ts): every
 * migration that (re)defines the policy must carry the role predicate, so a
 * later migration can't silently regress it.
 */
describe("class_offerings RLS role gate (PR #702)", () => {
  const POLICY_NAME = "teacher rw own offerings";
  const migrationDir = resolve(process.cwd(), "supabase/migrations");
  const migrationFiles = readdirSync(migrationDir)
    .filter((f) => /\.sql$/.test(f))
    .sort()
    .map((f) => join(migrationDir, f));

  // Every `create policy "teacher rw own offerings" on ... class_offerings`
  // block, up to the terminating semicolon.
  const policyBlockRe = new RegExp(
    `create\\s+policy\\s+"${POLICY_NAME}"\\s+on\\s+(?:public\\.)?class_offerings[\\s\\S]*?;`,
    "gi",
  );
  const rolePredicateRe = /'teacher'(?:::public\.user_role)?\s*=\s*any\s*\(\s*p(?:rofiles)?\w*\.roles\s*\)/i;
  const ownershipRe = /teacher_id\s*=\s*\(?\s*select\s+auth\.uid\(\)\s*\)?/i;

  it("the latest definition of the policy requires the teacher role AND ownership (using + with check)", () => {
    const definitions: { file: string; body: string }[] = [];
    for (const file of migrationFiles) {
      const sql = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      while ((match = policyBlockRe.exec(sql)) !== null) {
        definitions.push({ file, body: match[0] });
      }
    }

    expect(
      definitions.length,
      `no migration defines the "${POLICY_NAME}" policy — if it was renamed, update this guard`,
    ).toBeGreaterThan(0);

    // Files sort by version, so the last collected block is what production
    // ends up with after a from-zero replay.
    const latest = definitions[definitions.length - 1];
    expect(
      rolePredicateRe.test(latest.body),
      `latest "${POLICY_NAME}" definition (${latest.file}) lost the 'teacher' role predicate — this re-opens student self-publishing of paid classes`,
    ).toBe(true);
    expect(
      ownershipRe.test(latest.body),
      `latest "${POLICY_NAME}" definition (${latest.file}) lost the teacher_id = auth.uid() ownership check`,
    ).toBe(true);

    // BOTH predicates (role + ownership) must appear in BOTH clauses.
    // USING alone gates reads/updates-of-existing-rows; WITH CHECK gates the
    // written row — dropping either predicate from either clause re-opens a
    // hole (e.g. WITH CHECK without ownership lets a teacher forge teacher_id).
    const usingClause = latest.body.match(/using\s*\(([\s\S]*?)\)\s*with\s+check/i);
    expect(
      usingClause,
      `latest "${POLICY_NAME}" definition (${latest.file}) has no USING clause before WITH CHECK`,
    ).not.toBeNull();
    const withCheck = latest.body.match(/with\s+check\s*\(([\s\S]*)\)\s*;?\s*$/i);
    expect(
      withCheck,
      `latest "${POLICY_NAME}" definition (${latest.file}) has no WITH CHECK clause — INSERT/UPDATE writes are ungated`,
    ).not.toBeNull();
    for (const [name, clause] of [
      ["USING", usingClause?.[1] ?? ""],
      ["WITH CHECK", withCheck?.[1] ?? ""],
    ] as const) {
      expect(
        rolePredicateRe.test(clause),
        `${name} of "${POLICY_NAME}" (${latest.file}) lost the 'teacher' role predicate`,
      ).toBe(true);
      expect(
        ownershipRe.test(clause),
        `${name} of "${POLICY_NAME}" (${latest.file}) lost the teacher_id = auth.uid() ownership check`,
      ).toBe(true);
    }
  });

  it("no migration drops the policy without recreating it in the same file", () => {
    const dropRe = new RegExp(
      `drop\\s+policy\\s+(?:if\\s+exists\\s+)?"${POLICY_NAME}"\\s+on\\s+(?:public\\.)?class_offerings`,
      "i",
    );
    const offenders: string[] = [];
    for (const file of migrationFiles) {
      const sql = readFileSync(file, "utf8");
      const dropIdx = sql.search(dropRe);
      if (dropIdx === -1) continue;
      // The recreation must come AFTER the (last) drop — a file that creates
      // then drops would replay from zero with no policy at all.
      let lastDropIdx = dropIdx;
      const dropAll = new RegExp(dropRe.source, "gi");
      let dm: RegExpExecArray | null;
      while ((dm = dropAll.exec(sql)) !== null) lastDropIdx = dm.index;
      policyBlockRe.lastIndex = lastDropIdx;
      const recreated = policyBlockRe.exec(sql);
      if (!recreated) offenders.push(file);
    }
    expect(
      offenders,
      `these migrations drop "${POLICY_NAME}" without recreating it (writes would fall through to weaker policies or none):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
