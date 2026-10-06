#!/bin/sh
set -eu

# Only the named volumes mounted on this one-shot container are initialized.
# Never recurse through existing inventory, backups, or model files.
for inventory_path in /data /data/photos /backups /models; do
  if [ -L "$inventory_path" ]; then
    echo "Refusing a symbolic-link storage path: $inventory_path" >&2
    exit 1
  fi
  mkdir -p "$inventory_path"
  chown 1000:1000 "$inventory_path"
  chmod 700 "$inventory_path"
done

echo 'Inventory storage volumes are ready.'
