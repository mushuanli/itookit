import { expect, it, vi } from 'vitest';
import { lexer } from 'marked';
import { TaskListPlugin } from '../src/plugins/interactions/task-list.plugin';
import { lineOffsets, lineNumberAt } from '../src/utils/line-offsets';
vi.mock('marked', async importOriginal => {
    const actual = await importOriginal<typeof import('marked')>();
    return { ...actual, lexer: vi.fn(actual.lexer) };
});

it('skips the task lexer without candidates, including after a document with tasks', () => {
    const plugin = new TaskListPlugin();
    plugin.setMarkdown('| task |\n| --- |\n| [ ] todo |');
    expect(lexer).toHaveBeenCalledOnce(); vi.mocked(lexer).mockClear();
    plugin.setMarkdown('lockfileVersion: 9\npackages:\n' + '  dep: 1\n'.repeat(9000));
    expect(lexer).not.toHaveBeenCalled();
    expect((plugin as any).taskLocations).toEqual([]); plugin.destroy();
});

it('keeps AST-based table offsets and excludes checkbox text inside code fences', () => {
    const plugin = new TaskListPlugin();
    const text = '```md\n- [ ] example\n```\n\n| task |\n| --- |\n| [ ] real |';
    plugin.setMarkdown(text);
    expect((plugin as any).taskLocations).toEqual([{ bracketIndex: text.indexOf('[ ] real'), length: 3, isTableTask: true, lineNumber: 7 }]);
    plugin.destroy();
});

it('preserves one-based line numbers for every UTF-16 position, including CRLF and nested task text', () => {
    const text = '# 标题\r\n> - [ ] 引用\r\n  - [x] 子项\n😀\n';
    const starts = lineOffsets(text);
    for (let index = 0; index <= text.length; index++) {
        expect(lineNumberAt(starts, index)).toBe(text.substring(0, index).split('\n').length);
    }
});
