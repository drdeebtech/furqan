# FURQAN Academy — Full Platform Audit Report

> Comprehensive audit covering: product, architecture, database, UX, operations, automation, payments, security, and roadmap.
> Date: 2026-04-10

---

## Executive Assessment

FURQAN is a serious production education platform with strong domain fit, coherent product model, mature schema (30 tables), real educational workflow depth, and high automation potential.

**Grade Summary:**

| Area | Grade | Notes |
|------|-------|-------|
| Product Architecture | A- | Coherent, domain-specific, 4-role model |
| Data Model | A- | 30 tables, enums, RLS, SQL functions, migrations through V12 |
| UX Direction | B+ | Arabic-first RTL, Liquid Glass design, good discovery/progress |
| Operational Readiness | B | Admin role (formerly Moderator, dropped per ADR-0003), audit log, edge functions, but logic sprawl risk |
| Automation Maturity | B- | Good plan (52 workflows), infrastructure built, governance not yet mature |
| Revenue/Payment Readiness | C+ | Package model solid, but Stripe purchase flow still deferred |
| Scale Readiness | B- | Good for small-mid, needs domain ownership and lifecycle docs |

**Strategic Recommendation:** The next phase should be **platform hardening and operating leverage**, not feature expansion.

---

## 1. Product Strategy

### Strengths
- Product coherence: follow-up, evaluations, progress, parent reports, packages all reinforce the same educational loop
- 4-role model (student/teacher/admin) shows operational maturity
- Follow-up creates academic continuity; packages create monetization structure
- CV review workflow demonstrates governance thinking

### Gaps
- Feature breadth growing faster than platform hardening
- Core commercial loop (payment) not yet closed
- Too many "almost-enterprise" surfaces before transactional completion is done

### Priority Outcomes (next cycle)
1. **Frictionless conversion:** public page → trial → paid package with zero friction
2. **Reliable learning loop:** booking → session → follow-up → evaluation → next booking as one continuous system
3. **Parent confidence:** parents should never feel uninformed
4. **Scalable operations:** admins spend less time chasing status, more time improving quality

---

## 2. Architecture

### Strengths
- Modern, appropriate stack (Next.js 16 App Router, React 19, TypeScript strict, Supabase with RLS)
- Good separation: server/browser/admin Supabase clients
- Consistent patterns: server actions, revalidatePath(), non-blocking notifications
- Migration-driven schema evolution (V9 → V12)

### Critical Risk: Business Logic Sprawl
Logic currently exists in 5 places:
1. Page-level server actions
2. `lib/actions/*` utilities
3. Supabase SQL functions
4. Edge functions (4)
5. n8n workflows (planned 52)

**Danger:** When logic spreads across layers, debugging "why did this student get this status/notification/report" becomes hard.

### Recommendation: Domain Ownership Model

| Domain | Owns | Source of Truth |
|--------|------|----------------|
| **Booking** | Creation, status transitions, conflicts, cancellation | `bookings` table + server actions |
| **Session** | Room creation, lifecycle, attendance, completion/no-show | `sessions` table + Daily.co |
| **Follow-up** | Assignment lifecycle, readiness, grading, regeneration | `homework_assignments` + actions |
| **Progress/Evaluation** | Academic performance records, reporting triggers | `student_progress` + `session_evaluations` |
| **Package/Payments** | Commercial entitlements, sessions remaining, expiry, payment | `packages` + `student_packages` + Stripe |
| **Communication** | Templates, channel routing, preferences, delivery tracking | `notifications` + `parent_reports` |
| **Automation** | Async workflows, logging, retries, alerts, orchestration | `automation_logs` + n8n |

---

## 3. Database & Schema

### Strengths
- 30-table model covers actual business processes, not just storage
- Enums reduce ambiguity in status-heavy workflows
- `deduct_package_session(uuid)` handles race-condition-prone commercial action atomically
- Migration versioning (V9 through V12) shows engineering discipline

### Missing Support Tables

| Table | Purpose | Priority |
|-------|---------|----------|
| `message_delivery_log` | Track what was sent, which channel, delivery status | P1 |
| `communication_preferences` | User/parent channel preferences, language, quiet hours | P1 |
| `retention_signals` | Churn risk scoring, last activity timestamps, intervention tracking | P2 |
| `session_presence_events` | Granular join/leave tracking for no-show/lateness logic | P2 |
| `automation_dead_letter` | Failed important tasks that should not disappear | P2 |

### Schema Risk
- TypeScript workarounds (`as never`, `.returns<Type[]>()`) are practical but create silent developer friction
- RLS policies were audited, but need continuous regression testing as tables/roles grow
- 30 tables + multiple roles = policy drift risk

---

## 4. UX & User Journeys

### Strengths
- Arabic-first RTL is strategic, not decorative
- Student progress visualization (Juz tracker, eval chart, milestones) makes learning tangible
- Teacher discovery (search, specialty/gender filters, sort) makes marketplace usable
- PWA support for mobile access

### Risk: Dashboard Density
77 route pages + many widgets = risk of feature-rich pages that are not decision-clear.

### Recommendation: Action-Oriented UX by Role

**Student dashboard should emphasize:**
- Next session
- Follow-up due
- Remaining package sessions
- Progress streak / current target
- One primary next action

**Teacher dashboard should emphasize:**
- Today's sessions
- Students needing grading/evaluation
- Unread messages
- Missing availability
- Pending admin requirements

**Admin dashboard should emphasize:**
- Unresolved issues (control tower)
- Today's operational risks
- New signups
- Pending CV reviews
- Low package/renewal opportunities
- Automation failures

### 4 Critical Journeys to Audit End-to-End
1. Lead → trial → paid package
2. Student booking → session → follow-up → next booking
3. Teacher onboarding → first approved session
4. Missed session → recovery → parent communication

---

## 5. Student Lifecycle & Retention

### What Exists
- Package structure, progress visibility, follow-up loop, evaluations, messaging, notifications

### What's Missing: Retention Engine

| Signal | Risk Level | Response |
|--------|-----------|----------|
| No booking in 14 days | Medium | Nudge message |
| Repeated no-show | High | Parent alert + admin flag |
| Falling follow-up completion | Medium | Teacher coaching prompt |
| Package expired without renewal | High | Win-back campaign |
| No login or message response | Critical | Admin intervention queue |

### Recommended Flows
- **Trial-to-paid engine:** thank-you → teacher feedback → package recommendation → admin follow-up if no action in 48h
- **Early engagement window (first 2 weeks):** remind booking, encourage follow-up, nudge progress, reassure parent
- **Package threshold logic:** notify at low balance, highlight renewal, alert admin for high-value students

---

## 6. Teacher Operations

### Strengths
- 5-step onboarding checklist with progress bar
- Broad capabilities: availability, sessions, follow-up, evaluations, messaging, CV

### Risks
- Too many post-session obligations
- Unclear priority between messages, grading, evaluations, availability
- Weak visibility into which students need intervention

### Recommendations

**A. Teacher Action Queue** — one view showing:
- Grade pending
- Evaluation due
- Student needs follow-up
- Availability low
- Unread messages

**B. Teacher Health Metrics (weekly):**
- Sessions completed
- Punctuality
- Grading lag
- Evaluation completion rate
- Average rating
- Student retention

**C. Automated Teacher Follow-Through:**
- Missing grading → n8n prompt
- Overdue evaluations → escalation
- Low upcoming availability → reminder
- Too many declined bookings → admin flag

---

## 7. Parent Experience

### Why It's Critical
Parent trust is probably the single most important retention driver. Parents are buyers AND operational coordinators.

### Parent Communication Should Answer 5 Questions:
1. Did the session happen?
2. Was the student present and engaged?
3. Is the student improving?
4. What should the student do before the next lesson?
5. Is anything wrong that I should know?

### Urgency Tiers

| Tier | Type | Example |
|------|------|---------|
| 1 | Routine update | Session completed, follow-up assigned |
| 2 | Attention needed | Student missed follow-up, needs reinforcement |
| 3 | Concern | Missed session, repeated issue |
| 4 | Escalation | Admin follow-up required |

### Parent Reassurance Moments
- First session completed
- First follow-up submitted
- First milestone reached
- Evaluation improvement detected

---

## 8. Automation

### Current State
- Infrastructure built: automation_logs table, event emission, webhook endpoint, admin dashboard
- 52 workflows planned across 12 areas
- 2 active workflows (Kuwait News, Claude Telegram)
- First 8 critical workflows defined

### Missing: Automation Governance

| Need | Status |
|------|--------|
| Workflow ownership | Not defined |
| Idempotency | Table exists, not yet enforced in workflows |
| Delivery observability | No message_delivery_log |
| Dead-letter handling | No dead-letter queue |
| Naming/versioning | Convention defined, not yet enforced |
| Failure alerting | Planned (WF-2), not built |

### Recommended Rollout Order

**Tier 1 — Build First:**
1. Platform health check
2. Workflow failure alerting
3. Session reminder engine
4. Daily.co room auto-creation
5. No-show detector
6. Parent report generator
7. Package exhaustion warning
8. Teacher grading follow-up

**Tier 2 — Next:**
9. CV approval loop
10. Weekly parent digest
11. Evaluation compliance prompts
12. Admin daily digest
13. Inactivity detection
14. Announcement broadcaster

**Tier 3 — After Discipline Established:**
15. Teacher matching AI
16. Parent chatbot
17. Curriculum advisor
18. Sentiment analysis
19. Churn scoring

**Critical Rule:** Do not let AI workflows become the first thing operationalized at scale. AI should sit on top of stable operational foundations.

---

## 9. Payments & Business Model

### Strengths
- Package model is solid: 5 types, multi-currency, admin CRUD, atomic deduction
- Schema supports payments, transactions, credits, invoices, refund policies

### Critical Gap: Purchase Flow Not Complete

**Required for completion:**
1. Stripe Checkout session creation
2. Webhook verification and event handling
3. Successful payment → package fulfillment
4. Confirmation messaging
5. Invoice/receipt generation
6. Failure handling and retry
7. Refund policy workflow

### Entitlement Rules to Define Explicitly
- When exactly is a session deducted?
- What happens on cancellation? On no-show? On teacher fault?
- How are refunds reflected?
- How are credits and packages coordinated?

### Business Analytics Needed
- Lead to trial rate
- Trial to paid rate
- Paid to renewal rate
- Average sessions per active student
- Package exhaustion-to-renewal lag

---

## 10. Admin & Moderation

### Strengths
- Substantial admin surfaces: users, sessions, evaluations, packages, CV review, audit
- Admin role (formerly Moderator, dropped per ADR-0003) for narrower oversight

### Recommendation: Control Tower Dashboard

**Should show at a glance:**
- Upcoming operational risks
- Pending CV reviews
- Overdue grading/evaluations
- Low package balances
- Failed automations
- Missed sessions
- New signups needing follow-up

**Exception Queues:**
- Booking conflicts
- Repeated no-shows
- Flagged messages
- Unapproved CVs
- Low-availability teachers
- Failed payment fulfillment

---

## 11. Security & Governance

### Current
- Role-based routing, RLS, audit logging, admin separation

### Recommendations
1. **Sign all internal webhooks** (app ↔ n8n) with shared secrets
2. **Minimize service-role exposure** — only workflows that truly need it
3. **Periodic access audits** — admin users, admin users, n8n credentials
4. **Human-readable admin action logs** — not just raw JSON diffs
5. **Failure escalation policy:**
   - Workflow failure > 5 min → Telegram
   - Critical system outage → Telegram + email
   - Repeated delivery failure → admin queue

---

## 12. Documentation Needed

| Document | Purpose |
|----------|---------|
| **Event Catalog** | Event name, trigger, payload, source of truth, subscribers, side effects |
| **Lifecycle Docs** | Booking, session, follow-up, package, evaluation lifecycles |
| **Automation Registry** | Per-workflow: owner, inputs, outputs, retry policy, KPI |
| **Communication Templates** | Arabic + bilingual templates for reminders, reports, alerts, renewals |
| **Exception Playbooks** | What admins do when: room fails, teacher misses, payment fails, parent complains |

---

## 13. Priority Roadmap

### P1 — Do First
- Complete Stripe purchase flow and fulfillment
- Build automation logging/failure alerting
- Define system-of-record for each operational action
- Harden session reminders, room creation, missed-session flows
- Sign all internal webhooks

### P2 — Next
- Package exhaustion/renewal flows
- Teacher grading/evaluation compliance workflows
- Communication preferences and delivery tracking
- Audit top 4 user journeys with real test scenarios
- Parent report automation (AI + fallback)

### P3 — After That
- Trial conversion engine
- Admin control tower dashboard
- Teacher performance intelligence
- Churn scoring and win-back automation
- Message moderation

### P4 — Advanced
- AI parent narratives at scale
- AI curriculum advisor
- Teacher matching
- Parent self-service chatbot
- Recording transcription

---

## 14. Top 10 Recommendations (Condensed)

1. **Finish Stripe and package fulfillment fully**
2. **Treat parent trust as a core product pillar**, not just communication
3. **Reduce logic sprawl** by defining domain ownership
4. **Add delivery logs and dead-letter handling** before scaling automation
5. **Build workflow failure alerting** before adding more workflows
6. **Shift dashboards toward action-oriented UX** by role
7. **Build stronger retention and renewal workflows** around packages
8. **Create an admin control tower** for exceptions and risks
9. **Standardize event contracts, lifecycle docs, and message templates**
10. **Use AI for summarization and recommendations**, not critical state mutation

---

## Final Verdict

FURQAN is a strong project. The fundamentals are much better than average. The platform already has real business depth, real educational depth, and real operational potential.

The project does not need reinvention. It needs tightening.

The biggest win now is making the platform:
- **Easier to operate**
- **Easier to monetize**
- **Easier to trust**
- **Easier to scale**

That is the path from "good product" to "serious academy operating system."
