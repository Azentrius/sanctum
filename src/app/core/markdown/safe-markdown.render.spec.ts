// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  appendInlineMarkdown,
  parseMarkdownBlocks,
  sanitizeLinkHref,
  tokenizeInline,
} from './safe-markdown.render';

describe('safe-markdown.render', () => {
  it('parses headings, lists, and code blocks', () => {
    const blocks = parseMarkdownBlocks('# Title\n\n- one\n- two\n\n```\ncode\n```');
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'list',
      'code',
    ]);
  });

  it('tokenizes inline markdown', () => {
    expect(tokenizeInline('**bold** and [link](https://example.com)')).toEqual([
      { kind: 'bold', value: 'bold' },
      { kind: 'text', value: ' and ' },
      { kind: 'link', label: 'link', href: 'https://example.com' },
    ]);
  });

  it('rejects unsafe link protocols', () => {
    expect(sanitizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeLinkHref('https://safe.test/x')).toContain('https://safe.test/x');
  });

  it('renders inline markdown without HTML injection', () => {
    const parent = document.createElement('div');
    appendInlineMarkdown(parent, '<img onerror=alert(1)>');
    expect(parent.innerHTML).not.toContain('<img');
    expect(parent.textContent).toContain('<img onerror=alert(1)>');
  });
});
