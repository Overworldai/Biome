# Remote Server Setup

This directory contains the Python server used by Biome. The CLI entry
point is `main.py`; the FastAPI router lives in `server/routes.py`, the
WebSocket protocol in `server/protocol.py`, and the per-connection runtime
in `server/session/`.

Use these steps when you want to run the server on a different machine than the Biome desktop client.

## Requirements

- A supported GPU with sufficient VRAM — see the [main README](../README.md#installation) for details.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) package manager.

## 1. Run the server

From this directory, bind to all interfaces so other devices can connect:

```bash
uv run main.py
```

That will setup the server with defaults `--host 0.0.0.0 --port 7987`, however if you wish to change any of those go ahead, and update the `--port` value in Biome client settings accordingly.

## 2. Network and port forwarding

For LAN-only use:

- Allow inbound TCP on port `7987` (or your chosen port) in the host machine firewall.
- Connect from client using `http://<server-lan-ip>:7987`.

For internet/WAN access:

- Configure router/NAT port forwarding: external TCP port -> server device LAN IP + server port.
- Allow the same port in the server machine firewall.
- Connect from client using `http://<public-ip-or-domain>:<port>`.

## 3. Configure Biome client

In Biome settings:

- Set engine mode to hosted **Server** mode.
- Set server URL to your remote endpoint (for example `http://192.168.1.50:7987`).
