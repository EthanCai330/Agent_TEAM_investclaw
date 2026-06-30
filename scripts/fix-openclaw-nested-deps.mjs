#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const rootNodeModules = join(projectRoot, 'node_modules');
const openclawLink = join(rootNodeModules, 'openclaw');

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function safeLstat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function packageDirs(base) {
  if (!existsSync(base)) return [];
  const result = [];
  for (const entry of readdirSync(base)) {
    const full = join(base, entry);
    const stat = safeLstat(full);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
    if (entry.startsWith('@')) {
      for (const scopedEntry of readdirSync(full)) {
        const scopedFull = join(full, scopedEntry);
        const scopedStat = safeLstat(scopedFull);
        if (scopedStat?.isDirectory() && !scopedStat.isSymbolicLink()) result.push(scopedFull);
      }
      continue;
    }
    result.push(full);
  }
  return result;
}

function replaceWithSymlink(target, source) {
  const realSource = safeRealpath(source);
  if (!realSource) return false;
  rmSync(target, { recursive: true, force: true });
  symlinkSync(realSource, target, 'dir');
  return true;
}

function findPnpmPackage(name, versionPrefix) {
  const pnpmDir = join(rootNodeModules, '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const escaped = name.replace('/', '+');
  const candidates = readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(`${escaped}@${versionPrefix}`))
    .map((entry) => join(pnpmDir, entry, 'node_modules', name))
    .filter((entry) => existsSync(join(entry, 'package.json')))
    .sort();
  return candidates.at(-1) ?? null;
}

const openclawDir = safeRealpath(openclawLink);
if (!openclawDir) {
  console.log('[fix-openclaw-nested-deps] openclaw is not installed; skipping.');
  process.exit(0);
}

const nestedNodeModules = join(openclawDir, 'node_modules');
if (!existsSync(nestedNodeModules)) {
  console.log('[fix-openclaw-nested-deps] openclaw nested node_modules not found; skipping.');
  process.exit(0);
}

let fixed = 0;
for (const packageDir of packageDirs(nestedNodeModules)) {
  const stat = safeLstat(packageDir);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
  const hasPackageJson = existsSync(join(packageDir, 'package.json'));
  const isEmpty = readdirSync(packageDir).length === 0;
  if (hasPackageJson && !isEmpty) continue;
  const packageName = relative(nestedNodeModules, packageDir);
  const rootPackage = join(rootNodeModules, packageName);
  if (!existsSync(join(rootPackage, 'package.json'))) continue;
  if (replaceWithSymlink(packageDir, rootPackage)) fixed += 1;
}

const forcedPackages = [
  // OpenClaw imports named ESM exports from these packages. Root hoisting can
  // otherwise select older CJS versions that do not satisfy OpenClaw.
  ['chalk', '5.'],
  ['jiti', '2.'],
  // Some bundled OpenClaw chunks import these by absolute nested paths under
  // openclaw/node_modules. pnpm may hoist them to the project root instead.
  ['undici', ''],
  ['@sinclair/typebox', ''],
  ['proxy-agent-negotiate', ''],
];

for (const [packageName, versionPrefix] of forcedPackages) {
  const source = findPnpmPackage(packageName, versionPrefix);
  if (!source) continue;
  const target = join(nestedNodeModules, packageName);
  if (replaceWithSymlink(target, source)) fixed += 1;
}

console.log(`[fix-openclaw-nested-deps] repaired ${fixed} OpenClaw nested dependency link(s).`);
