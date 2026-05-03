# Docker build image for the Biome AppImage. Setup is delegated to
# setup-build-env.sh (shared with CI), split into stages for layer caching.

FROM ubuntu:22.04

# Stage 1: bootstrap (ca-certificates, curl, gnupg).
# Only re-runs when setup-build-env.sh itself changes.
COPY build/appimage/setup-build-env.sh /opt/biome-appimage/
RUN chmod +x /opt/biome-appimage/setup-build-env.sh \
    && /opt/biome-appimage/setup-build-env.sh bootstrap

# Stage 2: Node.js 20 via NodeSource.
# Only re-runs when setup-build-env.sh changes.
RUN /opt/biome-appimage/setup-build-env.sh node

# Stage 3: AppImage build deps from apt-deps.txt.
# Re-runs when apt-deps.txt or install-apt-deps.sh change.
COPY build/appimage/apt-deps.txt build/appimage/install-apt-deps.sh /opt/biome-appimage/
RUN chmod +x /opt/biome-appimage/install-apt-deps.sh \
    && /opt/biome-appimage/setup-build-env.sh deps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["bash", "-c", "npm ci && npm run build"]
