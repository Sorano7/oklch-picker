# OKLCH Picker

An OKLCH-based color picker. OKLCH perserves perceived lightness when the hue changes, which can be helpful for color-picking.

Can connect to Clip Studio Paint via Companion Mode, or you can copy-paste the hex value into the program of your choice.

## Installation
### Build From Source
Clone the project:

```
git clone https://github.com/Sorano7/oklch-picker.git
cd oklch-picker
```

Build:

```
pnpm tauri build
```

## CSP Connection
To connect to CSP you will need to first connect from a real device first and capture the handshake:

```
.$tcp_remote_command_protocol_version=1.0.$command=Authenticate.$serial=0
    .$detail=["G#1:2022.12", <token>, <session_id>]..
```

Disconnected and reconnect. You should see a longer token this time. Enter the long `token` and `session_id` into the config, and you should be all set.

Note that while the long `token` persists across sessions, the `session_id` rotates. Every time the session is terminated ("connect with smartphone" unchecked and a new QR code needs to be scanned), you will need to grab the new value again.
