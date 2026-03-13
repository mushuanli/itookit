// @mdx/editor/codemirror-adapter.ts
import { EditorState, Extension, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { search } from '@codemirror/search';

/**
 * CodeMirror 适配器
 * 
 * 职责：封装所有 CodeMirror 6 的直接依赖
 * 原则：编辑器其他模块只通过此适配器与 CM 交互
 * 好处：如果将来更换编辑器引擎，只需替换此文件
 */
export interface EditorChangeEvent {
    isUserEvent: boolean;
    docChanged: boolean;
}

export interface ScrollTarget {
    pos: number;
    yMargin?: number;
    center?: boolean;
}

// 导航高亮效果定义 (从 editor.ts 中提取)
const addHighlightEffect = StateEffect.define<{ from: number; to: number }>();
const clearHighlightEffect = StateEffect.define<null>();
const headingHighlightMark = Decoration.mark({
    class: 'cm-heading-navigation-highlight',
    attributes: { 'data-highlight-type': 'navigation' }
});

const navigationHighlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, tr) {
        decorations = decorations.map(tr.changes);
        for (const effect of tr.effects) {
            if (effect.is(addHighlightEffect)) {
                const { from, to } = effect.value;
                decorations = decorations.update({ add: [headingHighlightMark.range(from, to)] });
            } else if (effect.is(clearHighlightEffect)) {
                decorations = Decoration.none;
            }
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export class CodeMirrorAdapter {
    private view: EditorView | null = null;
    private readOnlyCompartment = new Compartment();
    private searchCompartment = new Compartment();

    /**
     * 创建 EditorView 实例
     */
    create(
        parent: HTMLElement,
        content: string,
        extensions: Extension[],
        callbacks: {
            onChange: (event: EditorChangeEvent) => void;
            onBlur: () => void;
            onFocus: () => void;
        }
    ): void {
        const allExtensions: Extension[] = [
            ...extensions,
            markdown(),
            this.readOnlyCompartment.of(EditorView.editable.of(true)),
            this.searchCompartment.of([]),
            navigationHighlightField,
            EditorView.domEventHandlers({
                blur: () => { callbacks.onBlur(); },
                focus: () => { callbacks.onFocus(); }
            }),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    callbacks.onChange({
                        docChanged: true,
                        isUserEvent: update.transactions.some(tr =>
                            tr.isUserEvent('input') || tr.isUserEvent('delete') ||
                            tr.isUserEvent('paste') || tr.isUserEvent('drop')
                        ),
                    });
                }
            }),
        ];

        this.view = new EditorView({
            state: EditorState.create({ doc: content, extensions: allExtensions }),
            parent,
        });
    }

    getText(): string {
        return this.view?.state.doc.toString() ?? '';
    }

    setText(text: string): void {
        if (!this.view) return;
        const current = this.getText();
        if (text === current) return;
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: text }
        });
    }

    setReadOnly(isReadOnly: boolean): void {
        this.view?.dispatch({
            effects: this.readOnlyCompartment.reconfigure(EditorView.editable.of(!isReadOnly))
        });
    }

    focus(): void {
        this.view?.focus();
    }

    getLineAt(pos: number) {
        return this.view?.state.doc.lineAt(pos);
    }

    // --- 导航高亮 ---

    addHighlight(from: number, to: number): void {
        this.view?.dispatch({ effects: addHighlightEffect.of({ from, to }) });
    }

    clearHighlight(): void {
        this.view?.dispatch({ effects: clearHighlightEffect.of(null) });
    }

    scrollTo(target: ScrollTarget): void {
        if (!this.view) return;
        this.view.dispatch({
            selection: { anchor: target.pos },
            effects: EditorView.scrollIntoView(target.pos, {
                y: target.center ? 'center' : 'start',
                yMargin: target.yMargin ?? 100
            }),
        });
    }

    // --- 搜索 ---

    enableSearch(): void {
        this.view?.dispatch({
            effects: this.searchCompartment.reconfigure(search({ top: true }))
        });
    }

    disableSearch(): void {
        this.view?.dispatch({
            effects: this.searchCompartment.reconfigure([])
        });
    }

    /**
     * 获取原始 EditorView（仅供需要深度集成的插件使用）
     * @internal
     */
    getRawView(): EditorView | null {
        return this.view;
    }

    destroy(): void {
        this.view?.destroy();
        this.view = null;
    }
}
