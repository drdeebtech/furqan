// Spec 040 FR-028 — the Teacher Agreement CONTENT registry.
//
// ⚠ The agreement text is LEGAL work, not engineering (plan Phase 2 item 1):
// this file renders whatever the owner's professional supplies; engineering
// pins only the version string. Until the reviewed text lands,
// AGREEMENT_TEXT_IS_PLACEHOLDER stays true and the accept button is DISABLED
// — the platform must never record consent to placeholder text.
//
// Go-live steps for the owner (also in the spec's Phase 6 checklist):
//   1. Replace bodyAr/bodyEn with the professionally reviewed text.
//   2. Set AGREEMENT_TEXT_IS_PLACEHOLDER = false.
//   3. Ensure `teacher_agreement_current_version` (platform_settings) equals
//      AGREEMENT_VERSION below — the acceptance RPC records the DB value and
//      refuses when the rendered version mismatches it (attestation).

/** Must match platform_settings.teacher_agreement_current_version. */
export const AGREEMENT_VERSION = "1";

/** Accept stays disabled while true — never collect consent to a draft. */
export const AGREEMENT_TEXT_IS_PLACEHOLDER = true;

export const AGREEMENT_BODY_AR = `【مسودة — النص النهائي قيد المراجعة القانونية】

اتفاقية المعلّم — منصة الفرقان (النسخة ${AGREEMENT_VERSION})

تنظّم هذه الاتفاقية العلاقة بين المعلّم والمنصة فيما يخص:
• استحقاق الأرباح عن الجلسات المكتملة والمؤكّدة الحضور.
• فترة تجميد قدرها ١٤ يومًا من تاريخ الجلسة قبل التحويل، المشتقّة من نافذة استرداد الطلاب (٧ أيام).
• خصم المبالغ المستردَّة أو المتنازَع عليها من الأرباح المستقبلية تلقائيًا.
• طريقة الدفع عبر Stripe أو عبر التسوية اليدوية من إدارة المنصة.

لا يُعتمد هذا النص — الصيغة النهائية تصدر بعد المراجعة القانونية.`;

export const AGREEMENT_BODY_EN = `[DRAFT — final text pending legal review]

Teacher Agreement — Furqan Platform (version ${AGREEMENT_VERSION})

This agreement governs the relationship between the teacher and the platform regarding:
• Earnings accrual for completed, attendance-confirmed sessions.
• A 14-day hold from the session date before transfer, derived from the students' 7-day refund window.
• Automatic offsetting of refunded or disputed amounts against future earnings.
• Settlement via Stripe or via the academy's manual rail.

This text is not final — the binding wording follows legal review.`;
