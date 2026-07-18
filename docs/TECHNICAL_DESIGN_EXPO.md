# Workout Tracker — Expo migration and implementation plan

**Status:** Implementation plan  
**Date:** July 18, 2026  
**Product source of truth:** `PRODUCT_REQUIREMENTS.md`  
**Targets:** Android APK and ChatGPT-hosted web application

## 1. Outcome

The product will use one Expo Router application for Android and web. The
hosted web build and the installed Android app will call the same versioned
Cloudflare Worker API and share the same D1 workout records.

The existing domain entities, application services, D1 repository, canonical
routine seed data, recommendation rules, and immutable workout snapshots remain
the durable core. The Next/Vinext user interface and route handlers are replaced
by:

- Expo Router screens built from React Native primitives.
- An Expo web export served by the existing ChatGPT Sites deployment.
- A framework-neutral Worker API under `/api/v1`.
- Dual authentication: ChatGPT identity headers for the hosted web client and
  Google identity for Android.
- API-issued access and refresh sessions for native clients.

## 2. Architecture

```text
┌─────────────────────────────┐    ┌──────────────────────────────┐
│ Expo app                    │    │ ChatGPT-hosted Expo web app  │
│ Android APK                 │    │ ChatGPT identity headers     │
│ Google Credential Manager   │    │ same-origin API requests     │
└──────────────┬──────────────┘    └──────────────┬───────────────┘
               │ Bearer access token             │ authenticated headers
               └──────────────────┬───────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │ Cloudflare Worker API     │
                    │ /api/v1                   │
                    │ auth + validation + CORS  │
                    └─────────────┬─────────────┘
                                  ▼
               ┌────────────────────────────────────┐
               │ Application services + D1 repo     │
               │ exercises / routines / workouts    │
               │ recommendations / timer state      │
               └──────────────────┬─────────────────┘
                                  ▼
                           ┌──────────────┐
                           │ D1 database  │
                           └──────────────┘
```

## 3. Repository layout

```text
app/                         Expo Router routes
src/
  auth/                      session provider and Google native adapter
  api/                       typed API client and durable pending-write queue
  components/                shared React Native UI primitives
  features/
    routines/                list, recommendation, detail, and editing
    workouts/                guided sets, rest timer, completion
    exercises/               compact searchable library and detail
  theme/                     dark tokens and responsive layout helpers
server/
  api.ts                     versioned Worker HTTP router
  auth.ts                    ChatGPT/Google/API-session authentication
  google.ts                  Google ID-token verification
  sessions.ts                access and rotating refresh-token lifecycle
domain/                      platform-independent entity types
application/                 entity validation and services
infrastructure/d1/           D1 repository and compatibility seeding
lib/                         canonical routines, workout rules, recommendations
worker/index.ts              API and static Expo web entry point
scripts/build-sites.mjs      Expo web + Worker deployment build
```

## 4. Authentication and authorization

### 4.1 Identity model

Both providers map to one internal workout user:

```text
ChatGPT owner email ─┐
                     ├─ app_user.id ─ owner_email ─ existing workout records
Google OIDC `sub` ───┘
```

The existing `owner_email` column remains the data ownership key during this
migration, avoiding a risky rewrite of historical records. New identity tables
provide a stable internal user ID and allow a later owner-key migration.

New tables:

- `app_users`: internal user ID, canonical owner email, display name.
- `auth_identities`: provider, stable provider subject, verified email.
- `auth_sessions`: device session, hashed rotating refresh token, expiration,
  revocation, and last-used timestamps.

### 4.2 Hosted web

1. The Sites dispatcher authenticates the browser with ChatGPT.
2. API requests include the forwarded authenticated-user email.
3. The Worker verifies that the email matches `OWNER_EMAIL`.
4. The Worker ensures the corresponding internal user and returns only that
   user's data.
5. The browser does not store an API bearer or refresh token.

### 4.3 Android

1. The app uses the Android Credential Manager-backed Google sign-in flow.
2. Google returns an ID token whose audience is the configured Web OAuth client.
3. The app sends the ID token to
   `POST /api/v1/auth/google/exchange` over HTTPS.
4. The Worker verifies signature, issuer, audience, expiration,
   `email_verified`, and the owner allowlist.
5. On first successful enrollment, the Worker links Google's stable `sub` to
   the internal workout user.
6. The Worker issues:
   - a 15-minute HMAC-signed access JWT;
   - a random 30-day rotating refresh token tied to the device.
7. Android stores only the refresh token in `expo-secure-store`; the access
   token remains in memory.
8. API calls use `Authorization: Bearer <access token>`.
9. Refresh rotates the stored token. Reuse of a replaced or revoked token is
   rejected.
10. Logout revokes the server session, removes SecureStore state, and signs out
    of the local Google session.

No client secret, permanent owner credential, API signing secret, or database
identifier is included in the APK.

### 4.4 Required runtime configuration

Server-only:

- `OWNER_EMAIL`
- `AUTH_SESSION_SECRET` (at least 32 random bytes)
- `GOOGLE_WEB_CLIENT_ID`

Client-visible:

- `EXPO_PUBLIC_API_BASE_URL` for Android builds
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

Google Cloud also needs an Android OAuth client configured for the Android
package and signing SHA-1, plus the Web OAuth client used as the ID-token
audience. These are deployment credentials, not source-code defaults.

## 5. API design

All new endpoints live under `/api/v1`. IDs are opaque and resources remain
owner-scoped.

### Authentication

- `GET /api/v1/auth/session`
- `POST /api/v1/auth/google/exchange`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

### Application bootstrap

- `GET /api/v1/bootstrap`
  - current user
  - routine summaries
  - Best today recommendation and availability for every routine
  - optional in-progress workout

### Exercises

- `GET|POST /api/v1/exercises`
- `GET|PATCH|DELETE /api/v1/exercises/:exerciseId`

### Routines

- `GET|POST /api/v1/routines`
- `GET|PATCH|DELETE /api/v1/routines/:routineId`
- `GET|POST /api/v1/routines/:routineId/versions`
- `GET|PATCH|DELETE /api/v1/routines/:routineId/versions/:versionId`
- `POST /api/v1/routines/:routineId/versions/:versionId/publish`
- `PATCH /api/v1/routines/:routineId/prescription` for the current
  user-facing aggregate editor; this creates and publishes a new immutable
  version.

### Workouts

- `GET|POST /api/v1/workouts`
- `GET|PATCH|DELETE /api/v1/workouts/:workoutId`
- `POST /api/v1/workouts/:workoutId/sets`
- `PATCH /api/v1/workouts/:workoutId/sets/:setId`
- `POST /api/v1/workouts/:workoutId/rest/skip`
- `POST /api/v1/workouts/:workoutId/complete`

### Error contract

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Human-readable explanation",
    "retryable": false
  }
}
```

Every response carries a request ID. Authentication failures use `401`,
authorization failures `403`, missing records `404`, validation failures `400`,
and conflicts such as another active workout `409`.

## 6. Client behavior

### 6.1 Navigation

- A protected Expo Router route group contains Routines and Exercises tabs.
- Routine, exercise, and active-workout details use stack routes above tabs.
- Android unauthenticated users see Continue with Google.
- Hosted web unauthenticated users see Continue with ChatGPT.
- Deep links such as `/routines/A` and `/workouts/:id` are handled by the same
  router on Android and web.

### 6.2 Data loading

- Screens read through one typed API client.
- Android automatically refreshes an expired access token once and retries the
  original request once.
- Web relies on same-origin ChatGPT authentication and never uses native token
  storage.
- Server responses remain authoritative. Client caches only accelerate display.

### 6.3 Durable set logging

Before sending a complete/skip action, the native client writes an idempotent
pending operation to AsyncStorage. The operation includes workout ID,
prescribed-set ID, entered values, timestamp, and a stable operation ID.

- Success removes the pending operation.
- Network failure retains it, shows Save failed, and exposes Retry.
- App restart rehydrates and retries pending operations in order.
- The backend's workout/set identity constraints prevent duplicate logical set
  records.
- A workout cannot be finalized while local pending set operations remain.

### 6.4 Rest timer

The database stores the authoritative `rest_ends_at` timestamp. The client
derives remaining time from wall-clock time instead of decrement-only state.
This preserves the timer through navigation, backgrounding, refresh, and app
restart. Skip rest updates the last completed set without altering prescribed
rest.

## 7. Migration sequence

### Phase 1 — Platform foundation

1. Replace the Next/Vinext UI build with Expo SDK 57 and Expo Router.
2. Add Android/web application configuration, dark theme, and responsive
   navigation.
3. Add the Worker + Expo web deployment build while retaining
   `.openai/hosting.json`, D1, migrations, and the existing project ID.

### Phase 2 — API extraction

1. Move route behavior into a framework-neutral Worker router.
2. Preserve the existing entity service and repository boundaries.
3. Add `/api/v1`, common errors, request IDs, and CORS for native/local clients.
4. Keep legacy database projections during the client migration.

### Phase 3 — Authentication

1. Add identity/session schema and migration.
2. Add ChatGPT header authentication for hosted web.
3. Add Google ID-token exchange and server verification.
4. Add short access JWTs, rotating refresh tokens, device revocation, and
   SecureStore persistence.
5. Add protected navigation and sign-in/sign-out screens.

### Phase 4 — Feature migration

1. Routines list, Best today recommendation, recovery labels, and active-session
   resume.
2. Routine detail, ordered prescription, versioned manual editing, and safe
   abandon/start confirmation.
3. Guided workout, set validation, complete/skip, rest countdown, skip rest,
   progress, and completion.
4. Compact exercise library with keystroke filtering and exercise details.
5. Durable pending-write queue and retry indicators.

### Phase 5 — Verification and release

1. Unit tests for JWTs, Google-claim validation, refresh rotation, authorization,
   API routing, entity invariants, recommendations, and timer math.
2. Repository integration tests against SQLite/D1-compatible behavior.
3. Expo typecheck and web export.
4. Worker bundle inspection and Sites deployment build.
5. Publish the web build to the existing private Sites project.
6. Configure Google Cloud/EAS signing, build an internal APK, install it on the
   Android phone, and verify Google sign-in against production.

## 8. Acceptance traceability

| PRD requirement | Implementation control |
| --- | --- |
| FR-01 authentication | ChatGPT web auth, Google Android auth, owner allowlist, owner-scoped repository |
| FR-02 canonical routines | Existing canonical seeds and entity backfill retained |
| FR-03 start once | Active-session unique index plus current start/confirm behavior |
| FR-04 prescription details | Shared routine and active-set screens |
| FR-05 actual performance | Typed set API with non-negative validation |
| FR-06 durable set save | D1 transaction path, prescribed-set uniqueness, client pending queue |
| FR-07 timer rules | Existing prescription expansion and timestamp-based client timer |
| FR-08 skip set/rest | Separate set status and rest-skipped mutation |
| FR-09 resume | Durable current set and `rest_ends_at` loaded by workout route |
| FR-10 finish/abandon | Session status API and active-workout confirmation |
| FR-16 recommendation | Existing deterministic 72-hour recovery engine |
| FR-17 entity CRUD | Versioned `/api/v1` exercise/routine/workout routes |

## 9. Release gates

The hosted web release can ship after the Expo web and Worker tests pass because
it continues using existing ChatGPT authentication.

The Android APK requires these user-owned external values before Google login
can work on a physical phone:

1. Google Cloud project and consent configuration.
2. Web OAuth client ID.
3. Android OAuth client for the final package name.
4. SHA-1 fingerprints for the EAS/internal and Play signing certificates.
5. Expo account/EAS project for a cloud-built APK, or a configured local Android
   toolchain.

The code can be completed and the web application deployed before those values
exist. The APK cannot be considered sign-in verified until the final signing
certificate is registered with Google.
