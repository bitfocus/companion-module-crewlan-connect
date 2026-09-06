# CrewLAN Connect

This module connects Companion to one CrewLAN entity through a CrewLAN Connect token. It can set
that entity's status, dismiss its alerts, run the workspace macros, and drive the Shoutbox listen
and talk channels.

Audio stays in CrewLAN. Companion only controls the state of the CrewLAN Shoutbox session for the
entity the token belongs to.

## Setup

1. In CrewLAN, create a Bitfocus Companion connection for the entity you want to control.
2. **Address** — the CrewLAN host including the port, for example `http://192.168.1.20:4848`. A
   path is kept, so CrewLAN can sit behind a reverse proxy; a trailing `/api` or `/api/v1` is
   removed for you, as are any credentials in the address.
3. **Connection token** — paste the token CrewLAN generated. It is stored in Companion's secret
   store, not in the connection config.
4. **Poll fallback interval (ms)** — leave at 5000 unless you have a reason to change it. See
   below.

The token must grant exactly one entity capability. This module never selects or impersonates
another CrewLAN entity, so a token that grants none or several is rejected.

## How updates arrive

State changes are delivered through the CrewLAN live event stream, so buttons react immediately.
The **Poll fallback interval** only matters while that stream is down: the module then refreshes
over HTTP at that interval and keeps re-opening the stream, backing off up to 30 seconds between
attempts. While the stream is healthy the module reconciles every 30 seconds, or at the poll
interval if you set it longer than that.

## Using it

**Statuses.** Every selectable CrewLAN status becomes a ready-made button in the _Status_ preset
section, painted in that status's own colours and lit while it is the current one. The five
built-in CrewLAN statuses are labelled Ready, Attention, Critical, Standby and Offline regardless
of the language CrewLAN runs in; your own custom statuses keep their CrewLAN label exactly.

**Macros.** Every macro CrewLAN publishes as runnable becomes a button in the _Macros_ section. The
text and colours are the macro's own, the button is dimmed while the macro is idle and fully lit
while it runs, and pressing it starts the macro. Macros are one-shot: there is no stop, no pause
and no toggle, and Companion shows no progress or step count. Names, colours, the running state and
the set of macros all update live. A CrewLAN without macro support simply offers no macro buttons.

**Shoutbox.** The _Shoutbox_ section ships a Listen Mute toggle, a Talk Push button that opens the
channel on press and closes it on release, and a Talk Latch button. Closing the talk channel is the
one write this module never lets fail quietly: it is retried, and if every attempt fails it logs an
error saying the microphone may still be live in CrewLAN.

**Alerts.** The _Alerts_ section ships a Dismiss Alerts button. The CrewLAN event for an alert
carries only its scope and the entities it targets, never the alert text, so the `last_alert`
variable records when and how the alert arrived rather than what it said. It clears when you press
Dismiss Alerts, and automatically five minutes after the alert.

You are not limited to the ready-made buttons. All actions, feedbacks and variables this connection
provides are listed in Companion's own action, feedback and variable pickers. The boolean variables
are published as real booleans, so an expression can use `$(crewlan:talk_live)` directly instead of
comparing it against the text `true`.

## Troubleshooting

**The connection says "Authentication failure".** The token was rejected, or it does not grant
exactly one entity. The connection list deliberately shows only a generic message so a token can
never appear on a wall-mounted surface; the specific reason is in the connection's log.

**The connection says "Bad configuration".** Either the connection is not filled in yet — the
status line then names the setting, for example `Connection token is required.` — or CrewLAN
answered 400 or 404, in which case the Address is wrong: it must be the CrewLAN host, not a page
inside it. A connection that is only missing its settings is not retried in the background; it
comes up as soon as you save them.

**The connection says "Connection failure".** CrewLAN could not be reached, answered too slowly, or
sent something that is not the Public API. The module keeps retrying by itself, backing off to one
attempt every 30 seconds.

**A button reports an error but the connection stays up.** CrewLAN rejected that one write. The most
common cause is that the entity is not currently present in the workspace, which CrewLAN refuses;
the log line says so, and the message is also in the `last_error` variable. Action failures never
take the connection down.

**Shoutbox buttons all went dark.** Status and Shoutbox state are cleared while the connection is
down, so that no button keeps claiming a live microphone against a host that is gone. That means a
dark talk button means either "not talking" or "offline". Pair it with the **Connection OK**
feedback if a button has to show the difference. Macro buttons stay in place but stop claiming to
run.

**Nothing updates, but the connection is fine.** Check the `event_stream_connected` variable. If it
is false, the live stream is down and the module is polling at the fallback interval; state is
still correct, just slower.

Use the **Refresh/Reconnect** action to rebuild the connection by hand. It returns immediately, so
watch the connection status rather than the button.
