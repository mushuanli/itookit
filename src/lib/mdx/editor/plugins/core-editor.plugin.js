/**
 * #mdx/editor/plugins/core-editor.plugin.js
 * @file Provides the essential CodeMirror extensions for a baseline editing experience.
 * This replaces the monolithic `basicSetup` to avoid extension conflicts.
 */

// [FIXED] Corrected import paths for CodeMirror modules.
import { keymap, drawSelection, highlightActiveLine, lineNumbers, highlightSpecialChars, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLineGutter, EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language"; // `foldGutter` and `foldKeymap` moved here.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { markdown } from "@codemirror/lang-markdown";

export class CoreEditorPlugin {
    name = 'core:editor';

    install(context) {
        if (typeof context.registerCodeMirrorExtensions === 'function') {
            const baseExtensions = [
                // Essentials
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightSpecialChars(),
                history(),
                foldGutter(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                bracketMatching(),
                closeBrackets(),
                rectangularSelection(),
                crosshairCursor(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                
                // Keymaps (including placeholder for autocomplete)
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...searchKeymap,
                    ...historyKeymap,
                    ...foldKeymap,
                    ...completionKeymap,
                    ...lintKeymap
                ]),

                // Language Support
                markdown(),
                
                // Default autocompletion (can be overridden by other plugins)
                autocompletion(),
            ];
            context.registerCodeMirrorExtensions(baseExtensions);
        }
    }
}
