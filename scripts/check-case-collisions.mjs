#!/usr/bin/env node
/**
 * Fails if two paths, or two importable modules, differ only by letter case.
 *
 * Linux filesystems are case-sensitive; macOS and Windows are not. A repo
 * holding both `Water.tsx` and `water.ts` therefore builds cleanly on Linux
 * and in CI while failing on every contributor's Mac, where `./Water.js` may
 * resolve to `water.ts` and report a missing export — an error that points at
 * the import rather than at the real cause. Git cannot check out both paths on
 * such a filesystem either, so the working tree reports itself permanently
 * modified.
 *
 * Two distinct collisions matter, and the second is easy to miss:
 *
 *   1. Whole paths equal ignoring case  (`Water.d.ts` / `water.d.ts`)
 *      — git cannot represent both.
 *   2. Module *stems* equal ignoring case within one directory
 *      (`Water.tsx` / `water.ts`) — the extensions differ, so the filenames
 *      are not equal, but an import resolves the extension itself and so
 *      becomes ambiguous.
 *
 * This runs before every build precisely because the platform it protects is
 * not the platform most builds run on.
 */
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Generated or vendored trees; their contents are not ours to rename. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-types', 'build', 'coverage', '.vite']);

/** Extensions a bundler or TypeScript will try when resolving an import. */
const RESOLVABLE = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** @type {Map<string, Set<string>>} lowercased path -> actual paths */
const paths = new Map();
/** @type {Map<string, Set<string>>} dir + lowercased stem -> actual stems */
const modules = new Map();

function record(map, key, value) {
  const bucket = map.get(key);
  if (bucket) bucket.add(value);
  else map.set(key, new Set([value]));
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // a broken symlink is not this check's concern
    }
    const rel = relative(root, full).split(sep).join('/');
    record(paths, rel.toLowerCase(), rel);

    if (stats.isDirectory()) {
      walk(full);
      continue;
    }
    const ext = RESOLVABLE.find((e) => entry.endsWith(e));
    if (!ext) continue;
    const stem = basename(entry, ext);
    const where = dirname(rel);
    record(modules, `${where}/${stem.toLowerCase()}`, stem);
  }
}

walk(root);

const pathHits = [...paths.values()].filter((s) => s.size > 1);
const moduleHits = [...modules.entries()].filter(([, s]) => s.size > 1);

if (pathHits.length === 0 && moduleHits.length === 0) {
  console.log(`case check: ${paths.size} paths, ${modules.size} modules, no collisions`);
  process.exit(0);
}

console.error('\nCase-insensitive collision detected.\n');
for (const hit of pathHits) {
  console.error('These paths are the same file on macOS and Windows:');
  for (const p of hit) console.error(`  ${p}`);
  console.error('');
}
for (const [key, stems] of moduleHits) {
  const where = dirname(key);
  console.error(`These modules in ${where}/ differ only by case, so an import of`);
  console.error('either one is ambiguous on macOS and Windows:');
  for (const stem of stems) console.error(`  ${where}/${stem}`);
  console.error('');
}
console.error('Rename one of each pair so the names differ by more than case.\n');
process.exit(1);
