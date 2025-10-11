/**
 * @file #llm/input/defaults.js
 * @description Default options for the LLMInputUI component.
 */

export const defaultOptions = {
    tools: [],
    templates: {},
    personas: {},
    // +++ NEW: Add agents list to options +++
    agents: [],
    // +++ RENAMED: initialModel -> initialAgent +++
    initialAgent: '',
    initialText: '',
    disableAttachments: false,
    attachments: {
        maxSizeMB: 10,
        maxCount: 5,
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    },
    localization: {
        placeholder: 'Send a message...',
        sendTitle: 'Send message',
        stopTitle: 'Stop generation',
        attachTitle: 'Attach files',
        // +++ NEW: Agent selector title +++
        agentSelectorTitle: 'Change Agent',
        systemCmdDesc: 'Set a system prompt for the next message.',
        // +++ RENAMED: model -> agent +++
        agentCmdDesc: 'Change the agent (assistant/model).',
        clearCmdDesc: 'Clear input and attachments.',
        helpCmdDesc: 'Show available commands.',
        // +++ 新增：新命令的描述文本
        templateCmdDesc: 'Insert a predefined text template. Usage: /template <name>',
        saveCmdDesc: 'Save the current input as a new template. Usage: /save <name>',
        personaCmdDesc: 'Apply a predefined system prompt persona. Usage: /persona <name>',
        noContextCmdDesc: 'Send the next message without conversation history.',
        templateMissing: 'Template not found:',
        templateSaved: 'Template saved:',
        personaApplied: 'Persona applied:',
        noContextEnabled: 'Next message will be sent without context.',
        // --- 现有文本
        systemPromptMissing: 'System prompt content is missing.',
        systemPromptSet: 'System prompt set.',
        // +++ RENAMED: model -> agent +++
        agentChangedTo: 'Agent changed to',
        attachmentLimitExceeded: 'Attachment limit exceeded',
        fileTooLarge: 'File is too large',
        unsupportedFileType: 'Unsupported file type',
    },
    theme: {
        '--llm-font-family': 'inherit',
        '--llm-font-size': '16px',
        '--llm-text-color': '#212529',
        '--llm-primary-color': '#007bff',
        '--llm-primary-text-color': '#ffffff',
        '--llm-bg-color': '#ffffff',
        '--llm-border-color': '#e0e0e0',
        '--llm-border-radius': '12px',
        '--llm-input-bg-color': '#f7f7f7',
        '--llm-tag-bg-color': '#f0f0f0',
        '--llm-button-bg-color': '#f0f0f0',
        '--llm-button-disabled-bg-color': '#d0d0d0',
        '--llm-error-color': '#dc3545',
        '--llm-error-bg-color': '#f8d7da',
        '--llm-popup-selected-bg-color': '#f0f0f0',
    },
    classNames: {
        container: 'llm-input-ui-container',
        toast: 'llm-input-ui-toast',
        errorDisplay: 'llm-input-ui-error',
        statusBar: 'llm-input-ui-status-bar',
        // +++ RENAMED: modelTag -> agentTag +++
        agentTag: 'agent-tag',
        toolChoiceTag: 'tool-choice-tag',
        attachmentTray: 'llm-input-ui-attachments',
        attachmentItem: 'attachment-item',
        attachmentName: 'attachment-name',
        removeAttachmentBtn: 'remove-attachment-btn',
        mainArea: 'llm-input-ui-main',
        // --- CORRECTED LINES ---
        attachBtn: 'llm-attach-btn', // Was 'llm-input-ui-button attach-btn'
        fileInput: 'llm-file-input', // Simplified for consistency
        textarea: 'llm-textarea',   // Simplified for consistency
        sendBtn: 'llm-send-btn',     // Was 'llm-input-ui-button send-btn'
        // --- END CORRECTION ---
        commandPopup: 'llm-command-popup',
        popupItem: 'popup-item',
        popupItemSelected: 'selected',
        // +++ NEW: Class names for agent selector +++
        agentSelectorWrapper: 'agent-selector-wrapper',
        agentSelectorBtn: 'agent-selector-btn',
        agentPopup: 'agent-popup',
    },
    on: {},
};
