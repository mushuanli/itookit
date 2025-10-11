/**
 * #mdx/editor/editor/core-editor.js
 * @file [NEW] A dedicated class that encapsulates the CodeMirror editor instance.
 * It is a "headless" component focused solely on the text editing experience.
 */

import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

/**
 * MDxCoreEditor manages the lifecycle and interactions of a CodeMirror editor instance.
 */
export class MDxCoreEditor {
    /**
     * Initializes the core CodeMirror editor.
     * @param {HTMLElement} parentElement - The DOM element to mount the editor into.
     * @param {object} options
     * @param {string} [options.initialText=''] - The initial markdown content.
     * @param {any[]} [options.extensions=[]] - An array of CodeMirror extensions.
     * @param {(update: import('@codemirror/view').ViewUpdate) => void} [options.onUpdate] - A callback function that fires on editor updates.
     */
    constructor(parentElement, options) {
        if (!parentElement) {
            throw new Error("A parent element is required for MDxCoreEditor.");
        }

        const extensions = [
            ...(options.extensions || []),
            // Set up a listener that forwards updates to the parent coordinator (MDxEditor)
            EditorView.updateListener.of(update => {
                if (update.docChanged && options.onUpdate) {
                    options.onUpdate(update);
                }
            }),
        ];

        const state = EditorState.create({
            doc: options.initialText || '',
            extensions: extensions
        });

        /**
         * The underlying CodeMirror EditorView instance.
         * @type {import('@codemirror/view').EditorView}
         */
        this.view = new EditorView({
            state,
            parent: parentElement,
        });
    }

    /**
     * Gets the current text from the editor.
     * @returns {string}
     */
    getText() {
        return this.view.state.doc.toString();
    }

    /**
     * Replaces the entire content of the editor with new text.
     * @param {string} markdownText
     */
    setText(markdownText) {
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: markdownText }
        });
    }

    /**
     * Focuses the editor.
     */
    focus() {
        this.view.focus();
    }

    /**
     * Provides access to the editor's scrollable DOM element.
     * @returns {HTMLElement}
     */
    get scrollDOM() {
        return this.view.scrollDOM;
    }

    /**
     * Destroys the CodeMirror instance and cleans up resources.
     */
    destroy() {
        this.view.destroy();
    }
}
