# Backup and restore

Back up both `inventory.sqlite` **and** the corresponding `photos/` directory. Photos include originals, full-size images, and thumbnails. The database alone is not a complete backup.

The app's snapshot routine takes a SQLite write lock while snapshotting records and copying referenced photos. Permanent photo cleanup takes the same lock, so backups keep records and files together. Use the provided backup/export paths instead of copying a live database file or its WAL files by hand.

## Download a backup

Open **More → Download a backup** in the app. Save the resulting ZIP on another device or disk. It contains:

- `inventory.sqlite`: a consistent SQLite snapshot.
- `photos/`: all retained photo files, including originals.
- `manifest.json`: backup format, schema version, and export time.
- `README.txt`: a short restore reminder.

The app also exposes a JSON export for inspection, but it does not include photo files and is not a full restore backup. There is no upload/import backup screen; restoring is an administrator operation described below.

The UI ZIP stages a complete snapshot in RAM-backed temporary storage, limited to 512 MB by default. Its free-space check reserves roughly twice the photo bytes plus database space. If a large inventory cannot export there, use a scheduled archive below, which stages on the backup volume instead. `APP_TMP_SIZE` can change temporary capacity, but increasing it also requires enough host memory and an appropriate app memory limit in a private Compose override.

## Scheduled backups

The `backups` service starts five minutes after a healthy app by default, then makes a backup every 24 hours. It keeps the seven newest completed archives unless configured otherwise. Inspect it or request a backup now:

```sh
docker compose logs --tail=100 backups
docker compose exec backups node /app/scripts/backup.mjs
```

Completed archives are named `storage-inventory-<timestamp>-<random>.tar.gz` in the `inventory-backups` named volume. Each includes `manifest.json`, `inventory.sqlite`, and `photos/`. Its manifest records the database's SHA-256, schema version, and photo-file count/bytes. The downloadable ZIP has a different manifest and does not include that SHA-256 field.

Retention accepts 1–7 archives. A failed backup preserves existing completed archives and retries after an hour. Allow enough disk space for the current inventory, a staging snapshot, and the compressed archive as well as retained backups. Both the data and backup volumes are on the same Docker host; copy archives elsewhere to protect against disk failure.

### Copy a scheduled archive off the server

These administration examples use a Linux/macOS shell on the Docker host. Run them from the project directory. Windows administrators can use the UI ZIP download or equivalent Docker commands in PowerShell with Windows paths.

This short-lived helper reads the backup volume and lists completed archive names:

```sh
mkdir -p backup-export
docker compose run --name home-inventory-backup-export --no-deps --entrypoint /bin/sh backups -c 'ls -1 /backups/storage-inventory-*.tar.gz'
```

Replace the example filename below with one from that output. Docker can copy from the stopped helper; copying does not remove the original archive.

```sh
docker cp home-inventory-backup-export:/backups/storage-inventory-REPLACE.tar.gz ./backup-export/
docker rm home-inventory-backup-export
```

Copy the exported file to another device. Only the helper container is removed; its named backup volume remains. If there are no completed archives yet, run the manual backup command above first.

## Restore without overwriting your current inventory

Restore into a **new volume**, verify it, then switch the app to it. Keep the old volume and original backup until the restored inventory has been checked. Use the same application release that produced the backup, or a newer compatible release; an older app may reject a newer database schema.

The examples below assume the default `home-inventory:local` image has already been built. If you set `IMAGE_REF`, use that image instead. Pick a unique name in place of `home-inventory-restored-YYYYMMDD` and use that same name throughout. These commands do not delete or overwrite an existing inventory.

### 1. Extract into an empty directory

Create a new, empty `restore-check` directory in the project directory. Extract your ZIP there using your archive tool, or extract a scheduled archive:

```sh
mkdir restore-check
tar -xzf /path/to/storage-inventory-BACKUP.tar.gz -C restore-check
```

Use only a backup you trust. Check that `restore-check/inventory.sqlite`, `restore-check/manifest.json`, and `restore-check/photos/` are present directly inside that directory, without an extra enclosing folder.

### 2. Verify the extracted snapshot

This helper mounts the extracted files read-only. It checks the database, manifest, and referenced photo files. For scheduled archives it also checks the recorded database hash and photo-file totals.

```sh
docker run --rm -i --user 0:0 --entrypoint node --mount type=bind,src="$(pwd)/restore-check",dst=/restore,readonly home-inventory:local - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const base = '/restore';
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
const scheduled = manifest.formatVersion === 1 && manifest.database?.file === 'inventory.sqlite';
const exported = manifest.format === 'home-inventory-backup' && manifest.version === 1;
if (!scheduled && !exported) throw new Error('Unrecognized backup manifest.');
const file = path.join(base, 'inventory.sqlite');
if (!fs.lstatSync(file).isFile()) throw new Error('Database must be a regular file.');
if (scheduled) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hash !== manifest.database.sha256) throw new Error('Database hash mismatch.');
}
const db = new Database(file, { readonly: true, fileMustExist: true });
if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) throw new Error('Database integrity check failed.');
const schema = db.pragma('user_version', { simple: true });
if (schema !== (scheduled ? manifest.database.schemaVersion : manifest.schemaVersion)) throw new Error('Schema differs from manifest.');
const ids = db.prepare('SELECT id FROM photos').all().map(row => row.id);
let count = 0, bytes = 0;
for (const id of ids) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid photo identifier.');
  const directory = path.join(base, 'photos', id);
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Photo directory missing or unsafe.');
  const names = fs.readdirSync(directory);
  for (const required of ['original', 'full.jpg', 'thumb.webp']) if (!names.includes(required)) throw new Error('Incomplete photo: ' + id);
  for (const name of names) {
    const metadata = fs.lstatSync(path.join(directory, name));
    if (!metadata.isFile()) throw new Error('Photo is not a regular file.');
    count++; bytes += metadata.size;
  }
}
if (scheduled && (count !== manifest.photos.count || bytes !== manifest.photos.bytes)) throw new Error('Photo totals differ from manifest.');
console.log('Verified schema', schema, '-', ids.length, 'photos,', count, 'files.');
db.close();
NODE
```

If a check fails, stop here and use another backup. The ZIP has no per-file hash, and scheduled archives hash the database only; these checks detect database corruption and missing/incomplete photos, but are not a cryptographic guarantee for every image. Inspect photos in the temporary app as well.

### 3. Copy into a fresh named volume

Create the new volume, then copy only the database and photos. `volume-nocopy` prevents Docker from populating it from the image. The helper refuses a nonempty destination.

```sh
docker volume create home-inventory-restored-YYYYMMDD
docker run --rm --user 0:0 --entrypoint /bin/sh --mount type=bind,src="$(pwd)/restore-check",dst=/restore,readonly --mount type=volume,src=home-inventory-restored-YYYYMMDD,dst=/data,volume-nocopy home-inventory:local -c 'test -z "$(ls -A /data)" && cp /restore/inventory.sqlite /data/inventory.sqlite && cp -a /restore/photos /data/photos && chown -R 1000:1000 /data && chmod 700 /data /data/photos && chmod 600 /data/inventory.sqlite'
```

### 4. Test before switching the live app

Start a temporary app on the Docker host's loopback interface. It uses the restored volume and does not start AI or scheduled backups:

```sh
docker run --rm -d --name home-inventory-restore-check --user 1000:1000 --read-only --tmpfs /tmp:size=512m,uid=1000,gid=1000,mode=1770 -e INVENTORY_DATA_DIR=/data -e APP_ORIGIN=http://127.0.0.1:18081 -p 127.0.0.1:18081:3000 --mount type=volume,src=home-inventory-restored-YYYYMMDD,dst=/data home-inventory:local
docker logs home-inventory-restore-check
curl -f http://127.0.0.1:18081/api/health
```

Wait for startup, then open `http://127.0.0.1:18081` in a browser on that host, or reach it through an SSH tunnel. Check tote/item counts, a few photos, and taken-out history. If using a newer release, this test may migrate the **restored** database; the original volume remains untouched.

Stop the temporary container once verified. Its `--rm` option removes the container, while the named volume remains:

```sh
docker stop home-inventory-restore-check
```

### 5. Switch to the verified volume

Stop all processes that access the live database. Explicitly selecting the AI profile makes its services available to the stop command even when AI is currently disabled:

```sh
docker compose --profile ai stop ai-worker app backups
```

Create a private `compose.override.yaml` alongside `compose.yaml`, or merge this volume entry into an existing override:

```yaml
volumes:
  inventory-data:
    external: true
    name: home-inventory-restored-YYYYMMDD
```

Check `docker compose config` to confirm the `inventory-data` mount resolves to your verified volume, then start:

```sh
docker compose up -d --build
docker compose ps
```

Open the normal `APP_ORIGIN` from your phone and check the inventory again. Preserve this override alongside `.env` during future updates. The previous data volume is still present; changing the override back to its prior configuration and recreating the stopped services switches back to it. If you changed the server's address, reprint QR labels or keep an old-address redirect.

## Moving to another server

Take an exported ZIP or completed scheduled archive, install Docker and the project on the new server, set its `APP_ORIGIN`, and follow the restore procedure. AI models are not part of inventory backups; download the configured model again if desired. Backups do not include your private `.env`, reverse-proxy configuration, domain settings, or certificates, so save those separately.
