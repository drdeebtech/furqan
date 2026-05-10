# Feature Specification: Complete Loud Action Phase 2

**Feature Branch**: `[007-feature]`  
**Created**: 2026-05-10  
**Status**: Draft  
**Input**: User description: "Finish loud action phase 2"

## Clarifications

### Session 2026-05-10

- Q: How should concurrent updates to the same Phase 2 action be handled? → A: Optimistic concurrency control (reject stale update, require user refresh/retry).
- Q: Should completion history be mutable after recording? → A: Keep completion history immutable; corrections are recorded as new reversal/correction events.
- Q: Which roles can close Phase 2? → A: Operators can update actions; only manager/supervisor roles can close Phase 2.
- Q: What should happen if a closure attempt encounters stale data or a version conflict? → A: Block completion and show conflict details until the user refreshes and retries.
- Q: Which events must be audited for Phase 2 completion controls? → A: Audit action status changes and phase-close attempts (success or blocked) with actor, timestamp, and reason.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete remaining Phase 2 actions (Priority: P1)

As an operator, I can view all remaining Phase 2 actions and complete them in one coordinated flow so the phase can be closed without manual tracking outside the system.

**Why this priority**: Phase completion is the core business outcome and unlocks downstream work.

**Independent Test**: Can be fully tested by loading a Phase 2 record with pending actions, completing each required action, and confirming the phase transitions to completed.

**Acceptance Scenarios**:

1. **Given** a Phase 2 record with pending actions, **When** the operator completes all required actions, **Then** the phase status changes to complete.
2. **Given** a Phase 2 record with at least one pending action, **When** the operator attempts to finish the phase, **Then** the system blocks completion and identifies remaining required actions.

---

### User Story 2 - Track completion progress clearly (Priority: P2)

As an operator, I can see real-time progress for Phase 2 so I know what is done, what is blocked, and what remains before completion.

**Why this priority**: Clear progress visibility reduces errors and prevents premature closure.

**Independent Test**: Can be tested by completing a subset of Phase 2 actions and verifying progress counts and status labels update accurately.

**Acceptance Scenarios**:

1. **Given** a Phase 2 record with mixed action states, **When** the operator views the phase summary, **Then** completed and remaining counts are shown accurately.
2. **Given** an action changes from pending to complete, **When** the update is saved, **Then** phase progress reflects the change immediately.

---

### User Story 3 - Ensure completion is auditable (Priority: P3)

As a manager, I can review who completed Phase 2 actions and when, so completion decisions are transparent and verifiable.

**Why this priority**: Auditability supports accountability and operational review.

**Independent Test**: Can be tested by completing actions as different users and verifying each completion event is recorded with actor and timestamp.

**Acceptance Scenarios**:

1. **Given** a user completes an action, **When** completion is recorded, **Then** the system stores the user identity and completion time.
2. **Given** a completed Phase 2 record, **When** a manager reviews history, **Then** all required completion events are visible.

---

### Edge Cases

- A required action is marked complete and later re-opened; phase status must return to in-progress.
- Two users update action states at nearly the same time; stale submissions are rejected using optimistic concurrency and users must refresh before retrying.
- An optional action remains incomplete; phase completion should still succeed if all required actions are complete.
- A previously completed phase gains a newly required action due to updated rules; phase must no longer remain complete until requirement is satisfied.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present a definitive list of all Phase 2 actions with each action labeled as required or optional.
- **FR-002**: The system MUST allow authorized users to mark Phase 2 actions as complete and incomplete.
- **FR-002a**: The system MUST permit operators to update Phase 2 action statuses but restrict the explicit phase-close operation to manager/supervisor roles.
- **FR-003**: The system MUST prevent Phase 2 from being marked complete while any required action remains incomplete.
- **FR-004**: The system MUST automatically set Phase 2 status to complete when all required actions are complete.
- **FR-005**: The system MUST automatically revert Phase 2 status to in-progress if any required action becomes incomplete after completion.
- **FR-006**: The system MUST display current completion progress for Phase 2, including counts of required actions completed and remaining.
- **FR-007**: The system MUST record completion history for required actions, including acting user and timestamp for each status change.
- **FR-008**: The system MUST provide a clear reason when completion is blocked, including the specific required actions that remain incomplete.
- **FR-009**: The system MUST preserve Phase 2 completion records so managers can review historical completion details.
- **FR-010**: The system MUST enforce optimistic concurrency for Phase Action updates by rejecting stale writes when the record version has changed since read and requiring the user to refresh before retry.
- **FR-011**: The system MUST treat Completion Event records as immutable; any correction MUST be captured as a new event linked to the prior event rather than editing or deleting historical entries.
- **FR-012**: The system MUST block phase-close attempts when stale data or version conflicts are detected and present conflict details with a refresh-and-retry path.
- **FR-013**: The system MUST audit all Phase Action status changes and all phase-close attempts (successful or blocked), storing actor identity, timestamp, outcome, and blocking reason when applicable.

### Key Entities *(include if feature involves data)*

- **Phase**: A tracked stage of work that includes a status, completion state, and related actions.
- **Phase Action**: A discrete task under a phase, with requirement type (required/optional), status, and completion metadata.
- **Completion Event**: A historical record of action status changes with actor identity and timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of attempted Phase 2 closures with incomplete required actions are blocked and show the missing actions.
- **SC-002**: At least 95% of operators can complete a standard Phase 2 workflow (from first action update to successful closure) in under 5 minutes.
- **SC-003**: 100% of required-action status changes are reflected in visible phase progress within 2 seconds of save.
- **SC-004**: 100% of completed Phase 2 records include auditable completion history for all required actions.

## Assumptions

- Phase 2 already exists in the product lifecycle and this feature extends its completion behavior rather than introducing a new phase model.
- Authorized user roles for updating Phase 2 actions are already defined in the existing system.
- Required versus optional designation for actions is available from current business rules.
- Historical completion data is expected to be available to managers for operational review.
