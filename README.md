# Workout Tracker

A private workout tracker built once with Expo and React Native, then shipped as
both an Android app and a ChatGPT-hosted website. It includes editable versioned
routines, guided set-by-set workouts, durable logs, recovery-aware
recommendations, and a compact exercise library.

The product requirements are in
[`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md). The complete migration,
architecture, security, API, testing, and release plan is in
[`docs/TECHNICAL_DESIGN_EXPO.md`](docs/TECHNICAL_DESIGN_EXPO.md).

## Architecture

```text
Expo Android app ─ Google ID token ─┐
                                    ├─ Cloudflare Worker /api/v1 ─ D1
Expo web app ─ ChatGPT identity ────┘
```

- `app/` contains Expo Router routes for Android and web.
- `src/` contains shared React Native screens, UI, authentication, and API code.
- `server/` and `worker/` expose the framework-neutral `/api/v1` API and serve
  the Expo web export.
- `domain/`, `application/`, and `infrastructure/d1/` contain the shared entity,
  business-rule, and persistence layers.
- `lib/` contains workout execution, recommendation, and canonical routine
  behavior retained from the original app.
- `db/` and `drizzle/` define and migrate the D1 schema.

## Authentication

Each approved account maps to its own internal user and owner-scoped records.
The same person can use either supported client without splitting their data:

- Hosted web requests use the authenticated ChatGPT identity forwarded by
  Sites. No API token is stored in the browser.
- Android uses Google Credential Manager. The app exchanges a Google ID token
  for a 15-minute API access token and a rotating 30-day refresh token.
- Android stores the refresh token in the platform-backed SecureStore; the
  access token stays in memory.
- The API verifies the configured owner allowlist before exposing any data.

Required server configuration:

```dotenv
# Comma-separated additional users; combined with OWNER_EMAIL.
ALLOWED_USER_EMAILS=partner@example.com
OWNER_EMAIL=you@example.com
AUTH_SESSION_SECRET=a-random-secret-of-at-least-32-bytes
GOOGLE_WEB_CLIENT_ID=000000000000-example.apps.googleusercontent.com
```

Required Android build configuration:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://your-site.example
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=000000000000-example.apps.googleusercontent.com
```

Google Cloud must also contain an Android OAuth client for package
`com.adiaconou.workouttracker` and the SHA-1 of the key that signs the APK.
OAuth client IDs are configuration, not secrets. Never put a Google client
secret or `AUTH_SESSION_SECRET` in an Expo public variable.

## Development

Prerequisite: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

That starts Expo for the web UI. Build the hosted Worker bundle before running
the local API:

```bash
npm run build
npm run dev:api
```

For a local Android development build:

```bash
npm run prebuild:android
npm run android
```

The Google native module requires a development build; it does not run inside
Expo Go.

## Verification and release

```bash
npm test
npm run build
npx expo-doctor
```

`npm test` typechecks the shared Expo/Worker source and runs entity,
prescription, D1 repository, migration, authentication, API-contract, and
recommendation tests.

EAS build profiles are defined in `eas.json`:

```bash
npx eas-cli build --platform android --profile preview
```

The `preview` profile produces an installable APK. The `production` profile
produces an Android App Bundle for Play Store distribution.
