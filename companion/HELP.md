# CrewLAN Connect

This module connects Bitfocus Companion to one CrewLAN entity through a CrewLAN Connect token.

## Setup

1. In CrewLAN, create a Bitfocus Companion connection for the entity you want to control.
2. Enter the Address, for example `http://192.168.1.25:4848`.
3. Paste the Token.

The token must grant exactly one entity capability. The module does not select or impersonate other CrewLAN entities.

## Actions

- Set My Status
- Listen Mute On, Off, or Toggle
- Talk Push Down and Talk Push Up
- Talk Latch Toggle, On, or Off
- Dismiss Alerts
- Refresh CrewLAN Data

Audio stays in CrewLAN. Companion only controls the live state of the CrewLAN Shoutbox session for the token entity.
