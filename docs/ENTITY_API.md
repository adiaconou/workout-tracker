# Workout Tracker entity API

All endpoints require the authenticated workout owner. Resources are owner-scoped, IDs are opaque, and deletes archive durable entities instead of destroying referenced history.

## Exercises

- `GET /api/exercises?search=&includeArchived=false`
- `POST /api/exercises`
- `GET /api/exercises/:exerciseId`
- `PATCH /api/exercises/:exerciseId`
- `DELETE /api/exercises/:exerciseId`

Exercise request bodies support `name`, `equipment`, `movementPattern`, `trackingType`, `defaultLoadType`, `sideMode`, `instructions`, and `muscles[]` with `muscleGroup`, `role`, and `weight`.

## Routines

- `GET /api/routines?includeArchived=false`
- `POST /api/routines` with `{ code, version }`
- `GET /api/routines/:routineId`
- `PATCH /api/routines/:routineId` for identity fields
- `DELETE /api/routines/:routineId`
- `GET|POST /api/routines/:routineId/versions`
- `GET|PATCH|DELETE /api/routines/:routineId/versions/:versionId`
- `POST /api/routines/:routineId/versions/:versionId/publish`

Routine-version bodies contain `focus`, `summary`, `durationMin`, and ordered `exercises[]`. Each placement contains an `exerciseId`, `position`, optional superset metadata, and ordered `sets[]` with structured targets, RIR, rest, type, side mode, and notes. Only draft versions can be changed or removed; publishing makes a version immutable and supersedes the prior version.

## Workouts

- `GET /api/workouts?status=&includeArchived=false`
- `POST /api/workouts` to start a routine instance
- `GET /api/workouts/:workoutId`
- `PATCH /api/workouts/:workoutId` for session metadata or status
- `DELETE /api/workouts/:workoutId`
- `POST /api/workouts/:workoutId/sets` to complete or skip the current set
- `PATCH /api/workouts/:workoutId/sets/:setId` to correct a logged set
- `POST /api/workouts/:workoutId/rest/skip`

Starting a workout materializes its ordered exercise and set rows. Each workout set preserves planned values separately from actual reps, duration, weight, RIR, and rest values.

