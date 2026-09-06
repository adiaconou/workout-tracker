# Coach implementation plan

The Coach should ground advice in the user's current training data, preserve the
details of long conversations, and prepare reliable review cards. Routine and
exercise changes continue to require the user's Apply, Create, or Save action.

## Implementation

1. Extract the production message executor into a covered module. Fence response
   processing by the expected response ID and lease. Persist proposal results
   atomically with deterministic plan IDs so retries cannot duplicate proposals.
2. Add bounded, paginated reads for routine comparisons, exercise progress,
   workout sets, saved proposals, and the current thread's archive. Add precise
   routine-edit operations and one validated batch tool for 2-7 routines, with a
   separate review card for each routine.
3. Keep memory local to the thread. Retain recent whole turns within a token
   budget, summarize older messages with source IDs and a stable cursor, and
   preserve the raw archive. Summary failures retain the last valid summary and
   report incomplete earlier context. A durable summarizing phase permits refresh
   and retry recovery. Fresh database state and the latest user request take
   precedence over remembered details.
4. Include a removable screen target with each message: routine, exercise, or
   viewed workout set. Persist it and the user's time zone with the message.
   Scope asynchronous UI updates to the originating thread. Use check-in time
   limits only on the user's current local day.
5. Preserve proposal provenance and durable receipts, including published versus
   draft outcomes. Revising a proposal supersedes the previous card only after
   the replacement passes validation and is stored.
6. Record content-free response usage and failure metadata. Add repeatable
   synthetic evaluations using the production prompt and tool schemas; live
   model calls are opt-in and never mutate application data.

## Validation

Regression tests cover stale response races, replay after interruption, bounded
context and failed summaries, stable target IDs, failed revisions, batch
validation, complete pagination, and late responses after a thread switch.
Run `npm test` for typechecking, architecture boundaries, behavior, and 100%
per-file unit coverage, then `npm run build` for the application bundle.

Release validation is run in an isolated worktree containing only the Coach changes.
The existing exercise settings and set-prefill work remains local and uncommitted.

Release validation on September 6, 2026: `npm test` passed all 478 tests,
typechecking, architecture lint, and 100% per-file coverage. `npm run build`,
`git diff --check`, and the 30-scenario offline catalog passed. Drizzle confirmed
that the isolated migration snapshot matches the schema with no further changes.

## Implemented behavior

The production executor now owns model rounds, processing leases, durable tool
results, repeat limits, proposal recovery, and response cleanup. The obsolete
in-memory loop has been removed. Stable routine and exercise reads may be reused
within a run; active workouts, progress, check-ins, and proposal status stay fresh.

Messages retain the selected screen target and time zone. Drafts and asynchronous
updates belong to their originating chat. Review cards appear with the request
that created them, and handled cards retain readable receipts. Batch proposals
validate every item before staging any cards; each card has its own Apply action.

Conversation context retains complete recent turns using estimated token budgets.
Older summaries include source message IDs and a cursor; raw messages remain in
the archive. Invalid summaries and failed summary saves fall back safely. Retried
requests retain their original conversation snapshot and archive cutoff, while
fresh server state supplies current routine and proposal status.

Migration `0019_naive_puppet_master.sql` adds context snapshots, summary cursors,
proposal provenance, revision links, and draft/publication receipts. It is additive
and follows the published migration chain through 0017. Migration 0018 belongs
to separate, unshipped exercise settings work and is excluded from this release.

## Evaluation

Run `node --import tsx scripts/evaluate-coach.mjs` to validate and list the 30
synthetic scenarios without network calls. The normal test suite also exercises
the harness with injected model responses. It imports the same tool definitions,
prompt, prescription validators, and projections used by production.

For a measured model run, explicitly use
`node --import tsx scripts/evaluate-coach.mjs --live --case progression --model <model-id>`
with `OPENAI_API_KEY` set. Omitting `--case` runs all scenarios and incurs model
usage. Results include attempted tools, arguments, outputs, duplicate calls,
token usage when available, elapsed time, automatic checks, and a human review
criterion. Do not equate automatic checks with coaching quality: compare model
traces and answers against the rubric before changing the default model.

The evaluation adapters use synthetic data and never write application state.
Unsupported synthetic mutations return an error. Production D1 transactions,
concurrency, refresh recovery, and approvals are verified separately by the
integration suite. No live model evaluation was performed.

An ambiguous provider timeout may still cause repeated model computation when
the response ID never reaches the app. Local proposal reservations prevent that
from duplicating staged changes.
