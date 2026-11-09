# SPROUT Web Lab server image: the web app plus arduino-cli with the AVR core, so the server can
# compile students' sketches. The browser uploads the compiled program to the board (Web Serial).
#
#   docker build -t sprout-weblab .
#   docker run -p 8080:8080 -v sprout-data:/data -e SPROUT_GUEST=1 sprout-weblab
#
# On Render this file is built automatically (see render.yaml and deploy/README.md).

FROM python:3.12-slim

ARG ARDUINO_CLI_VERSION=1.1.1
ARG AVR_CORE=arduino:avr@1.8.6

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# arduino-cli and the AVR core (same versions as the lab laptop), in /opt/arduino.
# The build cache goes there too: its default is under $HOME, which the app user may not own.
RUN curl -fsSL "https://downloads.arduino.cc/arduino-cli/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" \
      | tar -xz -C /usr/local/bin arduino-cli \
 && mkdir -p /opt/arduino/data /opt/arduino/user /opt/arduino/cache \
 && printf 'directories:\n  data: /opt/arduino/data\n  downloads: /opt/arduino/data/staging\n  user: /opt/arduino/user\nbuild_cache:\n  path: /opt/arduino/cache\n' \
      > /opt/arduino/arduino-cli.yaml \
 && arduino-cli --config-file /opt/arduino/arduino-cli.yaml core update-index \
 && arduino-cli --config-file /opt/arduino/arduino-cli.yaml core install "${AVR_CORE}" \
 && rm -rf /opt/arduino/data/staging

WORKDIR /app
COPY deploy/requirements.txt deploy/requirements.txt
RUN pip install --no-cache-dir -r deploy/requirements.txt

COPY pyproject.toml README.md ./
COPY src src
COPY cards cards
COPY config config
COPY skills skills
COPY prompts prompts
RUN pip install --no-cache-dir --no-deps -e .

# Compile once at build time: proves the toolchain works and warms arduino-cli's caches.
RUN printf 'void setup(){}\nvoid loop(){}\n' > /tmp/warm.ino \
 && mkdir -p /tmp/warm && mv /tmp/warm.ino /tmp/warm/warm.ino \
 && arduino-cli --config-file /opt/arduino/arduino-cli.yaml compile -b arduino:avr:uno /tmp/warm \
 && rm -rf /tmp/warm

# The app runs as an unprivileged user; the entrypoint only fixes ownership of the data disk.
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data \
 && chown -R app:app /opt/arduino /data /app
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV SPROUT_HOME=/app \
    SPROUT_ARDUINO_CLI=/usr/local/bin/arduino-cli \
    SPROUT_ARDUINO_CLI_CONFIG=/opt/arduino/arduino-cli.yaml \
    SPROUT_DATA_DIR=/data \
    SPROUT_HOST=0.0.0.0 \
    SPROUT_UI_SHOW=0 \
    SPROUT_PUBLIC=1 \
    SPROUT_TRUST_PROXY=1 \
    PORT=8080 \
    PYTHONUNBUFFERED=1

EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sprout", "run"]
