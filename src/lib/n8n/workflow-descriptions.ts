// Bilingual purpose descriptions for every planned n8n workflow.
// Source of truth: automation/BLUEPRINT.md (Areas 1–12, ~52 workflows).
// Surface in: src/app/admin/n8n/components/overview-tab.tsx

export type WorkflowArea =
  | "session_lifecycle"
  | "parent_communication"
  | "retention"
  | "revenue"
  | "teacher_onboarding"
  | "teacher_quality"
  | "booking_intelligence"
  | "messaging"
  | "admin_operations"
  | "payments"
  | "platform_health"
  | "ai_intelligence";

export interface WorkflowMeta {
  ar: string;
  en: string;
  area: WorkflowArea;
}

export const WORKFLOW_AREAS: Record<WorkflowArea, { ar: string; en: string }> = {
  session_lifecycle: { ar: "دورة حياة الجلسة", en: "Session Lifecycle" },
  parent_communication: { ar: "تواصل أولياء الأمور", en: "Parent Communication" },
  retention: { ar: "الاحتفاظ بالطلاب", en: "Student Retention" },
  revenue: { ar: "الإيرادات والباقات", en: "Revenue & Packages" },
  teacher_onboarding: { ar: "تأهيل المعلمين", en: "Teacher Onboarding" },
  teacher_quality: { ar: "جودة المعلمين", en: "Teacher Quality" },
  booking_intelligence: { ar: "ذكاء الحجوزات", en: "Booking Intelligence" },
  messaging: { ar: "الرسائل والإشراف", en: "Messaging & Moderation" },
  admin_operations: { ar: "عمليات الإدارة", en: "Admin Operations" },
  payments: { ar: "المدفوعات والفواتير", en: "Payments & Billing" },
  platform_health: { ar: "صحة المنصة", en: "Platform Health" },
  ai_intelligence: { ar: "الذكاء الأكاديمي", en: "AI Academic" },
};

// Keys are normalized (see normalize() below): lowercase, alphanumerics + single
// hyphens, no `furqan-` prefix. The lookup tries exact match first, then a
// substring/contains pass so name variants ("v2", date suffixes, etc.) still hit.
const META: Record<string, WorkflowMeta> = {
  // Area 01 — Session Lifecycle
  "session-reminder-engine": {
    ar: "يرسل تذكيرات قبل الجلسة بـ 24 ساعة، ساعة، 15 دقيقة عبر البريد وواتساب وداخل التطبيق.",
    en: "Sends 24h / 1h / 15m reminders to students and teachers across email, WhatsApp, and in-app.",
    area: "session_lifecycle",
  },
  "room-creation": {
    ar: "ينشئ غرفة Daily.co فور تأكيد الحجز ويُحدّث رابط الجلسة ويُخطر الطرفين.",
    en: "Creates a Daily.co room on booking confirmation, updates session URL, and notifies both parties.",
    area: "session_lifecycle",
  },
  "auto-decline": {
    ar: "يلغي الحجوزات المعلّقة التي لم يؤكدها المعلّم بعد المهلة المحددة.",
    en: "Cancels stale pending bookings the teacher hasn't confirmed within the threshold.",
    area: "session_lifecycle",
  },
  "auto-complete": {
    ar: "يُغلق الجلسات تلقائياً بعد تجاوز مدتها المتوقعة ويحسب المدة الفعلية.",
    en: "Auto-closes sessions that exceed expected end time and computes actual duration.",
    area: "session_lifecycle",
  },
  "no-show": {
    ar: "يكتشف غياب الطالب أو المعلّم بعد فترة السماح ويُحدّث الحالة ويُخطر المعنيين.",
    en: "Detects student or teacher no-shows after grace period, updates status, alerts stakeholders.",
    area: "session_lifecycle",
  },
  "late-join-rescue": {
    ar: "ينبّه الطرف المتأخر بعد بدء الجلسة، ويصعّد الإنذار للإدارة عند استمرار الغياب.",
    en: "Nudges the missing participant after session start; escalates to admin if unresolved.",
    area: "session_lifecycle",
  },
  "recording-handler": {
    ar: "يستقبل رابط التسجيل من Daily ويحفظه على الجلسة ويُخطر ولي الأمر أو الإدارة.",
    en: "Receives Daily recording URL, stores it on the session, notifies parent or admin.",
    area: "session_lifecycle",
  },
  "session-health-check": {
    ar: "فحص دوري لصحة دورة حياة الجلسات والكشف عن الحالات الشاذة.",
    en: "Periodic health check across the session lifecycle to surface anomalies.",
    area: "session_lifecycle",
  },
  "failure-sentinel": {
    ar: "يجمع تنفيذات n8n الفاشلة ويرسل تنبيه تيليجرام للإدارة مع السياق.",
    en: "Aggregates failed n8n executions and sends a Telegram admin alert with context.",
    area: "platform_health",
  },

  // Area 02 — Parent Communication
  "post-session-report": {
    ar: "تقرير AI لأولياء الأمور بعد كل جلسة يلخص المتابعة والتقييم والتوصيات.",
    en: "AI parent report after each session summarising follow-up, evaluation, and next steps.",
    area: "parent_communication",
  },
  "fallback-parent-report": {
    ar: "تقرير أولياء أمور قالبي عند تعذّر استخدام الذكاء الاصطناعي.",
    en: "Templated parent report used when the AI provider is unavailable.",
    area: "parent_communication",
  },
  "weekly-digest": {
    ar: "خلاصة أسبوعية لأولياء الأمور تجمع الجلسات والتقدم والمتابعات والتقييمات.",
    en: "Weekly parent digest aggregating sessions, progress, follow-ups, and evaluations.",
    area: "parent_communication",
  },
  "monthly-master-report": {
    ar: "تقرير شهري شامل بصياغة ذكية مع رسوم بيانية يُرسل بريدياً لولي الأمر.",
    en: "Monthly AI-narrated master report with charts, emailed to the parent.",
    area: "parent_communication",
  },
  "missed-session-alert": {
    ar: "تنبيه فوري لولي الأمر عند فوات جلسة مع توجيه للخطوة التالية.",
    en: "Immediate parent alert on missed session with next-step guidance.",
    area: "parent_communication",
  },
  "homework-alert": {
    ar: "تنبيه ولي الأمر عند تقصير الطالب في المتابعة بأسلوب محفّز.",
    en: "Encouraging parent alert when a student under-performs on a follow-up.",
    area: "parent_communication",
  },
  "homework-graded": {
    ar: "ينفّذ بعد تقييم الواجب: يُخطر الطالب وولي الأمر بنتيجة المراجعة.",
    en: "Runs after homework grading: notifies student and parent of the review outcome.",
    area: "parent_communication",
  },
  milestones: {
    ar: "رسائل تهنئة عند بلوغ المعالم: ختم جزء، عدد جلسات، استمرارية.",
    en: "Celebration messages on milestones: juz completion, session counts, streaks.",
    area: "parent_communication",
  },

  // Area 03 — Retention
  "at-risk": {
    ar: "يكشف الطلاب المعرّضين للتسرّب من خلال الحضور والإلغاءات والخمول، ويُنشئ علامة خطر.",
    en: "Flags at-risk students using attendance, cancellations, inactivity, and stalled homework.",
    area: "retention",
  },
  inactivity: {
    ar: "حملة استرجاع للطلاب الخاملين عبر رسائل شخصية متدرجة.",
    en: "Re-engagement campaign for inactive students with personalized win-back messages.",
    area: "retention",
  },
  "low-balance": {
    ar: "تنبيه عند انخفاض رصيد الجلسات في الباقة لتشجيع التجديد.",
    en: "Alert when remaining package sessions fall below threshold to nudge renewal.",
    area: "retention",
  },
  "expiry-countdown": {
    ar: "تذكيرات قبل انتهاء الباقة بـ 7 و 3 ويوم مع روابط التجديد.",
    en: "7-day / 3-day / 1-day reminders before package expiry with renewal links.",
    area: "retention",
  },
  streak: {
    ar: "تشجيع الطلاب على سلسلة الحضور المتواصل وإخطار ولي الأمر اختيارياً.",
    en: "Encourages students on consecutive-session streaks and optionally notifies parents.",
    area: "retention",
  },
  "trial-to-paid": {
    ar: "رحلة تحويل الطالب التجريبي إلى مشترك مدفوع عبر رسائل تثقيفية.",
    en: "Trial-to-paid conversion journey with educational and trust-building messages.",
    area: "retention",
  },

  // Area 04 — Revenue
  "abandoned-booking": {
    ar: "استرجاع الحجوزات المعلّقة قبل اكتمالها بسلسلة تذكيرات وعرض دعم.",
    en: "Recovers bookings that stalled before confirmation with reminders and a support CTA.",
    area: "revenue",
  },
  "abandoned-checkout": {
    ar: "استرجاع عمليات الدفع التي بدأت ولم تكتمل (يفعّل بعد تشغيل Stripe).",
    en: "Recovers Stripe checkouts that started but never completed (activates with Stripe).",
    area: "revenue",
  },
  renewal: {
    ar: "حملة تجديد الباقة عند اقتراب الانتهاء أو انخفاض الرصيد.",
    en: "Package renewal campaign when balance is low or expiry is near.",
    area: "revenue",
  },
  upsell: {
    ar: "اقتراح ترقية لباقة أعلى للطلاب ذوي الانتظام والتقييم العالي.",
    en: "Upsell to a higher package for students with strong attendance and satisfaction.",
    area: "revenue",
  },
  "lapsed-return": {
    ar: "عرض استرجاع للطلاب المنقطعين بعد انتهاء باقتهم بمدة محددة.",
    en: "Win-back offer for lapsed students after their package expired and went unrenewed.",
    area: "revenue",
  },
  "payment-failure": {
    ar: "إشعار الطالب أو ولي الأمر عند فشل الدفع مع رابط إعادة المحاولة.",
    en: "Notifies student/parent on payment failure with a retry link; escalates on repeats.",
    area: "revenue",
  },

  // Area 05 — Teacher Onboarding
  welcome: {
    ar: "سلسلة ترحيب تتفرّع حسب الدور (طالب/معلّم/ولي أمر) بعد إنشاء الحساب.",
    en: "Role-branched welcome sequence triggered when a profile is created.",
    area: "teacher_onboarding",
  },
  "onboarding-nudges": {
    ar: "تذكير المعلّم بإكمال خطوات التأهيل: السيرة الذاتية، الإتاحة، الملف الشخصي.",
    en: "Reminds teachers to finish onboarding steps: CV, availability, profile.",
    area: "teacher_onboarding",
  },
  "cv-approval": {
    ar: "حلقة إشعارات قبول/رفض السيرة الذاتية بين الإدارة والمعلّم.",
    en: "CV approval notification loop between admin review and teacher outcome.",
    area: "teacher_onboarding",
  },
  "first-student": {
    ar: "رسالة تهنئة وإرشادات أفضل الممارسات عند إكمال المعلّم لأول حجز.",
    en: "Celebration + best-practice tips when a teacher completes their first booking.",
    area: "teacher_onboarding",
  },

  // Area 06 — Teacher Quality
  "quality-monitor": {
    ar: "يجمع غياب المعلّم والتأخير والتقييمات الضعيفة ويحسب درجة المخاطرة.",
    en: "Aggregates teacher no-shows, late starts, poor reviews to compute a risk score.",
    area: "teacher_quality",
  },
  "weekly-snapshot": {
    ar: "موجز أسبوعي للأداء يُرسل لكل معلّم ومقارنة شاملة للإدارة.",
    en: "Weekly per-teacher performance summary plus comparative overview for admin.",
    area: "teacher_quality",
  },
  "top-teacher": {
    ar: "تحديد المعلّمين المتميزين أسبوعياً أو شهرياً للتقدير الداخلي.",
    en: "Identifies standout teachers weekly/monthly for recognition or internal rewards.",
    area: "teacher_quality",
  },
  "eval-compliance": {
    ar: "تذكير المعلّم بإرسال التقييم بعد كل 4 جلسات والتصعيد عند التأخر.",
    en: "Reminds teacher to submit evaluation every 4 sessions; escalates if overdue.",
    area: "teacher_quality",
  },
  "coaching-insight": {
    ar: "ذكاء اصطناعي يلخّص أنماط مشاكل الطلاب ويقترح تحسينات تدريسية للمعلّم.",
    en: "AI summarises recurring student issues and suggests coaching improvements.",
    area: "teacher_quality",
  },

  // Area 07 — Booking Intelligence
  "conflict-detector": {
    ar: "يكشف تعارض حجز جديد مع إتاحة المعلّم ويقترح بدائل مناسبة.",
    en: "Detects overlapping bookings against teacher availability and suggests alternatives.",
    area: "booking_intelligence",
  },
  "recurring-booking": {
    ar: "ينشئ الدفعة الأسبوعية للجلسات المتكررة من القوالب المحددة.",
    en: "Generates the next batch of recurring sessions from saved patterns.",
    area: "booking_intelligence",
  },
  "calendar-sync": {
    ar: "مزامنة جدول المعلّم مع Google Calendar عند تفعيل الميزة.",
    en: "Syncs teacher Google Calendar on booking create / update / delete.",
    area: "booking_intelligence",
  },
  "matching-advisor": {
    ar: "ذكاء اصطناعي يطابق الطالب بأنسب معلّم حسب اللغة والجنس والمستوى والتوقيت.",
    en: "AI matches new students to suitable teachers by language, gender, level, timezone.",
    area: "booking_intelligence",
  },
  "waitlist-fill": {
    ar: "عند إلغاء جلسة في وقت مميّز، ينبّه طلاباً مناسبين لملء الفراغ.",
    en: "When a premium slot opens via cancellation, alerts suitable students to fill it.",
    area: "booking_intelligence",
  },

  // Area 08 — Messaging
  moderation: {
    ar: "يفحص الرسائل بكلمات مفتاحية وتصنيف ذكي ويُبلّغ الإشراف عند الاشتباه.",
    en: "Keyword + AI-classification message scan; flags moderators on suspicious content.",
    area: "messaging",
  },
  "announcement-broadcaster": {
    ar: "بث الإعلانات للقنوات المناسبة: داخل التطبيق، البريد، واتساب، تيليجرام.",
    en: "Broadcasts announcements to in-app, email, WhatsApp, and Telegram as configured.",
    area: "messaging",
  },
  "telegram-admin-bot": {
    ar: "بوت تيليجرام إداري يدعم /stats, /pending, /sessions, /broadcast, /health.",
    en: "Admin Telegram bot supporting /stats, /pending, /sessions, /broadcast, /health.",
    area: "messaging",
  },
  "whatsapp-parent-assistant": {
    ar: "مساعد واتساب لأولياء الأمور للقراءة فقط: تقدّم الطفل والحجوزات.",
    en: "Read-only WhatsApp assistant for parents: student progress + booking lookups.",
    area: "messaging",
  },

  // Area 09 — Admin Operations
  "daily-digest": {
    ar: "خلاصة إدارية يومية صباحية: مقاييس وأخطاء وحجوزات وإيرادات وغياب.",
    en: "Morning admin digest: yesterday's metrics, failures, signups, bookings, revenue, no-shows.",
    area: "admin_operations",
  },
  "kpi-alerting": {
    ar: "تنبيهات لحظية لتجاوز عتبات المؤشرات: ارتفاع الغياب، فشل API، تراكم الرسائل.",
    en: "Real-time KPI breach alerts: no-show spikes, API failures, message backlog.",
    area: "admin_operations",
  },
  "audit-enrichment": {
    ar: "إثراء سجل التدقيق بسياق IP وموقع تقريبي ودرجة خطورة.",
    en: "Enriches audit log entries with IP context, geo hint, and severity score.",
    area: "admin_operations",
  },
  "moderator-queue": {
    ar: "بناء قائمة مراجعة المشرف: السير، الرسائل المعلّمة، المعلمون عالي المخاطر.",
    en: "Builds moderator review queue: CVs, flagged messages, risky teachers, anomalies.",
    area: "admin_operations",
  },

  // Area 10 — Payments
  "stripe-webhook": {
    ar: "يستقبل أحداث Stripe ويُحدّث المدفوعات والباقات ويُخطر المستخدم.",
    en: "Parses Stripe events, updates payments and student packages, notifies the user.",
    area: "payments",
  },
  "invoice-generator": {
    ar: "ينشئ فاتورة PDF أو رابط فاتورة مستضاف عند نجاح الدفع أو دفعة شهرية.",
    en: "Generates a PDF or hosted invoice link on payment success or monthly batch.",
    area: "payments",
  },
  "teacher-payout": {
    ar: "حساب أرباح المعلّمين كل أسبوعين من الجلسات المكتملة وتجهيزها للاعتماد.",
    en: "Computes teacher earnings biweekly from completed sessions for admin approval.",
    area: "payments",
  },
  refund: {
    ar: "مساعد سير عمل الاسترداد: يطبّق السياسة ويحسب المبلغ ويُحدّث السجلات.",
    en: "Refund workflow helper: applies policy, computes amount, updates records.",
    area: "payments",
  },
  "failed-renewal": {
    ar: "تصعيد فشل التجديد التلقائي إلى متابعة الإدارة وإشعار ولي الأمر.",
    en: "Escalates auto-renewal failures to admin follow-up and parent contact.",
    area: "payments",
  },

  // Area 11 — Platform Health
  "health-check": {
    ar: "فحص دوري كل 5 دقائق للتطبيق وSupabase وDaily وn8n مع تنبيه عند العطل.",
    en: "Pings app + Supabase + Daily + n8n every 5min; alerts on outage or latency spikes.",
    area: "platform_health",
  },
  "old-data-cleanup": {
    ar: "أرشفة سجلات التدقيق القديمة والبيانات الباردة أسبوعياً.",
    en: "Weekly archival of aged audit logs, stale artifacts, and cold data.",
    area: "platform_health",
  },
  "broken-link-check": {
    ar: "فحص أسبوعي لروابط التسجيلات والفواتير والوسائط المخزّنة.",
    en: "Weekly check of stored URLs (recordings, invoices, media references).",
    area: "platform_health",
  },
  "credential-watcher": {
    ar: "مراقبة صلاحية رموز التكامل وإعدادات الخدمات الحرجة يومياً.",
    en: "Daily check of token validity windows and critical-integration sanity.",
    area: "platform_health",
  },

  // Retention scoring (separate from at-risk detector — computes churn probability scores)
  "retention-scorer": {
    ar: "يحسب درجة خطر الانقطاع لكل طالب بناءً على الحضور والنشاط وإشارات الاحتفاظ.",
    en: "Scores churn-risk probability for each student based on attendance, activity, and retention signals.",
    area: "retention",
  },

  // Area 12 — AI Academic
  "monthly-progress-ai": {
    ar: "تقرير تقدّم شهري بصياغة ذكاء اصطناعي يدمج كل الإشارات الأكاديمية للطالب.",
    en: "Monthly AI-narrated progress report synthesising all academic signals.",
    area: "ai_intelligence",
  },
  "curriculum-advisor": {
    ar: "تحليل أسبوعي بالذكاء الاصطناعي لأخطاء التلاوة واقتراح محاور تركيز للمعلّم.",
    en: "Weekly AI analysis of recitation errors; suggests next focus areas for the teacher.",
    area: "ai_intelligence",
  },
  "weakness-detector": {
    ar: "كشف أنماط الضعف المتكررة في الأحكام والحفظ وتخزينها للوحة المعلّم.",
    en: "Detects recurring tajweed/memorisation weakness patterns for the teacher dashboard.",
    area: "ai_intelligence",
  },
  "risk-classifier": {
    ar: "تصنيف يومي للمخاطر الأكاديمية من الحضور والأخطاء والركود والمتابعات.",
    en: "Daily academic-risk classification from attendance, errors, stagnation, follow-ups.",
    area: "ai_intelligence",
  },
};

// Maps actual n8n workflow names (normalized, no furqan- prefix) to blueprint META keys.
// Added when n8n workflow names diverged from the original blueprint short-keys.
const ALIASES: Record<string, string> = {
  "daily-admin-digest": "daily-digest",
  "missed-session-parent-alert": "missed-session-alert",
  "weekly-progress-digest": "weekly-digest",
  "milestone-celebrations": "milestones",
  "low-package-balance-alert": "low-balance",
  "homework-noncompletion-parent-alert": "homework-alert",
  "audit-log-enrichment": "audit-enrichment",
  "weekly-teacher-performance": "weekly-snapshot",
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^furqan[-_\s]+/, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getWorkflowMeta(name: string): WorkflowMeta | null {
  const norm = normalize(name);
  if (!norm) return null;

  // Direct match against blueprint keys.
  if (META[norm]) return META[norm];

  // Alias map: real n8n names → blueprint keys.
  const aliasKey = ALIASES[norm];
  if (aliasKey && META[aliasKey]) return META[aliasKey];

  // Substring fallback: pick the longest key contained in the normalized name
  // (or vice versa). Longer matches are more specific.
  let best: { key: string; meta: WorkflowMeta } | null = null;
  for (const [key, meta] of Object.entries(META)) {
    if (norm.includes(key) || key.includes(norm)) {
      if (!best || key.length > best.key.length) best = { key, meta };
    }
  }
  return best?.meta ?? null;
}
