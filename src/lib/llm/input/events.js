/**
 * @file #llm/input/events.js
 * @description Event handling logic for the LLMInputUI component.
 */

export function attachEventListeners(ui) {
    ui.elements.textarea.addEventListener('input', () => onTextareaInput(ui));
    ui.elements.textarea.addEventListener('keydown', (e) => onTextareaKeyDown(ui, e));
    ui.elements.textarea.addEventListener('paste', (e) => onPaste(ui, e));
    ui.elements.sendBtn.addEventListener('click', () => ui._handleSubmit());
    ui.elements.popup.addEventListener('click', (e) => onCommandPopupClick(ui, e));

    // --- CORRECTED BLOCK with existence checks ---
    // These elements are conditional, so we must check if they were found
    if (ui.elements.attachBtn) {
        ui.elements.attachBtn.addEventListener('click', () => ui.elements.fileInput.click());
    }
    if (ui.elements.fileInput) {
        ui.elements.fileInput.addEventListener('change', (e) => handleFilesSelected(ui, e.target.files));
    }
    if (ui.elements.container && !ui.options.disableAttachments) {
         ui.elements.container.addEventListener('dragover', (e) => onDragOver(ui, e));
         ui.elements.container.addEventListener('dragleave', (e) => onDragLeave(ui, e));
         ui.elements.container.addEventListener('drop', (e) => onDrop(ui, e));
    }

    // +++ NEW: Agent selector events +++
    if (ui.elements.agentSelectorBtn) {
        ui.elements.agentSelectorBtn.addEventListener('click', () => {
            const popup = ui.elements.agentPopup;
            popup.style.display = popup.style.display === 'block' ? 'none' : 'block';
        });

        ui.elements.agentPopup.addEventListener('click', (e) => {
            const item = e.target.closest(`.${ui.options.classNames.popupItem}`);
            if (item && item.dataset.agentId) {
                ui.setAgent(item.dataset.agentId); // Re-use the existing public method to trigger event
                ui.elements.agentPopup.style.display = 'none'; // Hide after selection
            }
        });
    }
}

function onTextareaInput(ui) {
    ui._hideError();
    ui.elements.textarea.style.height = 'auto';
    ui.elements.textarea.style.height = `${ui.elements.textarea.scrollHeight}px`;
    ui._updateUIState();
    handleCommandSuggestions(ui);
}

function onTextareaKeyDown(ui, e) {
    const isPopupVisible = ui.elements.popup.style.display === 'block';

    if (isPopupVisible) {
        if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            ui.popupManager.updateSelection(e.key === 'ArrowDown' ? 1 : -1);
        } else if (['Enter', 'Tab'].includes(e.key)) {
            if (ui.state.popupSelectedIndex !== -1) {
                e.preventDefault();
                ui.popupManager.selectItem();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            ui.popupManager.hide();
        }
    } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ui._handleSubmit();
    }
}

function onPaste(ui, e) {
    if (ui.options.disableAttachments || !e.clipboardData?.files.length) return;
    handleFilesSelected(ui, e.clipboardData.files);
}

function onCommandPopupClick(ui, e) {
    const item = e.target.closest(`.${ui.options.classNames.popupItem}`);
    if (!item) return;
    ui.popupManager.applySelection(item.dataset.value);
}

function onDragOver(ui, e) { e.preventDefault(); ui.elements.mainArea.classList.add('drag-over'); }
function onDragLeave(ui, e) { e.preventDefault(); ui.elements.mainArea.classList.remove('drag-over'); }
function onDrop(ui, e) {
    e.preventDefault();
    ui.elements.mainArea.classList.remove('drag-over');
    handleFilesSelected(ui, e.dataTransfer.files);
}

export function handleFilesSelected(ui, files) {
    const { maxCount, maxSizeMB, mimeTypes } = ui.options.attachments;
    const { localization: loc } = ui.options;

    for (const file of files) {
        if (ui.state.attachments.length >= maxCount) {
            ui.showError(`${loc.attachmentLimitExceeded} (${maxCount})`);
            break;
        }
        if (file.size > maxSizeMB * 1024 * 1024) {
            ui.showError(`${loc.fileTooLarge} (${file.name}, > ${maxSizeMB}MB)`);
            continue;
        }
        if (mimeTypes && mimeTypes.length > 0 && !mimeTypes.includes(file.type)) {
            ui.showError(`${loc.unsupportedFileType} (${file.name})`);
            continue;
        }

        const attachment = { id: `file-${Date.now()}-${Math.random()}`, file };
        
        let canAdd = ui._emit('beforeAttachmentAdd', attachment) !== false;
        if (canAdd) {
            ui.state.attachments.push(attachment);
            ui._renderAttachments();
            ui._updateUIState();
            ui._emit('attachmentAdd', attachment);
        }
    }
}

function handleCommandSuggestions(ui) {
    const text = ui.elements.textarea.value;
    const cursorPos = ui.elements.textarea.selectionStart;
    const textBeforeCursor = text.substring(0, cursorPos);
    const triggerPos = Math.max(textBeforeCursor.lastIndexOf('/'), textBeforeCursor.lastIndexOf('@'));

    if (triggerPos === -1 || textBeforeCursor.substring(triggerPos).includes(' ')) {
        ui.popupManager.hide();
        return;
    }

    const trigger = text[triggerPos];
    const query = textBeforeCursor.substring(triggerPos + 1).toLowerCase();

    if (trigger === '/') {
        const items = ui.commandManager.getSuggestions(query);
        ui.popupManager.show(items);
    } else if (trigger === '@' && ui.options.tools.length > 0) {
        const items = ui.options.tools
            .filter(tool => tool.function.name.toLowerCase().includes(query))
            .map(tool => ({ value: tool.function.name, label: `@${tool.function.name}`, description: tool.function.description }));
        ui.popupManager.show(items);
    } else {
        ui.popupManager.hide();
    }
}
