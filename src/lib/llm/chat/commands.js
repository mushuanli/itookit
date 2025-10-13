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
 * Registers commands that require coordination between inputUI and historyUI.
 * @param {import('./index.js').LLMChatUI} chatUI - The main chat UI instance.
 */
export function registerOrchestratorCommands(chatUI) {
    const { inputUI, historyUI } = chatUI;

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
                // Reuse the submission flow
                const prompt = `Please summarize the following text:\n\n---\n\n${lastMessage.content}`;
                chatUI.handleSubmit({ text: prompt, attachments: [] });
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
                const historyData = historyUI.exportHistory();
                const jsonString = JSON.stringify(historyData, null, 2);
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
        handler(keyword) {
            if (!keyword) {
                historyUI.clearSearch();
                return;
            }
            const results = historyUI.search(keyword);
            if (results.length > 0) {
                historyUI.nextResult();
                inputUI._showToast(`${results.length} result(s) found. Jumped to first.`);
            } else {
                inputUI.showError(`No results found for "${keyword}".`);
            }
        }
    });
}
