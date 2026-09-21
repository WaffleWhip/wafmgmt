/**
 * Snapshot SQLite databases with VACUUM INTO (WAL-safe, no downtime needed).
 *
 * Usage:
 *   bun run backup:dbs                 # uses env paths below
 *   bun run backup:dbs -- --keep-days 7
 *
 * Env:
 *   DATA_DIR              default /data
 *   BACKUP_DIR            default <DATA_DIR>/backups
 *   BACKUP_KEEP_DAYS      default 14
 *   CORE_DB_PATH          default <DATA_DIR>/core/wafmgmt.db
 *   IDENTITY_DB_PATH      default <DATA_DIR>/identity/identity.db
 *   USP_DB_PATH           default <DATA_DIR>/usp/wafmgmt.db
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { basename, dirname, join } from "path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, "backups");

const args = process.argv.slice(2);
const keepArg = args.indexOf("--keep-days");
const KEEP_DAYS = Number(
  (keepArg !== -1 ? args[keepArg + 1] : undefined) ?? process.env.BACKUP_KEEP_DAYS ?? 14
);

const TARGETS = [
  process.env.CORE_DB_PATH || join(DATA_DIR, "core", "wafmgmt.db"),
  process.env.IDENTITY_DB_PATH || join(DATA_DIR, "identity", "identity.db"),
  process.env.USP_DB_PATH || join(DATA_DIR, "usp", "wafmgmt.db"),
];

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function pruneOldBackups(): number {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of readdirSync(BACKUP_DIR)) {
    const match = file.match(/^(.*)-(\d{8}-\d{6})\.db$/);
    if (!match) continue;
    const [, , stamp] = match;
    const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}`;
    if (new Date(iso).getTime() < cutoff) {
      unlinkSync(join(BACKUP_DIR, file));
      removed++;
    }
  }
  return removed;
}

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = timestamp();
let snapshots = 0;

for (const target of TARGETS) {
  if (!existsSync(target)) {
    console.log(`[-] skip (not found): ${target}`);
    continue;
  }
  const base = basename(target).replace(/\.db$/i, "");
  const parent = basename(dirname(target));
  const label = parent && parent !== base ? `${parent}-${base}` : base;
  const out = join(BACKUP_DIR, `${label}-${stamp}.db`);
  try {
    const db = new Database(target, { readonly: true });
    db.run(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    db.close();
    const size = (statSync(out).size / 1024 / 1024).toFixed(1);
    console.log(`[+] ${target} -> ${out} (${size} MB)`);
    snapshots++;
  } catch (err: any) {
    console.error(`[x] failed to snapshot ${target}: ${err.message}`);
    process.exitCode = 1;
  }
}

const pruned = pruneOldBackups();
console.log(`[+] ${snapshots} snapshot(s) written, ${pruned} old backup(s) pruned (keep ${KEEP_DAYS} days)`);
