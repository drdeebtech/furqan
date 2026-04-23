# Communication Templates

> Canonical Arabic-first templates for all user-facing messages.
> Every n8n workflow and every `notify()` / `dispatchNotification()` call should pull from here.
> Variables in `{braces}` are substituted at send time.

---

## 1. Session Lifecycle

### T-SESS-REMIND-24H · Student · in_app + whatsapp
**AR** (primary)
> تذكير: جلستك مع الأستاذ {teacher_name} غداً الساعة {time}. استعد بمراجعة {last_topic}.

**EN**
> Reminder: your session with {teacher_name} is tomorrow at {time}. Prep by reviewing {last_topic}.

### T-SESS-REMIND-1H · Student
**AR**
> جلستك تبدأ بعد ساعة مع الأستاذ {teacher_name}. اضغط هنا للدخول: {room_url}

### T-SESS-REMIND-15M · Student + Teacher
**AR**
> الجلسة تبدأ خلال 15 دقيقة. الرابط جاهز: {room_url}

### T-SESS-ENDED · Student
**AR**
> تمت الجلسة بنجاح. لمراجعة الملاحظات والواجبات، افتح لوحة التحكم.

### T-SESS-NO-SHOW-STUDENT · Parent
**AR** (urgent)
> لم يحضر {student_name} جلسة اليوم مع الأستاذ {teacher_name}. هل كل شيء على ما يرام؟

### T-SESS-NO-SHOW-TEACHER · Student + Parent
**AR** (urgent)
> نعتذر، لم يتمكن الأستاذ من حضور جلسة اليوم. سنقوم بإعادة جدولتها فوراً دون خصم من باقتك.

---

## 2. Homework

### T-HW-ASSIGNED · Student + Parent
**AR**
> تم إعطاء واجب جديد: {homework_title}. التسليم قبل {due_at}.

### T-HW-DUE-SOON · Student
**AR**
> تذكير: الواجب {homework_title} مطلوب تسليمه خلال {hours_left} ساعة.

### T-HW-GRADED · Student + Parent
**AR**
> تم تصحيح الواجب {homework_title}. التقدير: {grade}. ملاحظات الأستاذ: {feedback}.

---

## 3. Package / Payments

### T-PKG-LOW-BALANCE · Student + Parent
**AR**
> تبقى {remaining} جلسات فقط في باقتك. جدّد الآن لتجنب انقطاع الدراسة: {renewal_url}

### T-PKG-EXPIRY-WARN · Student + Parent
**AR**
> تنتهي صلاحية باقتك خلال {days_left} أيام ({expires_at}). جدّد الآن لتحافظ على تقدمك.

### T-PKG-EXPIRED · Student + Parent
**AR**
> انتهت باقتك. نأمل استمرارك معنا — جدد الآن بخصم خاص: {offer_url}

### T-PAY-SUCCESS · Student + Parent
**AR**
> تم استلام الدفع بنجاح. باقتك الجديدة: {package_name} — {sessions_total} جلسات. بدايتك موفقة.

### T-PAY-FAILED · Student
**AR** (urgent)
> تعذر إتمام الدفع لباقة {package_name}. حاول مرة أخرى أو اختر وسيلة دفع مختلفة: {retry_url}

---

## 4. Parent Reports

### T-PARENT-POST-SESSION · Parent
**AR** (AI-filled when enabled, template otherwise)
> عزيزي ولي الأمر،
> اليوم حضر {student_name} جلسة مع الأستاذ {teacher_name} لمدة {duration} دقيقة.
> {ai_summary | fallback: "تمت دراسة {topic}. مستوى الحضور والتفاعل: {engagement}. الواجب التالي: {homework}."}
> شكراً لثقتكم.

### T-PARENT-WEEKLY-DIGEST · Parent
**AR**
> تقرير الأسبوع لـ {student_name}:
> • جلسات مكتملة: {completed_count}/{scheduled_count}
> • واجبات مُسلَّمة: {hw_submitted}/{hw_assigned}
> • التقدم في الحفظ: {progress_summary}
> • ملاحظة الأستاذ: {teacher_note}

### T-PARENT-FIRST-SESSION-REASSURANCE · Parent
**AR**
> مرحباً بكم في فرقان! أكمل {student_name} أول جلسة بنجاح. سنُطلعكم على تقدمه أسبوعياً.

---

## 5. Teacher Operations

### T-TCH-CV-APPROVED · Teacher
**AR**
> تمت الموافقة على سيرتك الذاتية. يمكنك الآن استقبال الطلاب.

### T-TCH-CV-REJECTED · Teacher
**AR**
> للأسف تم رفض سيرتك الذاتية. السبب: {reason}. يمكنك تعديلها وإعادة التقديم.

### T-TCH-GRADING-OVERDUE · Teacher
**AR**
> لديك {count} واجبات بانتظار التصحيح منذ أكثر من 48 ساعة. افتح لوحة المعلم.

### T-TCH-EVAL-OVERDUE · Teacher
**AR**
> تقييمات {count} جلسة لم تُكتب بعد. التقييم يساعد الطلاب وأولياء الأمور.

### T-TCH-LOW-AVAILABILITY · Teacher
**AR**
> ساعات توفرك خلال الأسبوع القادم أقل من {threshold}. حدّث جدولك لاستقبال المزيد من الطلاب.

---

## 6. Admin / Alerts (Telegram)

### T-ADMIN-WORKFLOW-FAILURE
> ⚠️ n8n workflow `{workflow_name}` failed: `{error}`
> Last success: {last_ok_at} · Attempts: {attempts}

### T-ADMIN-NO-SHOW-SPIKE
> 🚨 no-show rate {rate}% in last hour ({count} sessions) — above {threshold}%

### T-ADMIN-PAY-FAILURE
> 💳 payment failed for student {student_id}, package {package_name}

### T-ADMIN-DAILY-DIGEST
> 📊 FURQAN daily:
> · new signups: {signups}
> · pending CVs: {pending_cvs}
> · sessions today: {sessions}
> · at-risk students (churn≥60): {at_risk}
> · failed workflows: {failed_wfs}

---

## 7. Retention

### T-RETAIN-INACTIVITY-14D · Student + Parent
**AR**
> اشتقنا لك! لم نر {student_name} منذ {days} يوماً. احجز جلسة لتكمل ما بدأته: {booking_url}

### T-RETAIN-WINBACK · Student + Parent
**AR**
> نود رؤيتك مرة أخرى. خصم خاص {discount}% على باقتك التالية: {offer_url}

---

## Authoring Rules

1. **Arabic is canonical.** English is optional for bilingual users.
2. **Every template has an ID (`T-<AREA>-<VERB>`)** — log the ID in `message_delivery_log.template_name`.
3. **Variables must always be substituted** — never send a message with an unresolved `{var}`. Validator in n8n pre-send step.
4. **Tone**: warm, academy-professional, never guilt-trip.
5. **Urgent flag** (dispatcher): only use for truly time-critical messages (no-show, payment failed) — bypasses quiet hours.
6. **Channel suitability**:
   - in_app: every category
   - whatsapp: parent reports, urgent alerts, reminders
   - email: receipts, weekly digests, long-form
   - telegram: admin-only alerts
