# Remote Server Setup

This directory contains the Python server (`server.py`) used by Biome.

Use these steps when you want to run the server on a different machine than the Biome desktop client.

## 1. Sync dependencies

From this directory:

```bash
uv sync
```

## 2. Run the server

Bind to all interfaces so other devices can connect:

```bash
uv run server.py
```

That will setup the server with defaults `--host 0.0.0.0 --port 7987`, however if you wish to change any of those go ahead, and update the `--port` value in Biome client settings accordingly.

## 3. Network and port forwarding

For LAN-only use:

- Allow inbound TCP on port `7987` (or your chosen port) in the host machine firewall.
- Connect from client using `ws://<server-lan-ip>:7987/ws`.

For internet/WAN access:

- Configure router/NAT port forwarding: external TCP port -> server device LAN IP + server port.
- Allow the same port in the server machine firewall.
- Connect from client using `ws://<public-ip-or-domain>:<port>/ws`.

## 4. Configure Biome client

In Biome settings:

- Set engine mode to hosted **Server** mode.
- Set server URL to your remote endpoint (for example `ws://192.168.1.50:7987/ws`).
