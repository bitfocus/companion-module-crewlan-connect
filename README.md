# CrewLAN Connect

Bitfocus Companion module for CrewLAN Connect.

The module binds to exactly one CrewLAN entity through a CrewLAN entity token. It can set that entity's status, dismiss current alerts, control Shoutbox listen mute, control talk in push or latch mode, and expose live feedback/variables from the CrewLAN event stream.

## Configuration

- `Address`: for example `http://192.168.1.20:4848`
- `Token`: generated in CrewLAN for the entity that should be controlled
- `Poll fallback`: backup refresh interval when the event stream reconnects

## Development

```sh
yarn install
yarn test
yarn lint
yarn build
```
