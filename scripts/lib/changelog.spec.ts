// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { changelogSection } from './changelog.mjs';

const changelog = [
  '# Changelog',
  '',
  '## 0.8.0 – 2026-11-02',
  '',
  'Calendar only.',
  '',
  '- First bullet',
  '',
  '## 0.7.1',
  '',
  '- Undated',
  '',
].join('\n');

describe('changelogSection', () => {
  it('returns the date and the text up to the next version', () => {
    expect(changelogSection(changelog, '0.8.0')).toEqual({
      date: '2026-11-02',
      body: 'Calendar only.\n\n- First bullet\n',
    });
  });

  it('reports a section without a date', () => {
    expect(changelogSection(changelog, '0.7.1')).toEqual({ date: null, body: '- Undated\n' });
  });

  it('returns null for a version without a section', () => {
    expect(changelogSection(changelog, '0.9.0')).toBeNull();
  });

  it('does not take a version for the start of a longer one', () => {
    expect(changelogSection('## 0.7.10 – 2026-01-01\n\n- x\n', '0.7.1')).toBeNull();
  });

  it('reads CRLF line endings', () => {
    expect(changelogSection('## 1.0.0 – 2026-01-01\r\n\r\n- x\r\n', '1.0.0')?.body).toBe('- x\n');
  });
});
