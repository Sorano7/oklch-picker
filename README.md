# OKLCH Picker

An OKLCH-based color picker. Can connect to Clip Studio Paint via Companion Mode.

## CSP Connection
Connect to CSP from a real device and capture the handshake:

```
.$tcp_remote_command_protocol_version=1.0.$command=Authenticate.$serial=0
    .$detail=["G#1:2022.12", <token>, <session_id>]..
```

Both values should be 16 bytes. Reconnect and you will get a much longer token.
Set the following values in `.env`:

```
CSP_TOKEN=<long_token>
CSP_SESSION_ID=<session_id>
CSP_PORT=<your_port>
CSP_HOST=<host> # default: localhost
```
