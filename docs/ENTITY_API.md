# Workout Tracker API

The framework-neutral Worker API is versioned under `/api/v1`. Every resource
is owner-scoped and every response includes an `x-request-id` header.

Hosted web calls are authenticated by the ChatGPT identity headers forwarded by
Sites. Native calls use `Authorization: Bearer <access-token>`.

## Authentication

- `GET /api/v1/auth/session`
- `POST /api/v1/auth/google/exchange`
  with `{ idToken, deviceName? }`
- `POST /api/v1/auth/refresh` with `{ refreshToken }`
- `POST /api/v1/auth/logout`

The Google exchange verifies the token signature, issuer, audience, expiry,
verified email, and owner allowlist. It returns a short-lived access token and a
rotating refresh token. Only a hash of the refresh token is stored.

## Bootstrap

- `GET /api/v1/bootstrap`

Returns the current user, routine summaries, recovery-aware recommendations,
and the optional active workout in one request.

## Exercises

- `GET /api/v1/exercises?search=&includeArchived=false`
- `POST /api/v1/exercises`
- `GET /api/v1/exercises/:exerciseId`
- `PATCH /api/v1/exercises/:exerciseId`
- `DELETE /api/v1/exercises/:exerciseId`
- `PUT /api/v1/exercises/:exerciseId/favorite`
- `DELETE /api/v1/exercises/:exerciseId/favorite`

Exercise bodies support `name`, `equipment`, `movementPattern`,
`trackingType`, `defaultLoadType`, `sideMode`, `instructions`, and
`muscles[]`, whose entries contain `muscleGroup`, `role`, and `weight`.

Deletes archive durable exercises rather than destroying referenced workout
history. Favorites are stored separately from the exercise catalog and are
scoped to the authenticated owner. The favorite endpoints are idempotent.

## Routines

- `GET /api/v1/routines?includeArchived=false`
- `POST /api/v1/routines` with `{ code, version }`
- `GET /api/v1/routines/:routineId`
- `PATCH /api/v1/routines/:routineId`
- `DELETE /api/v1/routines/:routineId`
- `GET|POST /api/v1/routines/:routineId/versions`
- `GET|PATCH|DELETE /api/v1/routines/:routineId/versions/:versionId`
- `POST /api/v1/routines/:routineId/versions/:versionId/publish`
- `GET|PATCH /api/v1/routines/:routineId/prescription`

Routine versions contain ordered exercise placements and ordered sets with
target reps or duration, RIR, rest, set type, side mode, and notes. The
aggregate `prescription` patch used by the editor creates and publishes a new
immutable version.

## Workouts

- `GET /api/v1/workouts?status=&includeArchived=false`
- `GET /api/v1/workouts?view=history&from=&to=&routineCode=&status=&exercise=&limit=&offset=`
- `POST /api/v1/workouts`
- `GET /api/v1/workouts/:workoutId`
- `GET /api/v1/workouts/:workoutId/history`
- `PATCH /api/v1/workouts/:workoutId`
- `DELETE /api/v1/workouts/:workoutId`
- `POST /api/v1/workouts/:workoutId/sets`
- `PATCH /api/v1/workouts/:workoutId/sets/:setId`
- `POST /api/v1/workouts/:workoutId/rest/skip`
- `POST /api/v1/workouts/:workoutId/complete`

Starting a workout materializes its ordered exercises and prescribed sets.
Actual reps, duration, weight, RIR, and rest remain separate from the planned
snapshot. Completing or skipping a set accepts `x-idempotency-key`; a retry of
an already-recorded prescribed set returns the current workout instead of
creating a duplicate.

## Errors

Errors use a stable machine-readable envelope:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Human-readable explanation",
    "retryable": false
  }
}
```

Authentication failures use `401`, authorization failures `403`, missing
records `404`, validation failures `400`, and state conflicts `409`.
