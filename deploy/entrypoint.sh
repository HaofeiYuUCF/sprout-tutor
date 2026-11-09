#!/bin/sh
# A freshly attached disk at /data may belong to root: hand it to the app user, then drop root.
set -e
mkdir -p "${SPROUT_DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  chown -R app:app "${SPROUT_DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=app --regid=app --init-groups "$@"
fi
exec "$@"
