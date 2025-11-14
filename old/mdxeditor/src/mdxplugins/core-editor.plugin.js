/**
 * @file #mdxeditor/mdxplugins/core-editor.plugin.js
 * @desc Provides the essential CodeMirror extensions for a baseline editing experience.
 * This replaces the monolithic `basicSetup` to avoid extension conflicts.
 */

/** @typedef {import('../core/plugin.js').PluginContext} PluginContext */

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

    /**
     * @param {PluginContext} context
     */
    install(context) {
        // [订正] 修正拼写错误：registerCodeMirrorExtensions -> registerCodeMirrorExtension
        if (typeof context.registerCodeMirrorExtension === 'function') {
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
            // [订正] 修正拼写错误：registerCodeMirrorExtensions -> registerCodeMirrorExtension
            // 逻辑说明：CodeMirror 的扩展系统可以接受一个扩展数组，它会自动将其展平。
            // 因此，将整个 baseExtensions 数组传递给单数形式的方法是正确的逻辑。
            context.registerCodeMirrorExtension(baseExtensions);
        }
    }
}
