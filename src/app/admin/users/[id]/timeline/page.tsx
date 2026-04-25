import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  BookingStatus,
  SessionType,
  HomeworkStatus,
  HomeworkType,
  EvaluationType,
  NotifType,
  AuditAction,
  PaymentStatus,
} from "@/types/database";
import { TimelineClient, type TimelineEvent } from "./timeline-client";

export const metadata: Metadata = { title: "الخط الزمني للمستخدم" };

interface Props {
  params: Promise<{ id: string }>;
}

// 90-day cutoff for most event streams
const DAYS_90_MS = 90 * 24 * 60 * 60 * 1000;

interface BookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  session_type: SessionType;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  amount_usd: number;
  created_at: string;
}

interface SessionRow {
  id: string;
  booking_id: string;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
}

interface HomeworkRow {
  id: string;
  student_id: string;
  teacher_id: string;
  homework_type: HomeworkType;
  status: HomeworkStatus;
  title: string;
  assigned_at: string;
  completed_at: string | null;
  updated_at: string;
  created_at: string;
}

interface EvaluationRow {
  id: string;
  student_id: string;
  teacher_id: string;
  evaluation_type: EvaluationType;
  overall_score: number | null;
  created_at: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotifType;
  title: string;
  body: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  changed_by: string | null;
  table_name: string;
  record_id: string;
  action: AuditAction;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}

interface PaymentRow {
  id: string;
  booking_id: string | null;
  student_id: string;
  amount_usd: number;
  status: PaymentStatus;
  paid_at: string | null;
  created_at: string;
}

export default async function UserTimelinePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // ── Admin validation ───────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!caller || caller.role !== "admin") redirect("/login");

  // ── Target user profile ────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .eq("id", id)
    .single<{
      id: string;
      full_name: string | null;
      role: string;
      created_at: string;
    }>();

  if (!profile) redirect("/admin/users");

  // ── Date cutoffs ───────────────────────────────────────────────────────────
  const cutoff90 = new Date(Date.now() - DAYS_90_MS).toISOString();

  // ── Parallel fetch of all event streams ────────────────────────────────────
  const [
    bookingsRes,
    homeworkRes,
    evalsRes,
    notifsRes,
    auditByUserRes,
    auditOnUserRes,
    paymentsRes,
  ] = await Promise.all([
    // Bookings (student OR teacher) — last 90d by created_at
    supabase
      .from("bookings")
      .select(
        "id, student_id, teacher_id, session_type, scheduled_at, duration_min, status, amount_usd, created_at",
      )
      .or(`student_id.eq.${id},teacher_id.eq.${id}`)
      .gte("created_at", cutoff90)
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<BookingRow[]>(),

    // Homework (student OR teacher) — last 90d
    supabase
      .from("homework_assignments")
      .select(
        "id, student_id, teacher_id, homework_type, status, title, assigned_at, completed_at, updated_at, created_at",
      )
      .or(`student_id.eq.${id},teacher_id.eq.${id}`)
      .gte("created_at", cutoff90)
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<HomeworkRow[]>(),

    // Evaluations (student OR teacher) — no 90d cap per spec
    supabase
      .from("session_evaluations")
      .select("id, student_id, teacher_id, evaluation_type, overall_score, created_at")
      .or(`student_id.eq.${id},teacher_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<EvaluationRow[]>(),

    // Notifications — last 90d, limit 100
    supabase
      .from("notifications")
      .select("id, user_id, type, title, body, created_at")
      .eq("user_id", id)
      .gte("created_at", cutoff90)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<NotificationRow[]>(),

    // Audit — actions performed BY this user
    supabase
      .from("audit_log")
      .select("id, changed_by, table_name, record_id, action, reason, ip_address, created_at")
      .eq("changed_by", id)
      .gte("created_at", cutoff90)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<AuditRow[]>(),

    // Audit — actions performed ON this user (record_id = id)
    supabase
      .from("audit_log")
      .select("id, changed_by, table_name, record_id, action, reason, ip_address, created_at")
      .eq("record_id", id)
      .gte("created_at", cutoff90)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<AuditRow[]>(),

    // Payments — student only (payments has no teacher_id)
    supabase
      .from("payments")
      .select("id, booking_id, student_id, amount_usd, status, paid_at, created_at")
      .eq("student_id", id)
      .gte("created_at", cutoff90)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<PaymentRow[]>(),
  ]);

  const bookings = bookingsRes.data ?? [];
  const homework = homeworkRes.data ?? [];
  const evaluations = evalsRes.data ?? [];
  const notifications = notifsRes.data ?? [];
  const auditByUser = auditByUserRes.data ?? [];
  const auditOnUser = auditOnUserRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  // ── Sessions fetched in a second pass via booking_ids ──────────────────────
  const bookingIds = bookings.map((b) => b.id);
  let sessions: SessionRow[] = [];
  if (bookingIds.length > 0) {
    const { data } = await supabase
      .from("sessions")
      .select("id, booking_id, started_at, ended_at, actual_duration")
      .in("booking_id", bookingIds)
      .returns<SessionRow[]>();
    sessions = data ?? [];
  }

  // ── Name map for counterparties ────────────────────────────────────────────
  const counterpartyIds = new Set<string>();
  for (const b of bookings) {
    counterpartyIds.add(b.student_id === id ? b.teacher_id : b.student_id);
  }
  for (const h of homework) {
    counterpartyIds.add(h.student_id === id ? h.teacher_id : h.student_id);
  }
  for (const e of evaluations) {
    counterpartyIds.add(e.student_id === id ? e.teacher_id : e.student_id);
  }
  counterpartyIds.delete(id);

  const nameMap: Record<string, string> = {};
  if (counterpartyIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...counterpartyIds])
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? "—";
    }
  }

  // ── Map each stream to TimelineEvent shape ─────────────────────────────────
  const events: TimelineEvent[] = [];

  // Bookings → "booking_created"
  for (const b of bookings) {
    const isStudent = b.student_id === id;
    const otherName = nameMap[isStudent ? b.teacher_id : b.student_id] ?? "—";
    events.push({
      id: `booking:${b.id}`,
      type: "booking_created",
      at: b.created_at,
      title_ar: "حجز جديد",
      title_en: "Booking created",
      detail: `${isStudent ? "مع المعلم" : "مع الطالب"} ${otherName} · ${b.status} · $${b.amount_usd}`,
      href: `/admin/bookings/${b.id}`,
      icon: "calendar",
      color:
        b.status === "cancelled" || b.status === "no_show"
          ? "red"
          : b.status === "completed"
            ? "green"
            : b.status === "confirmed"
              ? "blue"
              : "amber",
    });
  }

  // Sessions → one event per started_at, one per ended_at
  for (const s of sessions) {
    if (s.started_at) {
      events.push({
        id: `session-start:${s.id}`,
        type: "session_started",
        at: s.started_at,
        title_ar: "بدأت الجلسة",
        title_en: "Session started",
        detail: undefined,
        href: `/admin/sessions/${s.id}`,
        icon: "video",
        color: "blue",
      });
    }
    if (s.ended_at) {
      events.push({
        id: `session-end:${s.id}`,
        type: "session_ended",
        at: s.ended_at,
        title_ar: "انتهت الجلسة",
        title_en: "Session ended",
        detail: s.actual_duration ? `المدة الفعلية: ${s.actual_duration} د` : undefined,
        href: `/admin/sessions/${s.id}`,
        icon: "video",
        color: "green",
      });
    }
  }

  // Homework → "homework_created" + optional "homework_graded"
  for (const h of homework) {
    const isStudent = h.student_id === id;
    const otherName = nameMap[isStudent ? h.teacher_id : h.student_id] ?? "—";
    events.push({
      id: `hw-created:${h.id}`,
      type: "homework_created",
      at: h.created_at,
      title_ar: "واجب جديد",
      title_en: "Homework assigned",
      detail: `${h.title} · ${isStudent ? "من المعلم" : "للطالب"} ${otherName}`,
      href: `/admin/users/${id}`,
      icon: "book-open",
      color: "blue",
    });

    const isGraded =
      h.status === "completed_excellent" ||
      h.status === "completed_good" ||
      h.status === "completed_needs_work" ||
      h.status === "completed_not_done";

    if (isGraded && h.completed_at) {
      events.push({
        id: `hw-graded:${h.id}`,
        type: "homework_graded",
        at: h.completed_at,
        title_ar: "تم تقييم الواجب",
        title_en: "Homework graded",
        detail: `${h.title} · ${h.status}`,
        href: `/admin/users/${id}`,
        icon: "book-open",
        color:
          h.status === "completed_excellent"
            ? "green"
            : h.status === "completed_good"
              ? "blue"
              : h.status === "completed_needs_work"
                ? "amber"
                : "red",
      });
    }
  }

  // Evaluations → "evaluation_created"
  for (const e of evaluations) {
    const isStudent = e.student_id === id;
    const otherName = nameMap[isStudent ? e.teacher_id : e.student_id] ?? "—";
    events.push({
      id: `eval:${e.id}`,
      type: "evaluation_created",
      at: e.created_at,
      title_ar: "تقييم جديد",
      title_en: "Evaluation created",
      detail: `${e.evaluation_type} · ${isStudent ? "من" : "للطالب"} ${otherName}${e.overall_score != null ? ` · ${e.overall_score}/10` : ""}`,
      href: `/admin/evaluations`,
      icon: "star",
      color:
        e.overall_score == null
          ? "muted"
          : e.overall_score >= 8
            ? "green"
            : e.overall_score >= 5
              ? "amber"
              : "red",
    });
  }

  // Notifications → "notification_sent"
  for (const n of notifications) {
    events.push({
      id: `notif:${n.id}`,
      type: "notification_sent",
      at: n.created_at,
      title_ar: n.title,
      title_en: n.title,
      detail: n.body ?? undefined,
      href: undefined,
      icon: "bell",
      color: n.type === "payment" ? "gold" : n.type === "booking" ? "blue" : "muted",
    });
  }

  // Audit — merge both streams, dedupe by id. LOGIN/LOGOUT events get
  // their own type/icon/copy so they read naturally in the timeline.
  const auditMap = new Map<string, AuditRow>();
  for (const a of [...auditByUser, ...auditOnUser]) auditMap.set(a.id, a);
  for (const a of auditMap.values()) {
    if (a.action === "LOGIN" || a.action === "LOGOUT") {
      const isLogin = a.action === "LOGIN";
      const ip = a.ip_address ? ` · ${a.ip_address}` : "";
      events.push({
        id: `audit:${a.id}`,
        type: isLogin ? "auth_login" : "auth_logout",
        at: a.created_at,
        title_ar: isLogin ? "تسجيل دخول" : "تسجيل خروج",
        title_en: isLogin ? "Signed in" : "Signed out",
        detail: (a.reason ?? "") + ip,
        href: undefined,
        icon: isLogin ? "log-in" : "log-out",
        color: isLogin ? "blue" : "muted",
      });
      continue;
    }
    const actedBySelf = a.changed_by === id;
    events.push({
      id: `audit:${a.id}`,
      type: "audit",
      at: a.created_at,
      title_ar: `${a.action} على ${a.table_name}`,
      title_en: `${a.action} on ${a.table_name}`,
      detail: a.reason ?? (actedBySelf ? "نفّذها هذا المستخدم" : "تمت على هذا المستخدم"),
      href: undefined,
      icon: "shield",
      color: a.action === "DELETE" ? "red" : a.action === "UPDATE" ? "amber" : "purple",
    });
  }

  // Payments
  for (const p of payments) {
    events.push({
      id: `pay:${p.id}`,
      type: "payment",
      at: p.paid_at ?? p.created_at,
      title_ar: "دفعة مالية",
      title_en: "Payment",
      detail: `$${p.amount_usd} · ${p.status}`,
      href: `/admin/payments`,
      icon: "dollar-sign",
      color:
        p.status === "succeeded"
          ? "green"
          : p.status === "failed"
            ? "red"
            : p.status === "refunded"
              ? "purple"
              : "amber",
    });
  }

  // ── Sort all events DESC by timestamp ──────────────────────────────────────
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <TimelineClient
      userId={profile.id}
      userName={profile.full_name ?? "—"}
      userRole={profile.role}
      memberSince={profile.created_at}
      events={events}
    />
  );
}
