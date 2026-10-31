// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Android versionCode from semver: must match sync-version.js and App.getInfo().build.
 * Formula: major * 10000 + minor * 100 + patch (e.g. 0.5.0 → 500).
 */
function androidVersionCodeFromSemver(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return major * 10000 + minor * 100 + patch;
}

/** Sentry/GlitchTip release string used at runtime and for source-map upload. */
function sanctumReleaseString(version, versionCode) {
  return `de.azentrius.sanctum@${version}+${versionCode}`;
}

module.exports = { androidVersionCodeFromSemver, sanctumReleaseString };
