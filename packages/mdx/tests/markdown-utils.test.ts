import { expect, it } from 'vitest';
import { extractHeadings, extractSummary, extractSearchableText, parseMarkdownContent } from '../src/utils/markdown';

it('ignores fenced headings and preserves unique nested heading IDs', () => {
    const markdown = '# One\n```md\n# Hidden\n```\n## One\n## One\n# Last';
    expect(extractHeadings(markdown).map(h => h.id)).toEqual(['heading-one', 'heading-one-1', 'heading-one-2', 'heading-last']);
    expect(extractHeadings(markdown, { nested: true })[0].children).toHaveLength(2);
    expect(parseMarkdownContent('~~~\n```\ninside\n~~~\noutside').linesOutsideCode).toEqual(['outside']);
});

it('extracts text without code blocks and preserves structured document summaries', () => {
    const markdown = '# Title\n```\nhidden\n```\nA **bold** [link](https://example.com).';
    expect(extractSummary(markdown)).toBe('A bold link.');
    expect(extractSearchableText(markdown)).toBe('Title A bold link.');
    const json = JSON.stringify({ name: 'Name', summary: 'Summary', pairs: [{ human: 'Question', ai: 'Answer' }] });
    expect(extractSummary(json)).toBe('Summary');
    expect(extractSearchableText(json)).toBe('Name\nSummary\nQuestion\nAnswer');
});
