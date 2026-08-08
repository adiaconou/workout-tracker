# Architecture

This project uses feature verticals at the client and server edges, with a
small horizontal domain at the center. Most feature work should remain inside
one vertical. Shared workout concepts stay independent of React, HTTP,
databases, and deployment infrastructure.

## Source tree

All authored runtime TypeScript and TSX belongs under `src/`:

```text
src/
  app/          Expo Router entries and composition
  client/       Client feature verticals plus client infrastructure
  contracts/    Type-only transport shapes shared by client and server
  domain/       Framework-free business objects and decisions
  server/       Server capability verticals and infrastructure adapters
  worker.ts     Thin Cloudflare Worker entry point
```

Tests and developer scripts stay in `tests/` and `scripts/`. Root TypeScript is
limited to configuration and declaration files. Generated output,
dependencies, and migration artifacts are not authored runtime source.

Client folders such as `client/routines/`, `client/workouts/`, and
`client/exercises/` own their screens, controllers, and view models. Server
capability folders keep request policy and use-case orchestration close to the
capability they serve. Cross-feature business concepts—exercises, routines,
prescriptions, workouts, profiles, and recommendations—belong in `domain/`
when they are independent of delivery and persistence.

`contracts/` is deliberately narrow. It contains only types for data crossing
the client/server boundary and may use only type-only imports. It is not a
general shared-utilities folder. A business concept without transport concerns
belongs in `domain/`; the contract can reference its type.

## Layer dependency rule

Internal imports must follow this table:

| Source | Allowed internal targets |
| --- | --- |
| `domain` | `domain` |
| `contracts` | `contracts`, `domain` |
| `client` | `client`, `domain`, `contracts` |
| `server` | `server`, `domain`, `contracts` |
| `app` | `app`, `client`, `domain`, `contracts` |
| `worker` | `worker`, `server` |

Domain and contracts may not import external packages. Client, app, server,
and worker code may import packages appropriate to their runtime.

Consequences:

- Domain code cannot import UI, API clients, server services, persistence,
  environment bindings, or worker code.
- Client code cannot reach into server implementations. Move a business type
  to `domain/` or a wire type to `contracts/`.
- Server code cannot import client or Expo route code.
- Expo route files compose client features but cannot call server
  implementations directly.
- The worker remains a deployment adapter that delegates to the server layer.
- Files in unsupported `src/` folders fail the lint, preventing a new catch-all
  folder from bypassing the graph.

## Feature locality

Layer boundaries alone are too coarse, so feature-level rules also apply.

On the client, `api/` and `ui/` are shared technical infrastructure. Every
other first-level folder under `client/` is a feature. A feature can freely use
its own files, domain/contracts, and client infrastructure. If it needs another
feature, it must import a named export from that feature's root `public.ts`.
Client infrastructure may not depend on a feature.

On the server, root files are technical composition and `db/` is persistence
infrastructure. Other first-level folders are capabilities. Cross-capability
imports use the target capability's root `public.ts`. Only
`server/router.ts` and `server/services.ts` may compose capability internals
directly.

Public entrypoints are intentionally narrow. Add one only after another feature
has a real consumer, export named capabilities rather than whole folders, and
do not create nested barrels. The linter also rejects client or server feature
dependency cycles, including cycles that go through public entrypoints.

The compatibility store currently has one known inversion:
`server/db/training-store.ts` imports the root service composition. That exact
legacy edge remains visible and allowed while the store is split by capability;
new database-to-service or database-to-feature edges are not allowed.

## Placement decision

Use the narrowest owner:

1. Screen/component state and display formatting stay in the client feature.
2. Request parsing and authorization stay in the server capability route or
   request policy.
3. Capability use cases stay in the server capability service.
4. Pure business state and rules shared by features go to `domain/`.
5. Client/server payload types go to `contracts/`.
6. Client-wide technical code must have an explicit owner such as `api/` or
   `ui/`; do not add a generic shared folder.
7. Server persistence belongs in `server/db/`; deployment composition belongs
   in server root files or `worker.ts`.

Promote code horizontally only after multiple features genuinely need the same
stable concept. Similar-looking feature code is not automatically shared code.

## Mechanical enforcement

Run the read-only architecture lint from the repository root:

```powershell
npm run lint:architecture
```

The lint:

- checks source placement and the layer dependency matrix;
- rejects package imports from domain/contracts and runtime code in contracts;
- resolves relative imports and effective `tsconfig` aliases, including
  TypeScript/TSX extensions, directory indexes, and React Native platform
  variants;
- requires cross-feature imports to use `public.ts` and rejects feature cycles;
- rejects source-tree symlinks and unresolved local imports;
- verifies that coverage remains broad-by-default, per-file, and 100%, with
  only exact existing source-file exclusions.

It scans static imports, re-exports, import types, dynamic imports, and
`require` calls. It reports all violations before returning a non-zero exit
code. Do not add a lint exception for a dependency that is inconvenient to
move; fix the ownership instead.

The one source-scan exception is the pre-existing user-owned
`src/features/routines/routine-detail-screen (1).tsx` scratch copy. It is also
explicitly excluded from TypeScript. It is preserved as an artifact and is not
part of the runtime graph; no folder-wide exception exists.

## Adding a feature

1. Create the narrow client and/or server vertical.
2. Keep its UI, models, request policy, and service logic local.
3. Reuse horizontal domain concepts and transport contracts directly.
4. If an existing feature must expose something, add the smallest named export
   to its `public.ts` rather than importing its internal file.
5. Extract deterministic branches from screens, routes, and adapters into a
   covered `.ts` module.
6. Add behavioral tests and run `npm test`.

Adding a typical feature should change its own vertical, tests, and at most one
small public entrypoint or horizontal concept.
