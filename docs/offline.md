# Running Offline

To reproduce issues tied to missing internet access — and to verify the **Offline Mode** toggle in General Settings — you don't need to unplug your machine. Use a network namespace.

```bash
bwrap --dev-bind / / --unshare-net npm run dev
```

- `--dev-bind / /` keeps the root filesystem visible.
- `--unshare-net` creates an isolated net namespace; bwrap sets up loopback automatically, so `ws://localhost:PORT/ws` (the World Engine WebSocket) still works.

**Before running**, do one full online run so the UV binary under `.uv/`, the Python `.venv`, and the HuggingFace model cache are populated.
