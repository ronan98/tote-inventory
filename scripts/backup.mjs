import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { copyInventorySnapshot } from './snapshot.mjs';

const dataDirectory = await realpath(process.env.INVENTORY_DATA_DIR || '/data');
const databasePath = path.join(dataDirectory, 'inventory.sqlite');
const photoDirectory = path.join(dataDirectory, 'photos');
const backupDirectoryInput = path.resolve(process.env.BACKUP_DIR || '/backups');
await mkdir(backupDirectoryInput, { recursive: true, mode: 0o700 });
const backupDirectory = await realpath(backupDirectoryInput);
if (backupDirectory === dataDirectory || backupDirectory.startsWith(dataDirectory + path.sep)) {
  throw new Error('BACKUP_DIR must be outside INVENTORY_DATA_DIR.');
}
const retention = Number(process.env.BACKUP_RETENTION || '7');
if (!Number.isInteger(retention) || retention < 1 || retention > 7) throw new Error('BACKUP_RETENTION must be 1 to 7.');
const archivePattern = /^storage-inventory-\d{8}T\d{9}Z-[0-9a-f]{8}\.tar\.gz$/;
const startedAt = new Date().toISOString();
const baseName = 'storage-inventory-' + startedAt.replace(/[-:.]/g, '') + '-' + randomBytes(4).toString('hex');
const stagingDirectory = path.join(backupDirectory, '.staging-' + baseName);
const partialArchive = path.join(backupDirectory, '.' + baseName + '.tar.gz.partial');
const finalArchive = path.join(backupDirectory, baseName + '.tar.gz');

async function digest(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
async function runTar(argumentsList) {
  await new Promise((resolve, reject) => {
    const child = spawn('tar', argumentsList, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error('tar failed: ' + (signal || 'exit ' + code))));
  });
}

let published = false;
try {
  if (!(await lstat(photoDirectory)).isDirectory()) throw new Error('The photos path must be a real directory.');
  if (!(await lstat(databasePath)).isFile()) throw new Error('The inventory database must be a regular existing file.');
  await mkdir(stagingDirectory, { mode: 0o700 });
  const snapshotPath = path.join(stagingDirectory, 'inventory.sqlite');
  const { schemaVersion, photos } = await copyInventorySnapshot(dataDirectory, stagingDirectory, 512 * 1024 * 1024);
  const manifest = {
    formatVersion: 1,
    startedAt,
    snapshotAt: new Date().toISOString(),
    database: { file: 'inventory.sqlite', sha256: await digest(snapshotPath), schemaVersion },
    photos: { directory: 'photos', count: photos.length, bytes: photos.reduce((sum, file) => sum + file.bytes, 0), snapshot: true },
    restore: 'Stop ai-worker, app, and backup services, extract into an empty directory, verify DB, then mount as /data.'
  };
  await writeFile(path.join(stagingDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await runTar(['-czf', partialArchive, '-C', stagingDirectory, 'manifest.json', 'inventory.sqlite', 'photos']);
  await rename(partialArchive, finalArchive);
  published = true;
  const matchingArchives = [];
  for (const entry of await readdir(backupDirectory, { withFileTypes: true })) {
    if (entry.isFile() && archivePattern.test(entry.name)) matchingArchives.push(entry.name);
  }
  matchingArchives.sort().reverse();
  for (const name of matchingArchives.slice(retention)) {
    const candidate = path.resolve(backupDirectory, name);
    if (path.dirname(candidate) !== backupDirectory) throw new Error('Unsafe retention path.');
    if ((await lstat(candidate)).isFile()) await rm(candidate);
  }
  console.log(JSON.stringify({ success: true, file: finalArchive, bytes: (await stat(finalArchive)).size, photos: photos.length, retained: Math.min(matchingArchives.length, retention), completedAt: new Date().toISOString() }));
} catch (error) {
  console.error('Inventory backup failed:', error.message);
  if (published) console.error('The completed archive remains at', finalArchive);
  process.exitCode = 1;
} finally {
  if (path.dirname(stagingDirectory) !== backupDirectory || !path.basename(stagingDirectory).startsWith('.staging-storage-inventory-')) throw new Error('Unsafe staging cleanup path.');
  await rm(stagingDirectory, { recursive: true, force: true });
  if (!published) await rm(partialArchive, { force: true });
}
