# Repository steering

Keep this file short. The detailed architecture and testing policies are the
sources of truth in `docs/ARCHITECTURE.md` and `docs/TESTING.md`; read the
relevant sections before changing structure, dependencies, or test scope.

## Architecture

- Put all authored runtime TypeScript and TSX under `src/`. Root TypeScript is
  limited to configuration and declarations; tests and scripts stay in their
  existing top-level folders.
- Start new behavior in the narrowest client or server feature vertical. Do
  not create a generic `shared`, `common`, `utils`, or catch-all feature folder.
- Put framework-free concepts used by multiple features in `src/domain/`.
  Domain code must not import packages, UI, HTTP, persistence, or environment
  APIs.
- Put client/server wire shapes in `src/contracts/`. Contracts contain types
  only and use type-only imports.
- `src/client/api/` and `src/client/ui/` are client infrastructure. Other
  first-level client folders are features. Cross-feature imports must use the
  target feature's narrow `public.ts`; do not broaden a public API speculatively.
- Server root files and `src/server/db/` are infrastructure/composition. Other
  first-level server folders are capabilities. Cross-capability imports must
  use the target capability's narrow `public.ts`.
- Keep Expo routes, the Worker entry, HTTP routes, React screens, and database
  adapters thin. Extract deterministic decisions into covered `.ts` modules.
- Do not add an architecture or coverage exception to make a failing check
  disappear. Move the dependency or isolate the adapter, then document any
  genuinely necessary exact-file exclusion.
- Preserve the user-owned scratch file named in `docs/ARCHITECTURE.md`; it is
  outside the runtime graph and must not become a folder-wide exception.

## Tests and verification

- Test public behavior and meaningful edge/error cases. Do not assert against
  implementation source text, private helper names, or rendered source strings.
- Every executable `.ts` unit is covered at 100% statements, branches,
  functions, and lines. Coverage exclusions are exact boundary/type/data files;
  never add an exclusion glob.
- Use Node 22.13 or newer.
- After code or configuration changes, run `npm test`.
- After architecture or steering documentation changes, run
  `npm run lint:architecture` at minimum.
- After build or routing changes, also run `npm run build`.
