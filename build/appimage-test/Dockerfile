# Containerised Wayland desktop for end-to-end testing the AppImage.
# Parameterised by distro: --build-arg DISTRO_FAMILY={ubuntu,fedora,arch}.
# Uses sway (headless) + wayvnc + noVNC for browser-based access.

ARG BASE_IMAGE=ubuntu:24.04
FROM $BASE_IMAGE

ARG DISTRO_FAMILY=ubuntu
ENV LANG=C.UTF-8

# Per-distro package installation (sway, wayvnc, terminal, etc.)
COPY setup-${DISTRO_FAMILY}.sh /tmp/setup-distro.sh
RUN chmod +x /tmp/setup-distro.sh && /tmp/setup-distro.sh

COPY start.sh /usr/local/bin/start.sh
COPY biome /usr/local/bin/biome
COPY sway-config /etc/sway/config.d/biome
RUN chmod +x /usr/local/bin/start.sh /usr/local/bin/biome

EXPOSE 5900 6080

CMD ["/usr/local/bin/start.sh"]
