// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Finds the section of `version` in a changelog with headings "## X.Y.Z – YYYY-MM-DD"
 * (en dash, a hyphen is accepted too). Returns `{ date, body }` with the text up to the next
 * "## " heading, or null when the version has no heading. `date` is null without a date.
 */
export function changelogSection(text, version) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## ${escaped}(?:\\s+[–-]\\s+(\\d{4}-\\d{2}-\\d{2}))?\\s*$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) {
    return null;
  }
  const date = heading.exec(lines[start])[1] ?? null;
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end < 0) {
    end = lines.length;
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return { date, body: body ? `${body}\n` : '' };
}
