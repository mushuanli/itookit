/**
 * @file #llm/input/popup.js
 * @description Manages the command suggestion popup.
 */

export class PopupManager {
    constructor(ui) {
        this.ui = ui;
        this.elements = ui.elements;
        this.state = ui.state;
        this.options = ui.options;
        this.isHelpPopup = false;
    }

    show(items) {
        if (items.length === 0) {
            this.hide();
            return;
        }
        this.state.popupSelectedIndex = -1;
        this.elements.popup.innerHTML = items.map(item => 
            `<div class="${this.options.classNames.popupItem}" data-value="${item.value}" role="option">
                <strong>${item.label}</strong>
                <p>${item.description}</p>
            </div>`
        ).join('');
        this.elements.popup.style.display = 'block';
    }

    hide() {
        if (this.elements.popup.style.display === 'block') {
            this.elements.popup.style.display = 'none';
            this.state.popupSelectedIndex = -1;
            this.isHelpPopup = false;
        }
    }

    updateSelection(direction) {
        const { popup, popupItem, popupItemSelected } = this.options.classNames;
        const items = this.elements.popup.querySelectorAll(`.${popupItem}`);
        if (items.length === 0) return;

        items[this.state.popupSelectedIndex]?.classList.remove(popupItemSelected);
        this.state.popupSelectedIndex += direction;

        if (this.state.popupSelectedIndex < 0) this.state.popupSelectedIndex = items.length - 1;
        if (this.state.popupSelectedIndex >= items.length) this.state.popupSelectedIndex = 0;

        const selectedItem = items[this.state.popupSelectedIndex];
        selectedItem?.classList.add(popupItemSelected);
        selectedItem?.scrollIntoView({ block: 'nearest' });
    }

    selectItem() {
        const selectedItem = this.elements.popup.querySelector(`.${this.options.classNames.popupItem}.${this.options.classNames.popupItemSelected}`);
        if (selectedItem) {
            this.applySelection(selectedItem.dataset.value);
        }
    }

    applySelection(value) {
        if (this.isHelpPopup) {
            this.hide();
            return;
        }

        const currentText = this.elements.textarea.value;
        const triggerPos = Math.max(currentText.lastIndexOf('/'), currentText.lastIndexOf('@'));

        // --- NEW LOGIC START ---
        if (currentText[triggerPos] === '/') {
            const command = this.ui.commandManager.commands[value];
            if (command && command.executeOnClick) {
                // 意图B: 立即执行
                this.hide();
                this.ui.commandManager.execute(value); // 直接执行命令
                return;
            }
        }
        // --- NEW LOGIC END ---

        // 意图A: 填充 (默认行为)
        // For @-commands or /-commands without executeOnClick
        const newText = currentText.substring(0, triggerPos);
        
        // Add a space after the command for better UX, allowing immediate parameter input
        this.elements.textarea.value = value + ' '; 

        this.hide();

        if (currentText[triggerPos] === '@') {
            this.state.toolChoice = { type: 'function', function: { name: value }};
        }
        // The /model command is now handled by the user typing the parameter
        // So we remove the special handling for it here.
        
        this.elements.textarea.focus();

        // Move cursor to the end of the textarea
        const textLength = this.elements.textarea.value.length;
        this.elements.textarea.setSelectionRange(textLength, textLength);

        this.ui._updateUIState();
    }
}
