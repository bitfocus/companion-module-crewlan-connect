# CrewLAN Connect

Bitfocus Companion module for CrewLAN Connect.

The module binds to exactly one CrewLAN entity through a CrewLAN entity token. It can set that entity's status, dismiss current alerts, run workspace macros, control Shoutbox listen mute, control talk in push or latch mode, and expose live feedback/variables from the CrewLAN event stream.

Macro buttons are generated from whatever CrewLAN publishes, in the same way status buttons are. A CrewLAN without macro support answers 404 on the macro collection, which the module treats as "no macros" rather than as a failure, so the connection still comes up.

## Configuration

- `Address`: for example `http://192.168.1.20:4848`
- `Connection token`: generated in CrewLAN for the entity that should be controlled
- `Poll fallback interval`: HTTP refresh interval used while the live event stream is unavailable; while the stream is connected the module only reconciles every 30 s

See [companion/HELP.md](companion/HELP.md) for the user-facing documentation.

## Development

```sh
yarn install
yarn lint            # eslint, using the shared Bitfocus config
yarn test            # node:test suite (tests/)
yarn build           # type-check and emit dist/
yarn dev             # rebuild on change while Companion runs the module
yarn package         # build the distributable .tgz with companion-module-build
```

`yarn format` formats the repository with the shared Bitfocus Prettier config, and commits run `lint-staged` through a Husky pre-commit hook. `tsc -p tsconfig.json --noEmit` type-checks the tests as well as the sources.

`scripts/module-version.mjs` holds this project's own release-naming rules (public two-number versions, CrewLAN download tags). Nothing in the repository calls it any more; it is kept for the external release process and covered by `tests/versioning.test.ts`.

## Architecture

- `src/main.ts` — the Companion instance: connection lifecycle, event stream, polling, state and publishing.
- `src/api.ts` — the CrewLAN Public API v1 client: deadlines, error classification and the incremental event-stream parser.
- `src/guards.ts` — runtime type guards applied to every payload at the API boundary.
- `src/button-style.ts` — the shared colour and label maths behind status and macro buttons.
- `src/actions.ts`, `src/feedbacks.ts`, `src/variables.ts`, `src/presets.ts`, `src/config.ts`, `src/upgrades.ts` — the Companion surface.
