import type { EditorFileReference } from '../editor/contracts';
import { editorFilePath } from '../editor/contracts';
import type { MDxEditor } from './mdx-editor';

/** Read only the active view's selection; ignore selections in other panes. */
export function fileReference(editor: MDxEditor): EditorFileReference {
    const view = editor.getEditorView();
    let selected = '';
    if (editor.getMode() === 'edit' && view) {
        selected = view.state.selection.ranges.filter(range => !range.empty)
            .map(range => view.state.sliceDoc(range.from, range.to)).join('\n');
    } else {
        const selection = editor.container?.ownerDocument.getSelection();
        const render = editor.container?.querySelector('.mdx-editor-container__render-mode');
        if (selection && !selection.isCollapsed && render?.contains(selection.anchorNode)
            && render.contains(selection.focusNode)) selected = selection.toString();
    }
    return { path: editorFilePath(editor.config) ?? editor.config.title ?? '',
        content: selected || editor.getText(), selection: selected.length > 0 };
}
