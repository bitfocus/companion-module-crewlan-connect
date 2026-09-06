# CrewLAN Connect

This module connects Bitfocus Companion to one CrewLAN entity through a CrewLAN Connect token. It can set that entity's status, dismiss its alerts, and drive the Shoutbox listen and talk channels.

## Setup

1. In CrewLAN, create a Bitfocus Companion connection for the entity you want to control.
2. Enter the Address, for example `http://192.168.1.25:4848`. A path is kept, so CrewLAN can sit behind a reverse proxy; a trailing `/api` or `/api/v1` is removed for you.
3. Paste the Token.

The token must grant exactly one entity capability. The module does not select or impersonate other CrewLAN entities.

CrewLAN rejects status and Shoutbox changes while the entity is not present in the workspace. Those failures are reported in the connection log and in `last_error`, and they do not drop the connection.

## How updates arrive

State changes are delivered through the CrewLAN live event stream. If the stream drops, the module keeps polling over HTTP at the configured **Poll fallback interval** and re-opens the stream automatically, backing off up to 30 seconds between attempts. While the stream is healthy it only reconciles every 30 seconds, so the poll interval mainly matters when the stream is down.

The `event_stream_connected` variable and the **Connection OK** feedback show the current state. Status and Shoutbox state are cleared while the connection is down, so pair those feedbacks with **Connection OK** if a button must visibly distinguish "offline" from "not active".

## Actions

| Action                    | Notes                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Set My Status             | Pick a status, or type a status id to build the button before the connection is up.    |
| Listen Mute On/Off/Toggle | Toggle re-reads the live state first if the local copy is stale.                       |
| Talk Push Down            | Opens the talk channel. Pair with Talk Push Up on the button release.                  |
| Talk Push Up              | Closes the talk channel. Retried automatically; a final failure is logged as an error. |
| Talk Latch Toggle/On/Off  | Opens or closes the talk channel and keeps it in that state.                           |
| Dismiss Alerts            | Dismisses the alerts currently shown for this entity.                                  |
| Refresh/Reconnect         | Rebuilds the connection. It returns immediately; watch the connection status.          |

Closing the talk channel is the one write that is never allowed to fail quietly. If every retry fails, the module logs an error stating that the microphone may still be live in CrewLAN.

Audio stays in CrewLAN. Companion only controls the live state of the CrewLAN Shoutbox session for the token entity.

## Feedbacks

- **Connection OK** — connected to CrewLAN and the entity snapshot is loaded.
- **Current Status Is** — the selected status is the entity's current status.
- **Current Status Style** — paints the button with the label and colours CrewLAN publishes for the selected status, dimmed while it is not current. It overrides text and colours only, so font size and the top bar stay yours.
- **Listen Enabled**, **Listen Available**, **Listen Muted** — state of the Shoutbox listen channel.
- **Talk Enabled**, **Talk Available** — state of the Shoutbox talk channel.
- **Talk Push Active**, **Talk Latch Active** — talk is active in that specific mode.
- **Talk Active** — talk is active in either mode.
- **Talk Live** — CrewLAN reports the microphone as live on the device.

All feedbacks except Current Status Style are boolean, so they can be styled freely and used as trigger conditions.

## Presets

- **Status** — one button per selectable CrewLAN status, styled in that status's colours and lit while it is the current one.
- **Shoutbox** — Listen Mute Toggle, Talk Push (down and up on one button) and Talk Latch.
- **Alerts** — Dismiss Alerts.

## Variables

| Variable                                                             | Type    | Meaning                                        |
| -------------------------------------------------------------------- | ------- | ---------------------------------------------- |
| `workspace_name`                                                     | text    | Name of the CrewLAN workspace.                 |
| `entity_name`, `entity_position`                                     | text    | Display name and position of the bound entity. |
| `current_status_id`, `current_status_label`, `current_status_motion` | text    | The entity's current status.                   |
| `listen_enabled`, `listen_available`, `listen_muted`                 | boolean | Shoutbox listen channel.                       |
| `talk_enabled`, `talk_available`, `talk_active`, `talk_live`         | boolean | Shoutbox talk channel.                         |
| `talk_control_mode`                                                  | text    | `push`, `latch`, or empty.                     |
| `event_stream_connected`                                             | boolean | The live event stream is open.                 |
| `last_alert`                                                         | text    | The last alert that reached this entity.       |
| `last_error`                                                         | text    | The most recent failure.                       |

Boolean variables are real booleans, so an expression can use `$(crewlan:talk_live)` directly instead of comparing against the text `true`.

The CrewLAN event for an alert carries only its scope and the targeted entities, never the alert text, so `last_alert` records when and how the alert arrived. It clears when Dismiss Alerts runs, and automatically five minutes after the alert.
