// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renders a safe subset of Markdown via DOM APIs: no innerHTML from user input.
 */
export function renderSafeMarkdown(container: HTMLElement, source: string): void {
  container.replaceChildren();
  const blocks = parseMarkdownBlocks(source);
  for (const block of blocks) {
    container.appendChild(renderBlock(block));
  }
}

type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string };

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const normalized = source.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeBlock = tryParseCodeBlock(lines, index);
    if (codeBlock) {
      blocks.push(codeBlock.block);
      index = codeBlock.nextIndex;
      continue;
    }

    const headingBlock = tryParseHeading(line);
    if (headingBlock) {
      blocks.push(headingBlock);
      index += 1;
      continue;
    }

    const listBlock = tryParseList(lines, index);
    if (listBlock) {
      blocks.push(listBlock.block);
      index = listBlock.nextIndex;
      continue;
    }

    const paragraphBlock = parseParagraph(lines, index);
    blocks.push(paragraphBlock.block);
    index = paragraphBlock.nextIndex;
  }

  return blocks;
}

function tryParseCodeBlock(
  lines: string[],
  index: number,
): { block: MarkdownBlock; nextIndex: number } | null {
  if (!/^```/.test(lines[index])) {
    return null;
  }
  const codeLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length && !lines[nextIndex].startsWith('```')) {
    codeLines.push(lines[nextIndex]);
    nextIndex += 1;
  }
  return {
    block: { kind: 'code', text: codeLines.join('\n') },
    nextIndex: nextIndex + 1,
  };
}

function tryParseHeading(line: string): MarkdownBlock | null {
  const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
  if (!headingMatch) {
    return null;
  }
  return {
    kind: 'heading',
    level: headingMatch[1].length as 1 | 2 | 3,
    text: headingMatch[2].trim(),
  };
}

function tryParseList(
  lines: string[],
  index: number,
): { block: MarkdownBlock; nextIndex: number } | null {
  if (!/^[-*]\s+/.test(lines[index])) {
    return null;
  }
  const items: string[] = [];
  let nextIndex = index;
  while (nextIndex < lines.length && /^[-*]\s+/.test(lines[nextIndex])) {
    items.push(lines[nextIndex].replace(/^[-*]\s+/, ''));
    nextIndex += 1;
  }
  return { block: { kind: 'list', items }, nextIndex };
}

function parseParagraph(
  lines: string[],
  index: number,
): { block: MarkdownBlock; nextIndex: number } {
  const paragraphLines: string[] = [lines[index]];
  let nextIndex = index + 1;
  while (nextIndex < lines.length && lines[nextIndex].trim() && !isBlockStart(lines[nextIndex])) {
    paragraphLines.push(lines[nextIndex]);
    nextIndex += 1;
  }
  return {
    block: { kind: 'paragraph', text: paragraphLines.join('\n') },
    nextIndex,
  };
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,3}\s+/.test(line) ||
    /^[-*]\s+/.test(line) ||
    line.startsWith('```')
  );
}

function headingTag(level: 1 | 2 | 3): 'h1' | 'h2' | 'h3' {
  if (level === 1) {
    return 'h1';
  }
  if (level === 2) {
    return 'h2';
  }
  return 'h3';
}

function renderBlock(block: MarkdownBlock): HTMLElement {
  switch (block.kind) {
    case 'heading': {
      const el = document.createElement(headingTag(block.level));
      appendInlineMarkdown(el, block.text);
      return el;
    }
    case 'paragraph': {
      const el = document.createElement('p');
      appendInlineMarkdown(el, block.text);
      return el;
    }
    case 'list': {
      const el = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        appendInlineMarkdown(li, item);
        el.appendChild(li);
      }
      return el;
    }
    case 'code': {
      const el = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      el.appendChild(code);
      return el;
    }
  }
}

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const ITALIC_PATTERN = /\*([^*]+)\*/g;

export function appendInlineMarkdown(parent: HTMLElement, text: string): void {
  const tokens = tokenizeInline(text);
  for (const token of tokens) {
    if (token.kind === 'text') {
      parent.appendChild(document.createTextNode(token.value));
      continue;
    }
    if (token.kind === 'bold') {
      const el = document.createElement('strong');
      el.textContent = token.value;
      parent.appendChild(el);
      continue;
    }
    if (token.kind === 'italic') {
      const el = document.createElement('em');
      el.textContent = token.value;
      parent.appendChild(el);
      continue;
    }
    const href = sanitizeLinkHref(token.href);
    if (!href) {
      parent.appendChild(document.createTextNode(token.label));
      continue;
    }
    const el = document.createElement('a');
    el.textContent = token.label;
    el.href = href;
    el.rel = 'noopener noreferrer';
    el.target = '_blank';
    parent.appendChild(el);
  }
}

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'link'; label: string; href: string };

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const linkMatch = LINK_PATTERN.exec(rest);
    LINK_PATTERN.lastIndex = 0;
    const boldMatch = BOLD_PATTERN.exec(rest);
    BOLD_PATTERN.lastIndex = 0;
    const italicMatch = ITALIC_PATTERN.exec(rest);
    ITALIC_PATTERN.lastIndex = 0;

    const candidates = [
      linkMatch ? { match: linkMatch, type: 'link' as const } : null,
      boldMatch ? { match: boldMatch, type: 'bold' as const } : null,
      italicMatch ? { match: italicMatch, type: 'italic' as const } : null,
    ].filter((item): item is { match: RegExpExecArray; type: 'link' | 'bold' | 'italic' } => !!item);

    if (candidates.length === 0) {
      tokens.push({ kind: 'text', value: rest });
      break;
    }

    candidates.sort((a, b) => a.match.index - b.match.index);
    const next = candidates[0];
    const { match, type } = next;
    const start = match.index ?? 0;

    if (start > 0) {
      tokens.push({ kind: 'text', value: rest.slice(0, start) });
    }

    if (type === 'link') {
      tokens.push({ kind: 'link', label: match[1], href: match[2] });
    } else if (type === 'bold') {
      tokens.push({ kind: 'bold', value: match[1] });
    } else {
      tokens.push({ kind: 'italic', value: match[1] });
    }

    rest = rest.slice(start + match[0].length);
  }

  return tokens;
}

export function sanitizeLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed, 'https://example.invalid');
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}
