# Testing policy

The project has two complementary verification layers.

1. **Unit coverage:** deterministic domain rules, models, controllers, parsers,
   formatters, policies, and services maintain 100% statements, branches,
   functions, and lines per file.
2. **Boundary behavior:** React Native screens, Expo/Cloudflare entrypoints,
   HTTP routes, and D1/SQL adapters are tested through public behavior.
   Business decisions must not remain hidden in these shells; extract them into
   an in-scope unit module.

## Coverage scope

Coverage includes `src/**/*.ts` by default. This is deliberately a broad
default: a newly added executable TypeScript module enters the denominator
without anyone remembering to update a positive whitelist. `all: true` also
reports an in-scope module as uncovered when no test imports it.

The exact-file exclusions in `.c8rc.json` are limited to:

- native/web platform adapters and re-export shims;
- type-only contracts, entities, and repository interfaces;
- static catalogs and design tokens;
- thin routes, composition roots, and the Worker entrypoint;
- database and external-service adapters covered through boundary behavior.

Exclusion globs are forbidden. The architecture lint rejects broad, duplicate,
or stale exclusions and rejects any attempt to lower the 100% per-file
thresholds. If a new boundary file needs exclusion, keep the path exact, keep
the file thin, and ensure its decisions are covered through extracted units or
public behavioral tests.

## Test design

- Test public behavior, including meaningful success, edge, and error paths.
- Prefer deterministic injected dependencies over global mocks.
- Do not test private helper names, implementation source text, or generated
  source strings. Those tests prevent safe refactoring without protecting
  behavior.
- A bug fix should add a regression test that fails for the observed behavior.
- Type-only declarations, static data, and barrel entrypoints do not need
  artificial tests merely to create counters.

The test runner recursively discovers `tests/**/*.test.{mjs,ts}` itself instead
of relying on shell glob expansion, so the same command works on Windows,
macOS, and Linux.

## Commands

Use Node 22.13 or newer, matching `package.json`:

```sh
npm test
npm run test:run
npm run lint:architecture
```

`npm test` is the required gate. It typechecks, runs the architecture lint, runs
the complete test suite, and enforces 100% per-file coverage. `test:run` is a
faster behavioral-only diagnostic command; it is not a substitute for the
required gate.
