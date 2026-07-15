# Workout Tracker

A private, mobile-first workout tracker for a rolling A–D strength program. It includes editable versioned routines, guided set-by-set workouts, durable workout logs, recovery-aware recommendations, and a normalized exercise catalog.

## Architecture

- `domain/entities/` contains platform-independent Exercise, Routine, RoutineVersion, RoutineSet, Workout, WorkoutExercise, and WorkoutSet types.
- `domain/repositories/` defines persistence contracts.
- `application/services/` validates requests and enforces application rules.
- `infrastructure/d1/` implements the contracts with Cloudflare D1, performs compatibility backfills, and materializes workout snapshots.
- `app/api/` exposes authenticated exercise, routine/version, workout, and workout-set APIs.
- `lib/store.ts` is the compatibility facade used by the current workout UI while it dual-writes normalized workout rows.

The entity API is documented in [`docs/ENTITY_API.md`](docs/ENTITY_API.md).

## Data behavior

- Exercises are reusable catalog records with equipment, movement, tracking, load, side-mode, and muscle metadata.
- Routine edits create immutable versions containing ordered exercise placements and individually structured prescribed sets.
- Starting a workout materializes ordered workout-exercise and workout-set rows with planned-value snapshots.
- Actual reps, duration, weight, RIR, and rest remain separate from planned values.
- Deletes archive referenced durable records.
- Existing routine and workout data are backfilled additively; legacy projections remain available during the UI transition.

## Commands

```bash
npm install
npm run dev
npm test
npm run db:generate
```

`npm test` builds the production worker and runs entity validation, prescription, D1 repository, migration, API-contract, workout recommendation, and existing product regression tests.

## Authentication and hosting

Browser pages and APIs use the Sites-provided ChatGPT identity headers and an owner-email authorization check. `.openai/hosting.json` declares the logical D1 binding used when Sites deploys the application.
