#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Prints the CHANGELOG.md section of a version (the release notes).
 *
 *   node scripts/release-notes.mjs [VERSION] [--require-date]
 *
 * VERSION defaults to the version in package.json. With --require-date the heading must be
 * "## X.Y.Z – YYYY-MM-DD"; the job `test` uses that so every version on main has a dated section.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { changelogSection } from './lib/changelog.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const requireDate = args.includes('--require-date');
const version =
  args.find((a) => !a.startsWith('--')) ??
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const result = changelogSection(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
if (!result) {
  console.error(`CHANGELOG.md has no section "## ${version} – YYYY-MM-DD".`);
  process.exit(1);
}
if (requireDate && !result.date) {
  console.error(`The CHANGELOG.md section of ${version} has no date ("## ${version} – YYYY-MM-DD").`);
  process.exit(1);
}
process.stdout.write(result.body);
