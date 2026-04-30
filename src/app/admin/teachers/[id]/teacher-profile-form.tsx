"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { updateTeacherProfile, type ActionResult } from "./actions";

const input =
  "w-full rounded-xl glass-input px-4 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none";

interface TeacherProfileFormProps {
  teacherId: string;
  profile: {
    hourly_rate: number;
    gender: string | null;
    max_active_students: number | null;
    is_accepting: boolean;
    is_archived: boolean;
  };
}

export function TeacherProfileForm({ teacherId, profile }: TeacherProfileFormProps) {
  const boundAction = updateTeacherProfile.bind(null, teacherId);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(boundAction, {});

  return (
    <div className="glass-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        بيانات المعلم
        <span className="me-2 text-sm font-normal text-muted">Teacher profile</span>
      </h2>

      {state.error && (
        <div role="alert" className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="mb-4 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
          تم الحفظ بنجاح
        </div>
      )}

      <form action={formAction} className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">
            السعر/ساعة
            <span className="me-2 text-xs text-muted">Hourly rate</span>
          </label>
          <input
            name="hourly_rate"
            type="number"
            min="1"
            max="500"
            defaultValue={profile.hourly_rate}
            className={input}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            الجنس
            <span className="me-2 text-xs text-muted">Gender</span>
          </label>
          <select name="gender" defaultValue={profile.gender ?? ""} className={input}>
            <option value="">—</option>
            <option value="male">ذكر / Male</option>
            <option value="female">أنثى / Female</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            الحد الأقصى للطلاب النشطين
            <span className="me-2 text-xs text-muted">Max active students</span>
          </label>
          <input
            name="max_active_students"
            type="number"
            min="1"
            defaultValue={profile.max_active_students ?? ""}
            className={input}
          />
        </div>

        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_accepting"
              defaultChecked={profile.is_accepting}
              className="accent-gold"
            />
            <span>يقبل طلاب جدد <span className="text-xs text-muted">(accepting)</span></span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_archived"
              defaultChecked={profile.is_archived}
              className="accent-rose-500"
            />
            <span className="text-error">مؤرشف <span className="text-xs text-muted">(archived — hides from public)</span></span>
          </label>
        </div>

        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="glass-gold glass-pill flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
          >
            <Save size={14} />
            حفظ التعديلات
          </button>
        </div>
      </form>
    </div>
  );
}
