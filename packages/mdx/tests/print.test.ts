// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultPrintService } from '../src/services/print/print.service';
import { PRINT_STYLES } from '../src/services/print/print.styles';
import { MDxEditor } from '../src/editor/mdx-editor';
import { CoreTitleBarPlugin } from '../src/plugins/ui/titlebar.plugin';

vi.mock('../src/renderer/mdx-renderer', () => ({ MDxRenderer: vi.fn() }));

afterEach(() => {
    window.dispatchEvent(new Event('afterprint'));
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

describe('print title', () => {
    it.each([false, true])('waits for rename before printing (failure: %s)', async (fails) => {
        let finish!: () => void;
        const rename = vi.fn(() => new Promise<void>((resolve, reject) => {
            finish = () => fails ? reject(new Error('rename failed')) : resolve();
        }));
        const events = new Map<string, Function[]>();
        const commands = new Map<string, Function>();
        const buttons: any[] = [];
        const listen = (name: string, callback: Function) => {
            events.set(name, [...(events.get(name) || []), callback]);
            return () => {};
        };
        const emit = (name: string, payload: unknown) => {
            events.get(name)?.forEach(callback => callback(payload));
        };
        const manager = { emit, getTitleBarButtons: () => buttons, getCommand: (name: string) => commands.get(name) };
        const container = document.createElement('div');
        document.body.append(container);
        const editor = Object.assign(Object.create(MDxEditor.prototype), {
            config: { title: 'Old', language: '.md' },
            _container: container,
            renderer: { getPluginManager: () => manager },
            updateNodeId: vi.fn(),
            print: vi.fn().mockResolvedValue(undefined),
        });
        const context = {
            listen, on: listen,
            registerCommand: (name: string, callback: Function) => commands.set(name, callback),
            registerTitleBarButton: (button: unknown) => buttons.push(button),
            getFileSystem: () => ({ driver: { getNode: async () => ({ metadata: {} }), rename } }),
            getCurrentNodeId: () => '/Old.md',
        };
        const plugin = new CoreTitleBarPlugin();
        plugin.install(context as any);
        emit('editorPostInit', { editor, pluginManager: manager });
        const input = container.querySelector('input')!;
        input.value = 'New';
        input.dispatchEvent(new Event('blur'));
        container.querySelector<HTMLButtonElement>('[data-button-id="print-action"]')!.click();
        await vi.waitFor(() => expect(rename).toHaveBeenCalled());
        expect(editor.print).not.toHaveBeenCalled();
        finish();
        await vi.waitFor(() => expect(editor.print).toHaveBeenCalled());
        const title = fails ? 'Old' : 'New';
        expect(editor.config.title).toBe(title);
        expect(input.value).toBe(title);
        expect(editor.print).toHaveBeenCalledWith(expect.objectContaining({ title }));
        plugin.destroy();
    });

    it('uses the print title and cleans up when afterprint fires inside print()', async () => {
        vi.useFakeTimers();
        document.title = 'Application';
        vi.spyOn(window, 'print').mockImplementation(() => {
            expect(document.title).toBe('Renamed document');
            expect(document.querySelector('.mdx-print-header__title')?.textContent).toBe('Renamed document');
            window.dispatchEvent(new Event('afterprint'));
        });
        const printing = new DefaultPrintService().printFromHtml('<p>Body</p>', {
            title: 'Renamed document', showHeader: true, fontSize: 'normal',
        });
        await vi.advanceTimersByTimeAsync(300);
        await printing;
        expect(window.print).toHaveBeenCalledOnce();
        expect(document.title).toBe('Application');
        expect(document.getElementById('mdx-print-overlay-style')).toBeNull();
        expect(document.getElementById('mdx-print-overlay')?.innerHTML).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('print lists', () => {
    it('restores list markers after a global CSS reset, including nested and task lists', () => {
        const style = document.createElement('style');
        style.textContent = `ul, ol { list-style: none; } li { display: block; } ${PRINT_STYLES}`;
        document.head.append(style);
        document.body.innerHTML = `<article class="mdx-print"><ul id="bullets"><li id="item">One
            <ul id="nested"><li>Two<ul id="deep"><li>Three</li></ul></li></ul>
            </li><li class="task-list-item" id="task"><input type="checkbox" checked>Done</li></ul>
            <ol id="numbered" start="3"><li>Three<ol id="letters"><li>A</li></ol></li></ol></article>`;
        const css = (id: string) => getComputedStyle(document.getElementById(id)!);
        expect(css('bullets').listStyleType).toBe('disc');
        expect(css('nested').listStyleType).toBe('circle');
        expect(css('deep').listStyleType).toBe('square');
        expect(css('numbered').listStyleType).toBe('decimal');
        expect(css('letters').listStyleType).toBe('lower-alpha');
        expect(css('item').display).toBe('list-item');
        expect(css('task').listStyle).toBe('none');
    });
});
