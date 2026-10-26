# CrewLAN Connect

This module connects Companion to one CrewLAN entity through a CrewLAN Connect token. It can set
that entity's status, dismiss its alerts, run the workspace macros, and drive its Intercom: Global
Talk, the Output and Input mutes, a Talk and a Mute for every group the entity is in, and
answering, talking in and hanging up a direct call.

Audio stays in CrewLAN. Companion only controls the Intercom of the entity the token belongs to; it
sends and receives no audio of its own.

## Which CrewLAN it works with

The module speaks the CrewLAN integration API, `/api/v2`, wherever the workspace serves it, and the
Public API v1 otherwise. It asks `/api/v2` first on every connect, so nothing has to be chosen; the
`api_version` variable says which one the connection speaks, `v2` or `v1`.

Over the Public API v1 — a CrewLAN v1 workspace — the connection keeps statuses, macros, alerts and
the one Global Talk and Output. Input, the groups and direct calls need a workspace that serves
`/api/v2`; over v1 their actions change nothing and say so in the connection's log. The _Direct_
buttons need a CrewLAN whose `/api/v2` reports the direct call; an earlier one shows no call.

## Setup

1. In CrewLAN, create a Bitfocus Companion connection for the entity you want to control.
2. **Address** — the CrewLAN host including the port, for example `http://192.168.1.20:4848`. A
   path is kept, so CrewLAN can sit behind a reverse proxy; a trailing `/api` or `/api/v1` is
   removed for you, as are any credentials in the address.
3. **Connection token** — paste the token CrewLAN generated. It is stored in Companion's secret
   store, not in the connection config.
4. **Poll fallback interval (ms)** — leave at 5000 unless you have a reason to change it. See
   below.

The token must grant exactly one entity capability, as a CrewLAN connection's token always does.
This module never selects or impersonates
another CrewLAN entity, so a token that grants none or several is rejected.

## How updates arrive

State changes are delivered through the CrewLAN live event stream, so buttons react immediately.
The **Poll fallback interval** only matters while that stream is down: the module then refreshes
over HTTP at that interval and keeps re-opening the stream, backing off up to 30 seconds between
attempts. While the stream is healthy the module reconciles every 30 seconds, or at the poll
interval if you set it longer than that.

## Using it

**Offline at a glance.** Every ready-made button is dark grey with light grey text while the
connection is not up — the connection is disabled in Companion, the workspace cannot be reached,
the token is refused or paused — and while the entity is not present at a CrewLAN Client. CrewLAN
accepts a connection's presses only while its entity is present at a Client, and the connection
stays up meanwhile. A press CrewLAN refuses for that reason greys the buttons at once. Without
one, they turn grey within about 45 seconds after the entity's last Client closed: CrewLAN's
15-second grace, plus up to 30 seconds until the module's next read, or the poll interval where you
set it longer. They return to their own look over `/api/v2` at any event from CrewLAN, the
stream's resync after the entity returns included, an accepted press, an audio connection of the
entity (seen within about a second) or a later status change; over the Public API v1 at an
accepted press or a later status change. Companion's preset list shows each button in its own
look. A Talk or Answer button is greyed the same way while it cannot work: while no CrewLAN Client
of the entity has its audio open. _Direct: Answer_ is grey while nobody rings, and the direct
call's Talk buttons while no call is active. A group's buttons grey once the entity is no longer in
the group.

The grey look lives in the presets: a preset's base style is the grey, and its feedbacks paint the
ordinary look while the button can work. Only **Connection Ready**, **Group Talk Available**,
**Group Member**, **Direct: Answer Available** and **Direct: Talk Available** depend on that; every
other feedback shows CrewLAN's state at all times. To give a button of your own the grey look, give it dark grey with
light grey text, add **Connection Ready** as its first feedback, painting its ordinary look, and
add it once more as its last feedback, inverted, in the grey, so that no state feedback between
them paints over the grey.

**Buttons placed from presets of a module before 2.0.0 keep their old look** and behave as they
did: they do not turn grey. Drag the preset onto the button again to give it the new look:
Companion's upgrade scripts cannot add a feedback to a button that is already placed, nor change its
base style.

**Statuses.** Every selectable CrewLAN status becomes a ready-made button in the _Status_ preset
section, painted in that status's own colours and lit while it is the current one. The five
built-in CrewLAN statuses are labelled Ready, Attention, Critical, Standby and Offline regardless
of the language CrewLAN runs in; your own custom statuses keep their CrewLAN label exactly.

**Macros.** Every macro CrewLAN publishes as runnable becomes a button in the _Macros_ section. The
text and colours are the macro's own, the button is dimmed while the macro is idle and fully lit
while it runs, and pressing it starts the macro. Macros are one-shot: there is no stop, no pause
and no toggle, and Companion shows no progress or step count. Names, colours, the running state and
the set of macros all update live. A CrewLAN without macro support simply offers no macro buttons.

**Intercom.** The _Intercom_ section starts with _Global Talk (push)_, which talks while it is held,
and _Global Talk (latch)_, which talks until it is pressed again. Then the two mutes: _Output
Mute_, the master mute, which silences every group and every call, and _Input Mute_, the
microphone. Then, for every group the entity is in, a section of its own, _All_ first — the group
everybody is in: _‹group›: Talk (push)_, _‹group›: Talk (latch)_ and _‹group›: Mute_, such as _All:
Talk (push)_. Mute silences that group alone and keeps its level. When the entity joins a group,
its buttons appear in Companion's preset list by themselves, ready to be placed. A renamed group
renames its presets, and a group left or removed takes them away: a button placed from them turns
grey, and a press on it reports an error. Last comes _Direct_, four buttons for the entity's direct
call:

- _Direct: Answer_ is lit orange while somebody rings, names the caller
  (`$(crewlan:intercom_ringing_caller)`) and answers the call. With nobody ringing it is grey, and a
  press sends nothing and logs `Answer: nobody is calling.`
- _Direct: Talk (push)_ talks in the call while it is held, _Direct: Talk (latch)_ until it is
  pressed again. Both name the other side (`$(crewlan:intercom_call_partner)`), light up while the
  call's Talk is on, and are grey while no call is active.
- _Direct: Hang up_ ends the active call, either side's, or cancels the entity's own call while it
  still rings. It is lit green during the call and orange while the entity's own call rings, names
  the other side of either (`$(crewlan:intercom_call_partner)`, empty while somebody rings the
  entity), and with neither call it does nothing.

A caller who joined the Workspace after the connection came up shows by their id until the module
has read their name, a moment later. Over `/api/v2` the module reads the Intercom controls
once a second while connected, so Global Talk's and the groups' Talk availability, _Direct: Answer_
and **Microphone Live** follow the entity's audio connection within about a second. Over the Public
API v1 the section holds Global Talk and Output Mute alone.

Global Talk and the group Talk buttons work during a direct call too, one talk at a time: holding
Global Talk or a group's Talk lets the call's Talk go, and holding the call's Talk lets Global Talk
and every group's Talk go. Answering does the latter, as CrewLAN opens the call's Talk, latched, on
both sides. Nothing comes back by itself — press the button again to talk there. The call stays up
meanwhile; CrewLAN ends it once neither side has held the call's Talk for 20 seconds.

Letting a Talk go is the one write this module never lets fail quietly, and CrewLAN always accepts
it: it is retried, and if every attempt fails it logs an error saying the microphone may still be
live in CrewLAN.

**Alerts.** The _Alerts_ section ships a Dismiss Alerts button. The `last_alert` variable records
when an alert arrived and whether it was for the whole workspace or for this entity, not what it
said. It clears when you press Dismiss Alerts, and automatically five minutes after the alert.

You are not limited to the ready-made buttons. All actions, feedbacks and variables this connection
provides are listed in Companion's own action, feedback and variable pickers. The boolean variables
are published as real booleans, so an expression can use `$(crewlan:talk_live)` directly instead of
comparing it against the text `true`.

## Troubleshooting

**The connection says "Authentication failure".** The token was rejected, or it does not grant
exactly one entity. The connection list deliberately shows only a generic message so a token can
never appear on a wall-mounted surface; the specific reason is in the connection's log.

On a CrewLAN workspace whose administrator switched the API v1 compatibility mode off
(_Administration_ › _Integrations_), a connection that speaks the Public API v1 shows "Authentication
failure" with CrewLAN's sentence naming the switch, and the module tries again every 60
seconds. This module speaks `/api/v2` on such a workspace and is not affected; a module
before 2.0.0 is.

**Every button is grey, but the token is right.** The entity is not present at a CrewLAN Client:
its status is Offline, or CrewLAN refused a press with `CrewLAN rejects actions while the entity is
not present.` The connection stays up. Once the entity is present at a Client again, the buttons
come back at the next sign of it that _Offline at a glance_ lists; over the Public API v1 that is a
later status change or a press CrewLAN accepts, so a press is worth a try. A press meanwhile is
refused because the entity is not present, never as a revoked token, and letting go of a held Talk
is still accepted.

**The connection says "Bad configuration".** Either the connection is not filled in yet — the
status line then names the setting, for example `Connection token is required.` — or CrewLAN
answered 400 or 404, in which case the Address is wrong: it must be the CrewLAN host, not a page
inside it. A workspace whose edition offers no Connect answers 404 to both APIs and shows the same.
The module reads such an Address again every 60 seconds. A connection that is only missing its
settings is not retried in the background; it comes up as soon as you save them.

**The connection says "Connection failure".** CrewLAN could not be reached, answered too slowly, or
sent something that is not a CrewLAN API. The module keeps retrying by itself, backing off to one
attempt every 30 seconds.

**A button reports an error but the connection stays up.** CrewLAN rejected that one write. The most
common cause is that the entity is not currently present in the workspace, which CrewLAN refuses;
the log line says so, the message is also in the `last_error` variable, and the buttons turn grey.
A direct call's Talk pressed without an active call is refused (`409 intercom_no_call`), and so is
_Direct: Answer_ once the call stopped ringing (`409 intercom_not_ringing`). A group's button
reports an error when the entity is no longer in that group. Action failures never take the connection down.

**Buttons went dark rather than grey.** They were placed from presets of a module before 2.0.0 and
behave as they did — drag the preset again (see _Using it_). Status and Intercom state are cleared
while the connection is down, so that no button keeps claiming a live microphone against a host
that is gone; on such a button a dark talk button means either "not talking" or "offline". Pair it
with the **Connection OK** feedback if a button of your own has to show the difference. Macro
buttons stay in place but stop claiming to run.

**Nothing updates, but the connection is fine.** Check the `event_stream_connected` variable. If it
is false, the live stream is down and the module is polling at the fallback interval; state is
still correct, just slower.

Use the **Refresh/Reconnect** action to rebuild the connection by hand. It returns immediately, so
watch the connection status rather than the button.
