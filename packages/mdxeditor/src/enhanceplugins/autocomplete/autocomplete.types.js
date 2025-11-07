/**
 * @file mdxeditor/enhanceplugins/autocomplete/autocomplete.types.js
 * @description JSDoc type definitions for the Autocomplete system.
 */

/**
 * @typedef {object} AutocompleteSourceOptions
 * @property {string} triggerChar - The character that triggers autocompletion, e.g., '@', '#', '/'.
 * @property {import('@itookit/common').IAutocompleteProvider} provider - An instance of a data provider that implements IAutocompleteProvider.
 * @property {(item: object) => string} applyTemplate - A function that receives the selected item's data object and returns the final string to insert into the editor.
 * @property {string} [completionType] - (Optional) The CSS class name for each item in the CodeMirror dropdown, used for styling.
 */

// Dummy export to make this file a module.
export const UNUSED = {};
