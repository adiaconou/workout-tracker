# Workout Tracker — Product Requirements Document

**Status:** Draft v0.4
**Date:** July 14, 2026
**Product:** Mobile-first workout logging Site  
**Source material:** [Rolling 4-Workout Plan](https://docs.google.com/spreadsheets/d/1jiCjg9aBBTWVHEHzPgvOAG3aPuIHWifwSO6EOsXT534/edit) in the Google Drive folder **Workout Plan**

## 1. Product summary

Workout Tracker is a single-user, mobile-first web app for running and logging the existing rolling four-workout plan. The product must save every performed or skipped set to a durable store so workout history survives refreshes, interruptions, device changes, and future app deployments.

The app includes routines A–D from the source plan, lets the user start any routine, guides the user through each prescribed set, captures actual performance, automatically runs the correct rest timer, and durably saves each set-level action. It also uses recent completed-set history to distinguish routines that are recovered enough to perform from the routine that best advances the user's goals today. The choice of database, storage engine, API, authentication provider, synchronization design, and hosting implementation belongs in the eventual technical design, not this product document.

## 2. Problem statement

The source spreadsheet describes the plan clearly, but it is optimized for reading and manual logging rather than use during a workout. Its Training Log stores multiple sets across columns in one exercise row, while the desired app must react to and persist individual set events. The app should reduce interaction during training and produce a complete, durable, auditable workout history.

## 3. Goals

1. Make it fast to select and start any routine in the rolling A → B → C → D plan.
2. Show the correct exercise, set type, target, effort, and rest instruction at the moment they are needed.
3. Capture actual reps or duration and load for every performed set.
4. Save each performed or skipped set to a durable store immediately and reliably.
5. Handle the plan's real programming details, including warm-ups, rep ranges, timed holds, per-side work, failure sets, a drop set, supersets, and EMOM rounds.
6. Make an in-progress workout recoverable after refresh, navigation, connection loss, or accidental app closure.
7. Capture the complete plan and its behavior precisely enough that the app can be reproduced from this PRD plus an eventual technical design.
8. Recommend a goal-aligned routine while showing the availability of every active routine. Recovery caution preserves manual choice; only a missing-equipment hard blocker prevents a new start.

## 4. Non-goals for the first release

- Social features, coaching, leaderboards, or shared/multi-athlete accounts
- AI-generated routine creation, medical diagnosis, or automatic prescription changes. The first release may provide deterministic, explainable goal and recovery guidance from the user's own logged history.
- End-user catalog-management screens for creating entirely new routines or exercises. Authenticated CRUD APIs and the underlying entity model are included so these screens can be added without another persistence redesign.
- Nutrition, cardio, or body-measurement tracking beyond optional workout body weight and notes
- Advanced analytics, charts, or automatic progression changes
- Wearable-device integration

## 5. Source plan findings

The source workbook uses the `America/Los_Angeles` timezone and contains four tabs. These findings are inputs to the product specification, not a requirement that the production app use the workbook at runtime.

### 5.1 Overview

The Overview tab defines the plan-level context:

- Sequence: A → B → C → D → repeat, without resetting on Monday
- Expected duration: approximately 55–60 minutes
- General effort: most regular sets finish with 1–2 clean reps in reserve
- Plan goals, training rules, and short summaries for routines A–D

### 5.2 Workouts — current routine schema

`Workouts!A:K` contains one row per exercise, with row order representing exercise order.

| Column | Existing field | Meaning |
| --- | --- | --- |
| A | Workout | Routine identifier: A, B, C, or D |
| B | Routine summary | Repeated human-readable routine description |
| C | Exercise | Exercise name |
| D | Warm-up sets | Human-readable warm-up prescription |
| E | Regular sets | Number of standard work sets |
| F | Failure sets | Number of technical-failure sets |
| G | Drop sets | Number of drop sets |
| H | Reps | Rep, duration, per-side, or set-type-specific target |
| I | Rest | Rest duration or scheduling rule |
| J | Effort target | RIR, technique, speed, hold, or failure target |
| K | Why included | Exercise rationale |

The current plan contains:

| Routine | Focus | Exercises | Special behavior |
| --- | --- | ---: | --- |
| A | Pull-up and pressing strength | 6 | Strict pull-up strength work; weighted plank timed holds |
| B | Pull-up volume and upper-body hypertrophy | 7 | Per-side row; lateral-raise failure set followed by a no-rest drop set |
| C | Dumbbell/kettlebell leg strength and core | 6 | Per-leg/per-side work and timed side planks; rest after both sides |
| D | Pull-up density, back, arms, and core | 8 | 10-round EMOM; rear-delt failure set; curl/pressdown superset |

### 5.3 Pull-up Progression — current progression schema

The main progression table contains:

`Workout`, `Purpose`, `Starting prescription`, `Progression trigger`, `Next step`, `Failure?`, `Rest`, `Notes`

It defines specific rules for routines A, B, and D plus a periodic max-rep retest. A second table shows set-by-set progression for Workout A from 5×2 to 5×3.

### 5.4 Training Log — current logging schema

The existing `Training Log!A:N` header is:

`Date`, `Cycle #`, `Workout`, `Exercise`, `Load`, `Set 1`, `Set 2`, `Set 3`, `Set 4`, `Set 5 / Rounds`, `RIR`, `Completed?`, `Body weight`, `Notes`

The Workout field is restricted to A/B/C/D. Completed is restricted to Yes/Partial/No. The tab currently contains no logged workouts.

The existing wide format is useful for manual review, but it does not represent individual set timestamps, skips, timer rules, more than five sets, or separate failure/drop-set targets. The product therefore needs distinct logical records for sessions and individual prescribed sets.

## 6. Product assumptions

1. The first release is for one authenticated user.
2. The app ships with the routine definitions and progression rules captured in this PRD.
3. The user may edit the existing routine prescriptions. Routine changes create a new version and never alter an in-progress workout snapshot or historical session.
4. Weight defaults to pounds. Bodyweight, added weight, and assistance are distinct load types. A kilograms setting may be added later.
5. Body weight is captured once per workout session, not once per exercise.
6. Routine content is snapshotted when a workout starts so later routine changes do not alter a workout already in progress or its historical meaning.
7. Product behavior must not depend on a particular database, cloud vendor, spreadsheet, API framework, or hosting implementation.

## 7. Core user experience

### 7.1 Home and routine library

- Show every active routine with identifier, focus, summary, exercise count, estimated duration, and most recent completion date. The four canonical routines remain the baseline plan, and active custom routines are assessed too.
- Show exactly four availability states: **Recommended**, **Available**, **Use caution**, and **Unavailable**. When an eligible routine can be recommended, encode that choice with the **Recommended** state instead of a separate recommendation flag.
- Calculate the logged-training overlap estimate from completed sets in the prior 48 hours. A set performed exactly 48 hours ago is outside the window. Warm-ups contribute less load; failure and drop sets contribute more. Actual RIR, when recorded, adjusts regular-set effort; missing or invalid Actual RIR is neutral.
- Calculate goal fit from the plan's priorities: improve pull-ups, build upper-body strength and definition, train legs once per rolling cycle, strengthen the core, and preserve the A → B → C → D balance.
- Prefer the next routine in the rolling sequence when it is **Available**. If it has moderate or high recent overlap, mark it **Use caution** and recommend the strongest other available goal fit.
- Assess every active custom routine. While any canonical routine is active, custom routines do not enter or perturb the canonical rolling recommendation; if no canonical routines are active, the active custom routines form the fallback rotation.
- Explain caution using the source routine name, plain-language muscle groups, and the age of the relevant logged set data.
- If every equipment-compatible rolling-plan routine needs caution, recommend rest or a lighter session instead of assigning **Recommended** or falsely calling any routine **Unavailable**.
- **Use caution** is advisory and never disables or hides a routine. **Unavailable** is reserved for missing required equipment and blocks only a new start; an already-active workout for that routine remains resumable.
- Identify this guidance as an estimate from logged training, not a guarantee of readiness or a medical safety assessment.
- If an incomplete workout exists, show **Resume workout** as the primary action.

### 7.2 Routine detail

- Show the ordered list of exercises and prescribed warm-up, regular, failure, and drop sets.
- Show target reps or duration, rest rule, effort target, and exercise rationale.
- Show the last logged result for the same exercise when available.
- Start Workout must create a durable in-progress workout session before the first set can be logged.

### 7.3 Active workout

- Optimize the screen for one-handed phone use with large controls and minimal typing.
- Show workout progress, exercise progress, current exercise, current set number/type, target, effort, and rest instruction.
- Support previous/next exercise navigation without losing state.
- Prefill the last-used load when available, while requiring the user to confirm or change it.
- Accept whole or decimal weights and a valid non-negative rep count.
- For timed holds, collect actual seconds instead of reps.
- For per-side movements, collect one reps-per-side value in the MVP. Separate left/right values when sides differ is a P1 enhancement.
- For bodyweight or assisted movements, label the load input as bodyweight, added load, or assistance rather than treating all load as ordinary external weight.
- Display warm-up sets as real guided sets. The user can log, skip, or complete them with optional actual load/reps.

### 7.4 Set completion and timer behavior

- Tapping **Log set** creates or updates the set's durable performance record and starts the applicable rest timer from the tap timestamp.
- The app must clearly distinguish Saving, Saved, and Save failed states. A failed save retains the entered values and offers retry; it must never silently discard or duplicate the set.
- The timer must continue when the user views another exercise, changes app views, or locks the phone where the platform permits.
- The timer shows remaining time and supports **Skip rest**, pause/resume, and ±15-second adjustment.
- At zero, notify with sound and vibration when allowed, and show the next set.
- **Skip set** records a skipped status and optional reason, then advances using the appropriate rest rule.
- The user can edit or undo a logged/skipped set; the existing logical record is updated rather than duplicated.

### 7.5 Plan-specific timer rules

- Convert ordinary values such as 3 min, 2.5 min, 2 min, 90 sec, and 1 min into numeric seconds.
- “After both” starts the timer only after both sides are complete.
- The lateral-raise failure set transitions immediately to its drop set; the one-minute timer starts after the drop set.
- Workout D's strict pull-up EMOM starts each round on a 60-second boundary and treats the remaining time in that minute as rest.
- The curl/pressdown superset does not start rest after the curl; it starts the 90-second timer after pressdowns.
- A skipped rest is stored as an event but does not change the prescribed rest value.

### 7.6 Workout completion

- Show completed, skipped, and remaining set counts before finishing.
- Allow completion as Completed, Partial, or Abandoned. Abandoned requires confirmation.
- Collect optional session body weight and notes.
- Durably save completion time, duration, status, and totals to the workout session.
- Show a summary with volume where meaningful, rep/duration achievements, skipped sets, and any applicable pull-up progression prompt.
- Advance the recommended routine only after a Completed workout. Partial workouts remain visible in history but do not automatically advance the sequence unless the user chooses to count them.

### 7.7 History

- List sessions newest first with date, routine, status, duration, completed/total sets, and body weight if present.
- Open any session in a read-only summary.
- If completed-record correction is enabled, allow correction of the user's own logged values and preserve an audit timestamp.

## 8. Logical data and persistence requirements

This section defines the information the product must preserve and the observable behavior of persistence. It deliberately does not select a database, schema technology, API, hosting vendor, or synchronization mechanism.

### 8.1 Durability requirements

- Every performed or skipped set must be saved to a durable store as an individual set-performance record.
- A successful save must survive page refresh, sign-out/sign-in, app restart, device change, and deployment of a newer app version.
- The product must never silently lose or duplicate a performed/skipped set.
- Retrying the same logical save must update or confirm the original record rather than create a duplicate.
- If persistence fails, preserve the user's entered values, show the failure clearly, and provide retry.
- An in-progress workout must be resumable from the last durably recorded state.
- The product must not mark a workout Completed or Partial while performed/skipped set actions remain unresolved or unsaved. The user may exit, but the session remains In Progress until persistence succeeds or the affected action is explicitly discarded.
- Completed workout history must remain readable after routine definitions change.

### 8.2 Exercise catalog, routine, and prescribed-set model

The product must maintain reusable exercise catalog identities independently from routine programming. A routine is a stable identity with immutable versions; each version contains ordered exercise placements, and each placement contains individually addressable prescribed sets.

An exercise catalog entry owns movement metadata such as name, equipment, movement pattern, tracking type, load type, side mode, instructions, and weighted primary/supporting muscle associations. Sets, reps, RIR, and rest do not belong to the exercise catalog because they vary by routine.

A published routine version is immutable. Editing a routine creates a new version, preserves earlier versions, and changes only future workout instances. Exercise and set order are stored as explicit positions rather than serialized arrays.

Required logical fields:

| Field | Purpose |
| --- | --- |
| routine_id / routine_version | Stable routine identity and snapshot version |
| exercise_id / exercise_order | Reusable catalog identity and placement sequence |
| exercise_name | Display label |
| set_id / set_order / set_type | Warm-up, regular, failure, drop, EMOM, or test set |
| target_min / target_max / target_unit | Structured reps or seconds target |
| side_mode | None, per-side, per-leg, or separate-sides allowed |
| effort_target | RIR, controlled hold/reps, technical failure, or technique cue |
| rest_seconds | Numeric timer duration |
| rest_rule | Standard, after-both-sides, no-rest-before-drop, EMOM, or after-superset |
| superset_group | Links exercises that share a rest period |
| load_type / weight_unit | External, bodyweight, added, assistance, band, lb, or kg |
| instruction / notes | Display guidance that should not be lost |
| active | Allows retirement without deleting history |

The persistence model must preserve separate logical entities for Exercise, Exercise Muscle, Routine, Routine Version, Routine Exercise, and Routine Set. API consumers may update a draft version as one aggregate so a routine cannot be left partially updated.

### 8.3 Workout session model

Each started workout must have one durable logical session with:

`Session ID`, `Started At`, `Completed At`, `Routine ID`, `Routine Version`, `Cycle #`, `Status`, `Current Exercise`, `Current Set`, `Completed Sets`, `Skipped Sets`, `Total Sets`, `Duration Sec`, `Body Weight`, `Weight Unit`, `Session Notes`, `Created At`, `Updated At`

- Status values: In Progress, Completed, Partial, Abandoned.
- The session includes an immutable snapshot of the prescribed routine version used when it started.
- Starting a session materializes ordered Workout Exercise and Workout Set records. This supports resume, substitutions, corrections, and future ad-hoc workouts without mutating the source routine.
- Starting or retrying Start Workout must not create duplicate sessions.
- Only one session may be active unless the user explicitly completes or abandons it.

### 8.4 Set-performance model

Each prescribed set in a session must have one logical performance record with:

`Set Performance ID`, `Session ID`, `Prescribed Set ID`, `Exercise ID`, `Exercise Order`, `Exercise Name`, `Set Order`, `Set Type`, `Target Display`, `Target Min`, `Target Max`, `Target Unit`, `Target Rest Sec`, `Rest Rule`, `Actual Reps`, `Actual Left`, `Actual Right`, `Actual Duration Sec`, `Actual Weight`, `Load Type`, `Weight Unit`, `Actual RIR`, `Status`, `Performed/Skipped At`, `Rest Skipped`, `Created At`, `Updated At`, `Notes`

- Status values: Planned, Completed, Skipped.
- The product creates at most one performance record for each prescribed set in a session.
- During an active workout, a correction updates the logical record and preserves an audit timestamp. Correction of completed workouts depends on the product decision in Section 13.
- Skipping rest is recorded separately from skipping the set and never changes the prescribed rest value.
- Timestamps preserve timezone information and display in America/Los_Angeles by default.

### 8.5 Source-plan independence

- The source workbook was used to discover and verify the canonical product content in Section 15.
- The production app must not require the source workbook unless the technical design explicitly chooses it as an implementation dependency.
- Import, migration, storage, indexing, and physical schema choices belong in the technical design.
- Regardless of implementation, the logical entities, values, relationships, and durability behavior defined here must remain observable to the user.

### 8.6 Goal and recovery guidance

- Each canonical exercise must have a maintained association with its primary and supporting muscle groups. Active custom routines must also provide muscle metadata to receive a normal overlap assessment; missing metadata produces **Use caution**, not **Unavailable**.
- Logged-training overlap uses only sets that were actually completed during the prior 48 hours. Skipped sets do not add load, and sets at the exact 48-hour boundary are excluded.
- Warm-up, failure, and drop-set types affect effort consistently. Actual RIR is optional and adjusts regular-set effort when it is finite; an omitted, null, or invalid value is treated neutrally.
- A completed routine advances the rolling sequence; a partial or abandoned routine does not. Its completed sets may still contribute to availability caution.
- Only active routine codes appear in the recommendation response. Active custom routines receive availability guidance without changing the canonical rolling sequence or its selected recommendation while a canonical routine remains active.
- The same history and time must always produce the same recommendation. The first release does not use generative AI or silently modify routine prescriptions.
- The recommendation response must preserve, for every active routine: one of exactly **Recommended**, **Available**, **Use caution**, or **Unavailable**; a short availability reason; a goal-fit reason; and whether it is next in sequence. The single recommendation is encoded by the **Recommended** state rather than a separate boolean.
- Moderate and high recent muscle overlap both map to **Use caution**. Overlap guidance never maps to **Unavailable** and never blocks a start.
- **Unavailable** is used only when required equipment is missing from Training setup. It blocks a new start but does not prevent resuming an already-active workout for the same routine.
- A caution reason must name the routine that supplied the newest relevant completed-set evidence.
- With no workout history, Routine A is **Recommended** and the other canonical routines are **Available**.
- Recommendation thresholds and muscle associations are product configuration that must be regression-tested against no-history, the exact 48-hour boundary, optional Actual RIR, partial-session, upper-body, lower-body, custom-routine, all-caution, and missing-equipment scenarios.

## 9. Functional requirements and acceptance criteria

| ID | Priority | Requirement | Acceptance criterion |
| --- | --- | --- | --- |
| FR-01 | P0 | Authenticate the user | Authorized user can open their tracker and history; unauthorized users cannot access workout data |
| FR-02 | P0 | Provide the canonical routines | All 27 exercises appear under the correct routine and in the exact order and configuration specified in Section 15 |
| FR-03 | P0 | Start any routine | Start creates exactly one durable In Progress session with a snapshot of the selected routine |
| FR-04 | P0 | Show prescribed set details | Every set shows type, target reps/duration, effort, and applicable rest rule |
| FR-05 | P0 | Log actual performance | Valid reps/duration and weight can be entered and corrected for each set |
| FR-06 | P0 | Persist every set immediately | Each completed/skipped action is saved exactly once to a durable store and survives refresh, restart, device change, and redeployment |
| FR-07 | P0 | Automatically start correct rest behavior | All ordinary, after-both, drop-set, EMOM, and superset cases follow the routine definition |
| FR-08 | P0 | Skip set and skip rest | Each action advances correctly; skipped sets and skipped rest are stored distinctly |
| FR-09 | P0 | Resume interrupted workout | Refreshing or reopening restores the active set, prior records, and timer state without data loss or duplication |
| FR-10 | P0 | Finish or abandon a workout | The durable session reflects Completed, Partial, or Abandoned with accurate timestamps and totals |
| FR-11 | P1 | Show previous performance | Active exercise can show last session's weight and reps/duration |
| FR-12 | P1 | Show workout history | User can list and open prior sessions newest first |
| FR-13 | P1 | Apply progression guidance | Relevant pull-up progression prompt appears after qualifying sessions without automatically changing the plan |
| FR-14 | P1 | Edit prior set data, if enabled | Edit updates the existing logical record and audit timestamp without duplicating it |
| FR-15 | P2 | Export/share a session summary | User can create a readable summary without exposing private credentials or unrelated workout data |
| FR-16 | P0 | Recommend a workout for today | Every active routine shows exactly one of Recommended, Available, Use caution, or Unavailable from the prior 48 hours of completed-set evidence; one eligible rolling-plan routine is Recommended, caution remains startable, and only missing equipment blocks a new start |
| FR-17 | P0 | Provide a reusable entity and API layer | Authenticated owner-scoped APIs can create, read, update, and archive exercises, routines, and workouts; routine versions and workout-set corrections preserve the versioning and history invariants in Section 8 |

## 10. Reliability, security, and quality requirements

- Require authentication and apply least-privilege authorization to all workout data.
- Never place credentials, secrets, access tokens, or private storage identifiers in client-visible source code or logs.
- Show Saving, Saved, Offline, and Save failed states. Do not imply durable persistence succeeded until confirmed.
- Preserve pending writes during temporary connection loss and persist them in order when connectivity returns.
- Preserve stable session and set identities across retries to prevent duplicate sessions and set records.
- Prevent two simultaneously active sessions unless the user explicitly abandons or completes the first one.
- Keep interactive controls usable on a phone, with large touch targets, readable contrast, keyboard avoidance, and screen-reader labels.
- Initial app load should show routine names promptly. Set logging should feel immediate even if durable confirmation takes longer.
- The app must not provide medical diagnosis or encourage training through pain; retain the plan's instruction to stop or modify an exercise if pain develops.
- Availability must be labeled as guidance derived from logged training and Training setup. It must not claim to measure soreness, injury, sleep, or medical readiness that the product does not observe.
- The technical design must map these product-level security and durability requirements to concrete controls and failure handling.

## 11. Analytics and operational events

For product quality, record only minimal non-sensitive events such as:

- routine_viewed, workout_started, workout_resumed
- set_completed, set_skipped, rest_skipped
- workout_completed, workout_partial, workout_abandoned
- recommendation_viewed, recommendation_overridden
- durable_save_succeeded, durable_save_failed, duplicate_write_prevented

Workout values remain private user data. Product analytics should not include exercise notes, body weight, or exact performance values unless the user explicitly opts in.

## 12. Release plan

### MVP / P0

- Authenticated, private access
- Routine list and routine details from the canonical plan in Section 15
- Start, resume, and complete any routine
- Guided set logging with all plan-specific set/timer modes
- One durable session per workout
- Immediate, idempotent persistence of every performed/skipped set
- Basic session summary and sync/error states
- Explainable Recommended routine and four-state availability for every active routine
- Reusable exercise catalog, immutable routine versions, materialized workout logs, and authenticated entity APIs

### Follow-up / P1

- History and prior-performance reference
- Progression prompts
- Editing prior sets
- Optional left/right asymmetric logging
- Starting new workouts while fully offline and richer timer notifications

### Later / P2

- Trends and volume charts
- Session sharing/export
- New-routine creation, exercise additions/removals, and exercise substitutions
- Cardio, measurements, and wearable integration

## 13. Product decisions and remaining questions

Resolved:

- Weight defaults to pounds.
- Completed workout records may be corrected later. Corrections update the existing logical record and preserve an audit timestamp.
- Recovery guidance never prevents the user from opening or starting a routine.

Remaining:

1. Decide how assisted pull-up load should be entered: assistance amount, band label, or both.

## 14. Technical decisions intentionally deferred

The following choices belong in the eventual technical design:

- Durable storage technology and physical schema
- Application runtime, hosting, and deployment architecture
- Authentication and authorization provider
- Client/server boundaries and API design
- Offline queueing, synchronization, caching, and conflict resolution mechanisms
- Encryption, secret management, backup, restore, and data-retention implementation
- Observability, operational alerting, migrations, and disaster recovery
- Any optional integration with Google Drive or Google Sheets

The technical design must trace each of these implementation choices back to the product requirements and acceptance criteria in this document. Together, the PRD and technical design must be sufficient for a new engineering team to reproduce the product from scratch without relying on undocumented behavior.

## 15. Canonical workout plan

This section is the product's canonical content baseline. A reproduction of the app must include these routines, exercises, targets, ordering, rest rules, effort targets, and progression rules even if the source workbook is unavailable.

### 15.1 Plan-level rules

- Goal: improve pull-up reps, build upper-body strength and definition, train legs once per cycle, strengthen the core, and support body recomposition.
- Sequence: A → B → C → D → repeat; do not restart the sequence on Monday.
- Expected workout length: approximately 55–60 minutes.
- Cardio is performed separately.
- Most regular sets finish with 1–2 clean reps in reserve.
- Use only the listed warm-up sets; they should prepare the movement without creating fatigue.
- Only the final lateral-raise and rear-delt-fly sets go to technical failure.
- Only the lateral raise includes a drop set. Reduce the load by approximately 20–25% immediately after the failure set.
- When all regular sets reach the top of the rep range with the target effort, increase load and return to the bottom of the range.
- Stop or modify an exercise if pain develops.

### 15.2 Routine A — Pull-up and pressing strength

Strict pull-ups first, heavy bench press, balanced chest/back volume, plus core and triceps.

| Exercise | Warm-up | Regular | Failure | Drop | Target | Rest | Effort | Purpose |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| Strict pull-up | 1×6 scapular; 1×3 assisted | 5 | 0 | 0 | 2 reps | 3 min | ≈2 RIR | Direct pull-up strength practice |
| Barbell bench press | Bar×10; 50%×5; 70%×3 | 4 | 0 | 0 | 5–7 reps | 3 min | 1–2 RIR | Main heavy chest, shoulder, and triceps lift |
| Chest-supported dumbbell row | None | 3 | 0 | 0 | 6–10 reps | 2 min | 1–2 RIR | Builds lats and upper back without lower-back fatigue |
| Neutral-grip dumbbell chest press | None | 3 | 0 | 0 | 8–12 reps | 2 min | 1–2 RIR | Adds chest and triceps volume |
| Weighted plank | None | 3 | 0 | 0 | 30–45 sec | 1 min | Controlled hold | Builds trunk stiffness and core strength |
| Cable triceps pressdown | None | 2 | 0 | 0 | 10–15 reps | 1 min | 1–2 RIR | Direct triceps work to support pressing |

### 15.3 Routine B — Pull-up volume and upper-body muscle

Assisted pull-ups, shoulders, upper chest, back, arms, and abs.

| Exercise | Warm-up | Regular | Failure | Drop | Target | Rest | Effort | Purpose |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| Assisted pull-up | 1 easy set×5 | 4 | 0 | 0 | 6–8 reps | 2 min | ≈2 RIR | Builds pull-up-specific volume and endurance |
| Barbell overhead press | Bar×10; light×5 | 3 | 0 | 0 | 6–8 reps | 2.5 min | 1–2 RIR | Builds shoulder and triceps strength |
| Incline dumbbell press | None | 3 | 0 | 0 | 8–12 reps | 2 min | 1–2 RIR | Emphasizes upper chest and front delts |
| One-arm dumbbell row | None | 3 | 0 | 0 | 8–12/side | 90 sec after both | 1–2 RIR | Builds lats and upper back one side at a time |
| Dumbbell lateral raise | None | 2 | 1 | 1 | 12–15 regular; 12–20 failure; 8–12 drop | 1 min; no rest before drop | Final set to technical failure | Builds shoulder width; limited failure/drop work |
| Barbell or dumbbell curl | None | 2 | 0 | 0 | 8–12 reps | 1 min | 1–2 RIR | Strengthens biceps for pull-ups and arm development |
| Hanging knee raise | None | 3 | 0 | 0 | 8–15 reps | 1 min | Controlled reps | Trains abs, hanging comfort, and grip |

### 15.4 Routine C — Dumbbell leg strength and core

One focused lower-body session using dumbbells and kettlebells to fit the available space.

| Exercise | Warm-up | Regular | Failure | Drop | Target | Rest | Effort | Purpose |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| Kettlebell swing | 1 light set×10 | 4 | 0 | 0 | 8 reps | 90 sec | Fast, crisp reps | Trains explosive hip extension |
| Double-dumbbell front squat | Light DBs×8; moderate DBs×5 | 4 | 0 | 0 | 6–10 reps | 3 min | 1–2 RIR | Primary quad and glute strength exercise |
| Dumbbell Romanian deadlift | 1 light set×8 | 3 | 0 | 0 | 8–12 reps | 2.5 min | 1–2 RIR | Builds hamstrings, glutes, and hip hinge |
| Rear-foot-elevated dumbbell split squat | None | 2 | 0 | 0 | 8–10/leg | 2 min after both | 1–2 RIR | Builds single-leg strength and stability |
| Reverse crunch | None | 3 | 0 | 0 | 10–15 reps | 1 min | Controlled reps | Trains abdominal and pelvic control |
| Side plank | None | 3 | 0 | 0 | 30–45 sec/side | 1 min after both | Controlled hold | Builds oblique and lateral-core strength |

### 15.5 Routine D — Pull-up density, back, arms, and core

EMOM singles for repeatability, followed by a complete upper-body and core session.

| Exercise | Warm-up | Regular | Failure | Drop | Target | Rest | Effort | Purpose |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| Strict pull-up EMOM | 1×6 scapular; 1×3 assisted | 10 | 0 | 0 | 1 rep/round | Start every minute | All reps crisp | Improves pull-up technique and repeatability |
| Bodyweight or weighted dip | 1 easy set×5 | 3 | 0 | 0 | 6–10 reps | 2 min | 1–2 RIR | Builds chest, shoulder, and triceps strength |
| Lat pulldown | None | 3 | 0 | 0 | 8–12 reps | 2 min | 1–2 RIR | Adds loadable vertical-pulling volume |
| Seated cable row | None | 3 | 0 | 0 | 10–12 reps | 90 sec | 1–2 RIR | Adds upper-back and lat volume |
| Cable rear-delt fly | None | 2 | 1 | 0 | 15–20 regular; 15–25 failure | 1 min | Final set to technical failure | Balances pressing and develops rear shoulders |
| Barbell curl | None | 2 | 0 | 0 | 8–12 reps | Superset | 1–2 RIR | Direct biceps work before pressdowns |
| Cable triceps pressdown | None | 2 | 0 | 0 | 10–15 reps | 90 sec after both | 1–2 RIR | Direct triceps work in an arm superset |
| Kneeling cable crunch | None | 3 | 0 | 0 | 10–15 reps | 1 min | Controlled reps | Progressively loadable abdominal work |

### 15.6 Pull-up progression rules

Current strict maximum at the time of this specification: approximately 4–5 reps.

| Workout | Purpose | Starting prescription | Progression trigger | Next step | Failure? | Rest | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Strength | 5×2 strict | All 10 reps are clean | Add one third rep to one set at a time until 5×3 | No | 3 min | After 5×3, add a small load and return to 5×2 |
| B | Volume/endurance | 4×6–8 assisted | Reach 4×8 with ≈2 RIR | Reduce assistance and return to 4×6 | No | 2 min | Preserve full range of motion |
| D | Technique/density | 10×1 EMOM | All 10 singles are easy and consistent | Add selected rounds of 2 reps, then build toward 10×2 | No | Start each minute | Keep every rep crisp; do not grind |
| Retest | Measure progress | One max set | After approximately 5 full A–B–C–D cycles | Retest after 1–2 recovery days | Yes—test only | As needed | Use the same grip and strict standards each test |

Workout A progresses through these set targets:

| Step | Set 1 | Set 2 | Set 3 | Set 4 | Set 5 | Total reps | Advance when |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Start | 2 | 2 | 2 | 2 | 2 | 10 | All reps clean |
| 1 | 3 | 2 | 2 | 2 | 2 | 11 | All reps clean |
| 2 | 3 | 3 | 2 | 2 | 2 | 12 | All reps clean |
| 3 | 3 | 3 | 3 | 2 | 2 | 13 | All reps clean |
| Goal | 3 | 3 | 3 | 3 | 3 | 15 | Add a small load; restart at 5×2 |

## 16. Definition of done for the first release

The first release is done when the user can authenticate; view every active routine, including the four canonical routines; see exactly one of Recommended, Available, Use caution, or Unavailable for each; start any Recommended, Available, or caution routine; resume the same active workout regardless of later equipment availability; log or skip every prescribed set; receive the correct rest/EMOM/superset behavior; safely resume after interruption; and finish the workout with every performed or skipped set reflected exactly once in durable workout history. Exercise, routine-version, workout, and workout-set data must also be accessible through the owner-scoped entity services and APIs without bypassing version or history protections.
