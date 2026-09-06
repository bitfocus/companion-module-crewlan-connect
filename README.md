# CrewLAN Connect

Bitfocus Companion module for CrewLAN Connect.

The module binds to exactly one CrewLAN entity through a CrewLAN entity token. It can set that entity's status, dismiss current alerts, run workspace macros, control Shoutbox listen mute, control talk in push or latch mode, and expose live feedback/variables from the CrewLAN event stream.

Macro buttons are generated from whatever CrewLAN publishes, in the same way status buttons are. A CrewLAN without macro support answers 404 on the macro collection, which the module treats as "no macros" rather than as a failure, so the connection still comes up.

## Configuration

- `Address`: for example `http://192.168.1.20:4848`
- `Connection token`: generated in CrewLAN for the entity that should be controlled
- `Poll fallback interval`: HTTP refresh interval used while the live event stream is unavailable; while the stream is connected the module reconciles every 30 s, or at this interval when it is set longer

See [companion/HELP.md](companion/HELP.md) for the user-facing documentation.

## Development

```sh
yarn install
yarn lint            # eslint, using the shared Bitfocus config
yarn check:types     # type-check the sources and the tests
yarn test            # node:test suite (tests/)
yarn build           # type-check and emit dist/
yarn dev             # rebuild on change while Companion runs the module
yarn package         # build the distributable .tgz with companion-module-build
```

`yarn format` formats the repository with the shared Bitfocus Prettier config, and commits run `lint-staged` through a Husky pre-commit hook.

`scripts/module-version.mjs` holds this project's own release-naming rules (public two-number versions, CrewLAN download tags). It is repository tooling for the external release process, is never packaged into the module, and is covered by `tests/versioning.test.ts`.

## Deviations from the module template

The repository is the Bitfocus TypeScript module template. `.gitattributes`, `.prettierignore`,
`.gitignore`, `.yarnrc.yml`, `tsconfig.json` and every `package.json` field the template defines are
unchanged. Two files differ on purpose, and this is why:

- **`tsconfig.build.json`** adds `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. The
  first is **required, not a preference**: `ModuleConfig` has an optional field for the legacy token
  and must extend `JsonObject`, and without the flag that optional field does not satisfy
  `JsonObject`'s index signature. Removing it fails `yarn build` with two `TS2411` errors in
  `src/config.ts`. The second only tightens type-checking and cannot weaken the build.
- **`eslint.config.mjs`** layers two overrides onto `generateEslintConfig(...)`, both scoped to
  `tests/**`: `node:test`'s `describe()`/`it()` return promises that are intentionally not awaited,
  and `eslint-plugin-n` cannot resolve the plain `.mjs` release helper that `versioning.test.ts`
  imports. This is the shape the v1.1.0 module review asked for. The shared Bitfocus config stays
  the single source of rules for `src/`.

Two files are additions rather than changes, so the template's own files stay intact:
`tests/tsconfig.json` holds the type-check for the test suite, and
`.github/workflows/node.yaml` enables the test job the template ships commented out and runs
`yarn check:types` next to it.

`LICENSE` carries the maintainer's copyright line instead of the template's. The licence text itself
is the unmodified MIT text the manifest and `package.json` declare.

## Architecture

- `src/main.ts` — the Companion instance: connection lifecycle, event stream, polling, state and publishing.
- `src/api.ts` — the CrewLAN Public API v1 client: deadlines, error classification and the incremental event-stream parser.
- `src/guards.ts` — runtime type guards applied to every payload at the API boundary.
- `src/button-style.ts` — the shared colour and label maths behind status and macro buttons.
- `src/actions.ts`, `src/feedbacks.ts`, `src/variables.ts`, `src/presets.ts`, `src/config.ts`, `src/upgrades.ts` — the Companion surface.
