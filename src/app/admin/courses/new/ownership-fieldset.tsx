"use client";

import { useState } from "react";

interface TeacherOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface OwnershipFieldsetProps {
  teachers: TeacherOption[];
  labels: {
    ownership: string;
    platform: string;
    platformHint: string;
    teacher: string;
    teacherHint: string;
    selectTeacher: string;
    selectTeacherPlaceholder: string;
    noTeachers: string;
  };
}

export function OwnershipFieldset({ teachers, labels }: OwnershipFieldsetProps) {
  const [ownership, setOwnership] = useState<"platform" | "teacher">("teacher");

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 block text-sm font-medium">
          {labels.ownership} *
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
              ownership === "platform"
                ? "border-gold bg-gold/10"
                : "border-[var(--surface-border)] bg-[var(--surface)] hover:bg-white/40 dark:hover:bg-white/5"
            }`}
          >
            <input
              type="radio"
              name="ownership"
              value="platform"
              checked={ownership === "platform"}
              onChange={() => setOwnership("platform")}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">{labels.platform}</span>
              <span className="mt-0.5 block text-xs text-muted">
                {labels.platformHint}
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
              ownership === "teacher"
                ? "border-gold bg-gold/10"
                : "border-[var(--surface-border)] bg-[var(--surface)] hover:bg-white/40 dark:hover:bg-white/5"
            }`}
          >
            <input
              type="radio"
              name="ownership"
              value="teacher"
              checked={ownership === "teacher"}
              onChange={() => setOwnership("teacher")}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">{labels.teacher}</span>
              <span className="mt-0.5 block text-xs text-muted">
                {labels.teacherHint}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {ownership === "teacher" && (
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="teacher_id">
            {labels.selectTeacher} *
          </label>
          <select
            id="teacher_id"
            name="teacher_id"
            required
            defaultValue=""
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-sm focus-ring"
          >
            <option value="" disabled>
              {labels.selectTeacherPlaceholder}
            </option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.full_name ?? teacher.email ?? teacher.id}
                {teacher.email ? ` · ${teacher.email}` : ""}
              </option>
            ))}
          </select>
          {teachers.length === 0 && (
            <p className="mt-1 text-xs text-warning">{labels.noTeachers}</p>
          )}
        </div>
      )}
    </div>
  );
}
