/**
 * @file #llm/chat/commands.js
 * @description Defines and registers orchestrator-level commands for LLMChatUI.
 */

/**
 * Extracts code blocks from a markdown string.
 * @param {string} markdownContent 
 * @returns {string[]} An array of code blocks.
 */
function extractCodeBlocks(markdownContent) {
    const codeBlockRegex = /```(?:\w*\n)?([\s\S]*?)```/g;
    const matches = [];
    let match;
    while ((match = codeBlockRegex.exec(markdownContent)) !== null) {
        matches.push(match[1].trim());
    }
    return matches;
}

/**
 * Registers commands that require coordination.
 * @param {import('../../common/interfaces/IEditor.js').IEditor} editor - The editor instance that implements the IEditor interface.
 * @param {import('../input/index.js').LLMInputUI} inputUI - The input UI for showing feedback.
 * @param {import('../history/index.js').LLMHistoryUI} historyUI - Direct access for specific commands like /last.
 */
export function registerOrchestratorCommands(editor, inputUI, historyUI) {

    // /last [action]
    inputUI.registerCommand({
        name: '/last',
        description: 'Operate on the last response. Actions: copycode, summarize',
        handler(action) {
            const lastMessage = historyUI.getLastAssistantMessage();
            if (!lastMessage) {
                inputUI.showError('No previous assistant message found.');
                return;
            }

            if (action === 'copycode') {
                const codeBlocks = extractCodeBlocks(lastMessage.content);
                if (codeBlocks.length > 0) {
                    navigator.clipboard.writeText(codeBlocks.join('\n\n'));
                    inputUI._showToast('Code block(s) copied!');
                } else {
                    inputUI.showError('No code blocks found in the last message.');
                }
            } else if (action === 'summarize') {
                // This command still needs access to the parent chatUI to submit a new message.
                // A better design might be an `editor.sendMessage()` method on IEditor.
                // For now, we assume `editor` is an instance of LLMChatUI to call handleSubmit.
                if (typeof editor.handleSubmit === 'function') {
                    const prompt = `Please summarize the following text:\n\n---\n\n${lastMessage.content}`;
                    editor.handleSubmit({ text: prompt, attachments: [] });
                } else {
                     inputUI.showError('Summarize action is not supported by this editor.');
                }
            } else {
                inputUI.showError('Unknown /last action. Use "copycode" or "summarize".');
            }
        }
    });

    // /export
    inputUI.registerCommand({
        name: '/export',
        description: 'Export the conversation history as a JSON file.',
        handler() {
            try {
                // We use the IEditor interface to get the full content
                const jsonString = editor.getText();
                if (!jsonString) {
                    inputUI.showError('Nothing to export.');
                    return;
                }
                const blob = new Blob([jsonString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chat-history-${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                inputUI._showToast('History exported.');
            } catch (e) {
                inputUI.showError('Failed to export history.');
                console.error(e);
            }
        }
    });

    // /search [keyword]
    inputUI.registerCommand({
        name: '/search',
        description: 'Search the history and jump to the first result.',
        async handler(keyword) {
            if (!keyword) {
                // Use the abstract interface to clear search
                editor.clearSearch();
                inputUI._showToast('Search cleared.');
                return;
            }
            try {
                // Use the abstract interface to perform search
                const results = await editor.search(keyword);
                
                if (results.length > 0) {
                    // Use the abstract interface to navigate to the first match
                    editor.gotoMatch(results[0]);
                    inputUI._showToast(`${results.length} result(s) found. Jumped to first.`);
                } else {
                    editor.clearSearch(); // Clear any previous highlights
                    inputUI.showError(`No results found for "${keyword}".`);
                }
            } catch (error) {
                 console.error("Search command failed:", error);
                 inputUI.showError("An error occurred during search.");
            }
        }
    });
}
