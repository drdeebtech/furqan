"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, X, Pencil, CalendarX } from "lucide-react";
import {
  upsertAvailability,
  deleteAvailability,
  upsertException,
  deleteException,
  type ActionResult,
} from "./actions";

const input =
  "w-full rounded-xl glass-input px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

const DAYS = [
  { value: 0, ar: "الأحد" },
  { value: 1, ar: "الاثنين" },
  { value: 2, ar: "الثلاثاء" },
  { value: 3, ar: "الأربعاء" },
  { value: 4, ar: "الخميس" },
  { value: 5, ar: "الجمعة" },
  { value: 6, ar: "السبت" },
];

interface Slot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration: number;
  is_active: boolean;
}

interface Exception {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_blocked: boolean;
  reason: string | null;
}

interface AvailabilityEditorProps {
  teacherId: string;
  slots: Slot[];
  exceptions: Exception[];
}

function detectOverlap(
  existing: Slot[],
  candidate: { day_of_week: number; start_time: string; end_time: string; id?: string },
): string | null {
  const sameDay = existing.filter(
    (s) => s.day_of_week === candidate.day_of_week && s.id !== candidate.id,
  );
  const candStart = candidate.start_time.slice(0, 5);
  const candEnd = candidate.end_time.slice(0, 5);

  for (const s of sameDay) {
    const sStart = s.start_time.slice(0, 5);
    const sEnd = s.end_time.slice(0, 5);
    if (sStart < candEnd && candStart < sEnd) {
      return `تتعارض مع فترة موجودة ${sStart}–${sEnd} في نفس اليوم`;
    }
  }
  return null;
}

export function AvailabilityEditor({ teacherId, slots, exceptions }: AvailabilityEditorProps) {
  const router = useRouter();
  const [addingSlot, setAddingSlot] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [addingException, setAddingException] = useState(false);

  const sortedSlots = [...slots].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
  );

  return (
    <div className="space-y-6">
      {/* Weekly slots */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            الجدول الأسبوعي
            <span className="me-2 text-sm font-normal text-muted">Weekly slots ({slots.length})</span>
          </h2>
          {!addingSlot && !editingSlotId && (
            <button
              type="button"
              onClick={() => setAddingSlot(true)}
              className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-gold-hover"
            >
              <Plus size={14} />
              إضافة فترة
            </button>
          )}
        </div>

        {addingSlot && (
          <SlotForm
            teacherId={teacherId}
            existingSlots={slots}
            onDone={() => {
              setAddingSlot(false);
              router.refresh();
            }}
            onCancel={() => setAddingSlot(false)}
          />
        )}

        <div className="mt-3 space-y-2">
          {sortedSlots.length === 0 && !addingSlot && (
            <p className="rounded-xl glass-card p-6 text-center text-sm text-muted">
              لا توجد فترات متاحة — أضف أول فترة لتبدأ.
            </p>
          )}

          {sortedSlots.map((slot) => (
            <div key={slot.id}>
              {editingSlotId === slot.id ? (
                <SlotForm
                  teacherId={teacherId}
                  initial={slot}
                  existingSlots={slots}
                  onDone={() => {
                    setEditingSlotId(null);
                    router.refresh();
                  }}
                  onCancel={() => setEditingSlotId(null)}
                />
              ) : (
                <SlotRow
                  teacherId={teacherId}
                  slot={slot}
                  onEdit={() => setEditingSlotId(slot.id)}
                  onChanged={() => router.refresh()}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Exceptions */}
      <div className="border-t border-white/10 pt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarX size={18} className="text-amber-400" />
            الاستثناءات
            <span className="me-1 text-sm font-normal text-muted">
              Exceptions ({exceptions.length})
            </span>
          </h2>
          {!addingException && (
            <button
              type="button"
              onClick={() => setAddingException(true)}
              className="glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-amber-500/10 hover:text-amber-400"
            >
              <Plus size={14} />
              إضافة استثناء
            </button>
          )}
        </div>

        {addingException && (
          <ExceptionForm
            teacherId={teacherId}
            onDone={() => {
              setAddingException(false);
              router.refresh();
            }}
            onCancel={() => setAddingException(false)}
          />
        )}

        <div className="mt-3 space-y-2">
          {exceptions.length === 0 && !addingException && (
            <p className="rounded-xl glass-card p-4 text-center text-xs text-muted">
              لا توجد استثناءات.
            </p>
          )}
          {exceptions.map((ex) => (
            <ExceptionRow
              key={ex.id}
              teacherId={teacherId}
              exception={ex}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SlotRow({
  teacherId,
  slot,
  onEdit,
  onChanged,
}: {
  teacherId: string;
  slot: Slot;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const dayLabel = DAYS.find((d) => d.value === slot.day_of_week)?.ar ?? "—";

  const handleDelete = () => {
    if (!confirm("حذف هذه الفترة؟")) return;
    startTransition(async () => {
      await deleteAvailability(teacherId, slot.id);
      onChanged();
    });
  };

  return (
    <div className="glass-card flex items-center justify-between p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-16 font-medium">{dayLabel}</span>
        <span dir="ltr" className="font-mono text-muted">
          {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}
        </span>
        <span className="text-xs text-muted">({slot.slot_duration}د)</span>
        {!slot.is_active && (
          <span className="glass-badge border-white/20 bg-white/5 text-xs text-muted">معطلة</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          aria-label="تعديل"
          className="glass-pill px-3 py-1.5 text-xs hover:bg-gold/10 hover:text-gold"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label="حذف"
          className="glass-pill px-3 py-1.5 text-xs hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function SlotForm({
  teacherId,
  initial,
  existingSlots,
  onDone,
  onCancel,
}: {
  teacherId: string;
  initial?: Slot;
  existingSlots: Slot[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const boundAction = upsertAvailability.bind(null, teacherId);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(boundAction, {});
  const [overlapWarn, setOverlapWarn] = useState<string | null>(null);

  if (state.success) onDone();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    const day = Number(fd.get("day_of_week"));
    const start = String(fd.get("start_time") ?? "");
    const end = String(fd.get("end_time") ?? "");
    const overlap = detectOverlap(existingSlots, {
      day_of_week: day,
      start_time: start,
      end_time: end,
      id: initial?.id,
    });
    setOverlapWarn(overlap);
    if (overlap) e.preventDefault();
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} className="glass-card p-4 space-y-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {state.error && (
        <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-2 text-xs text-error">
          {state.error}
        </div>
      )}
      {overlapWarn && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
          {overlapWarn}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium">اليوم</label>
          <select
            name="day_of_week"
            defaultValue={initial?.day_of_week ?? 1}
            className={input}
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.ar}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">من</label>
          <input
            name="start_time"
            type="time"
            required
            defaultValue={initial?.start_time?.slice(0, 5) ?? "09:00"}
            className={`${input} text-left`}
            dir="ltr"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">إلى</label>
          <input
            name="end_time"
            type="time"
            required
            defaultValue={initial?.end_time?.slice(0, 5) ?? "17:00"}
            className={`${input} text-left`}
            dir="ltr"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">المدة</label>
          <select name="slot_duration" defaultValue={initial?.slot_duration ?? 60} className={input}>
            <option value={30}>30 د</option>
            <option value={45}>45 د</option>
            <option value={60}>60 د</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={initial?.is_active ?? true}
          className="accent-gold"
        />
        <span>نشطة (متاحة للحجز)</span>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="glass-pill px-4 py-2 text-xs font-medium text-muted hover:text-foreground"
        >
          <X size={12} className="inline" /> إلغاء
        </button>
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          <Save size={12} />
          {initial ? "حفظ" : "إضافة"}
        </button>
      </div>
    </form>
  );
}

function ExceptionRow({
  teacherId,
  exception,
  onChanged,
}: {
  teacherId: string;
  exception: Exception;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("حذف هذا الاستثناء؟")) return;
    startTransition(async () => {
      await deleteException(teacherId, exception.id);
      onChanged();
    });
  };

  return (
    <div className="glass-card flex items-center justify-between p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span dir="ltr" className="font-mono">
          {exception.date}
        </span>
        {exception.is_blocked ? (
          <span className="glass-badge border-rose-500/30 bg-rose-500/10 text-xs text-rose-400">
            محظور
          </span>
        ) : (
          <span className="glass-badge border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-400">
            تعديل
          </span>
        )}
        {exception.start_time && exception.end_time && (
          <span dir="ltr" className="font-mono text-xs text-muted">
            {exception.start_time.slice(0, 5)} – {exception.end_time.slice(0, 5)}
          </span>
        )}
        {exception.reason && <span className="text-xs text-muted">{exception.reason}</span>}
      </div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        aria-label="حذف الاستثناء"
        className="glass-pill px-3 py-1.5 text-xs hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function ExceptionForm({
  teacherId,
  onDone,
  onCancel,
}: {
  teacherId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const boundAction = upsertException.bind(null, teacherId);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(boundAction, {});

  if (state.success) onDone();

  return (
    <form action={formAction} className="glass-card p-4 space-y-3">
      {state.error && (
        <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-2 text-xs text-error">
          {state.error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium">التاريخ *</label>
          <input
            name="date"
            type="date"
            required
            className={`${input} text-left`}
            dir="ltr"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">من (اختياري)</label>
          <input name="start_time" type="time" className={`${input} text-left`} dir="ltr" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">إلى (اختياري)</label>
          <input name="end_time" type="time" className={`${input} text-left`} dir="ltr" />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium">السبب</label>
        <input
          name="reason"
          placeholder="إجازة / ظرف طارئ / ..."
          className={input}
        />
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="is_blocked" defaultChecked className="accent-rose-500" />
        <span>يوم محظور كاملاً (لا حجوزات)</span>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="glass-pill px-4 py-2 text-xs font-medium text-muted hover:text-foreground"
        >
          <X size={12} className="inline" /> إلغاء
        </button>
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          <Save size={12} />
          إضافة
        </button>
      </div>
    </form>
  );
}
