#!/bin/sh
set -eu
startup_delay="${BACKUP_STARTUP_DELAY_SECONDS:-300}"
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
case "$startup_delay" in ''|*[!0-9]*) echo 'Invalid backup startup delay.' >&2; exit 1 ;; esac
case "$interval" in ''|*[!0-9]*) echo 'Invalid backup interval.' >&2; exit 1 ;; esac
if [ "$startup_delay" -gt 86400 ] || [ "$interval" -lt 3600 ] || [ "$interval" -gt 604800 ]; then
  echo 'Startup delay must be at most a day; interval must be 1 hour to 7 days.' >&2
  exit 1
fi
child=""
trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null || true; fi; exit 0' INT TERM
pause() {
  sleep "$1" &
  child=$!
  wait "$child" || true
  child=""
}
pause "$startup_delay"
while :; do
  node /app/scripts/backup.mjs &
  child=$!
  if wait "$child"; then
    echo 'Inventory daily backup completed.'
  else
    echo 'Inventory backup failed; see the preceding error. Retrying in one hour.' >&2
    child=""
    pause 3600
    continue
  fi
  child=""
  pause "$interval"
done
