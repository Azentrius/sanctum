#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Injects CI build metadata into environment.prod.ts before production builds.
 * buildNumber = Android versionCode (matches App.getInfo().build / source-map release).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { androidVersionCodeFromSemver } = require('./lib/android-version-code.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);

const buildNumber = String(androidVersionCodeFromSemver(pkg.version));
const buildDate = new Date().toISOString().split('T')[0];

let buildCommit = process.env.GIT_COMMIT ?? process.env.GITHUB_SHA ?? '';
if (!buildCommit) {
  try {
    buildCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    buildCommit = 'unknown';
  }
}

let env = fs.readFileSync(envPath, 'utf8');
env = env.replace(/buildNumber:\s*'[^']*'/, `buildNumber: '${buildNumber}'`);
env = env.replace(/buildCommit:\s*'[^']*'/, `buildCommit: '${buildCommit}'`);
env = env.replace(/buildDate:\s*'[^']*'/, `buildDate: '${buildDate}'`);
fs.writeFileSync(envPath, env, 'utf8');

console.log(
  `✓ Build metadata injected: versionCode=${buildNumber}, date=${buildDate}, commit=${buildCommit}`,
);
