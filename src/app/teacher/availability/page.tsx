import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "المواعيد" };
import { Calendar, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SlotForm } from "./slot-form";
import { DeleteSlotButton } from "./delete-slot-button";

const DAY_AR: Record<number, string> = {
  0: "الأحد",
  1: "الإثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
};

const DAY_EN: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

interface SlotRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration: number;
  is_active: boolean;
}

export default async function TeacherAvailabilityPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: slots } = await supabase
    .from("teacher_availability")
    .select("id, day_of_week, start_time, end_time, slot_duration, is_active")
    .eq("teacher_id", user.id)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<SlotRow[]>();

  const list = slots ?? [];

  // Group by day
  const grouped = list.reduce<Record<number, SlotRow[]>>((acc, slot) => {
    (acc[slot.day_of_week] ??= []).push(slot);
    return acc;
  }, {});

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">
        <Calendar size={24} className="ml-2 inline text-gold" />
        إدارة المواعيد
      </h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: Current slots */}
        <div>
          <h2 className="mb-4 text-lg font-semibold">
            المواعيد الحالية
            <span className="mr-2 text-sm font-normal text-muted">
              Current slots
            </span>
          </h2>

          {list.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card elevation-2 p-8 text-center">
              <Inbox size={32} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">لا توجد مواعيد بعد</p>
              <p className="mt-1 text-xs text-muted">
                أضف مواعيد إتاحتك حتى يتمكن الطلاب من حجز جلسات معك
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([day, daySlots]) => (
                  <div key={day}>
                    <h3 className="mb-2 text-sm font-medium text-gold">
                      {DAY_AR[Number(day)]}
                      <span className="mr-1 text-xs text-muted">
                        {DAY_EN[Number(day)]}
                      </span>
                    </h3>
                    <div className="space-y-2">
                      {daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          className="flex items-center justify-between rounded-lg border border-card-border bg-card px-4 py-3"
                        >
                          <div dir="ltr" className="text-left text-sm">
                            <span className="font-medium text-foreground">
                              {slot.start_time.slice(0, 5)}
                            </span>
                            <span className="mx-2 text-muted">→</span>
                            <span className="font-medium text-foreground">
                              {slot.end_time.slice(0, 5)}
                            </span>
                            <span className="mr-3 text-xs text-muted">
                              {slot.slot_duration} دقيقة
                            </span>
                          </div>
                          <DeleteSlotButton slotId={slot.id} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Right: Add form */}
        <SlotForm />
      </div>
    </div>
  );
}
