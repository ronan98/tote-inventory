import Database from 'better-sqlite3';
import { copyFile, lstat, mkdir, readdir, realpath, stat, statfs } from 'node:fs/promises';
import path from 'node:path';

// Permanent photo cleanup takes the same SQLite write lock. Copy both records
// and referenced files before releasing it, then compress without blocking edits.
export async function copyInventorySnapshot(dataDirectoryInput, targetDirectory, minimumFreeBytes = 0) {
  const dataDirectory = await realpath(dataDirectoryInput);
  const databasePath = path.join(dataDirectory, 'inventory.sqlite');
  const photoDirectory = path.join(dataDirectory, 'photos');
  if (!(await lstat(databasePath)).isFile() || !(await lstat(photoDirectory)).isDirectory()) {
    throw new Error('Inventory data must contain a regular database and photo directory.');
  }
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const destination = await realpath(targetDirectory);
  if (destination === dataDirectory || destination.startsWith(dataDirectory + path.sep)) {
    throw new Error('Snapshot destination must be outside live inventory data.');
  }
  const guard = new Database(databasePath, { fileMustExist: true });
  let source;
  let snapshot;
  try {
    guard.pragma('busy_timeout = 10000');
    guard.exec('BEGIN IMMEDIATE');
    source = new Database(databasePath, { readonly: true, fileMustExist: true });
    const ids = source.prepare('SELECT id FROM photos ORDER BY id').all().map(row => row.id);
    const files = [];
    for (const id of ids) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid photo identifier.');
      const directory = path.join(photoDirectory, id);
      if (!(await lstat(directory)).isDirectory()) throw new Error('Photo directories must not be symlinks.');
      const names = await readdir(directory);
      for (const required of ['original', 'full.jpg', 'thumb.webp']) {
        if (!names.includes(required)) throw new Error('A referenced photo is incomplete.');
      }
      for (const name of names.sort()) {
        const absolute = path.join(directory, name);
        const metadata = await lstat(absolute);
        if (!metadata.isFile()) throw new Error('Photos must contain only regular files.');
        files.push({ path: path.posix.join('photos', id, name), bytes: metadata.size, absolute });
      }
    }
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    const databaseBytes = (await stat(databasePath)).size;
    const filesystem = await statfs(destination);
    if (Number(filesystem.bavail) * Number(filesystem.bsize) < bytes * 2.05 + databaseBytes * 2 + minimumFreeBytes) {
      throw new Error('Insufficient backup disk headroom; existing archives are preserved.');
    }
    const snapshotPath = path.join(destination, 'inventory.sqlite');
    await source.backup(snapshotPath);
    snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok' || snapshot.pragma('foreign_key_check').length) {
      throw new Error('SQLite snapshot integrity check failed.');
    }
    const schemaVersion = snapshot.pragma('user_version', { simple: true });
    await mkdir(path.join(destination, 'photos'), { mode: 0o700 });
    for (const id of ids) await mkdir(path.join(destination, 'photos', id), { mode: 0o700 });
    for (const file of files) await copyFile(file.absolute, path.join(destination, ...file.path.split('/')));
    return { schemaVersion, photos: files.map(({ path, bytes }) => ({ path, bytes })) };
  } finally {
    snapshot?.close();
    source?.close();
    if (guard.inTransaction) guard.exec('ROLLBACK');
    guard.close();
  }
}
