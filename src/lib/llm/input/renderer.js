/**
 * @file #llm/input/renderer.js
 * @description DOM rendering logic for the LLMInputUI component.
 */

export function initialRender(container, options) {
    const { classNames: cls, localization: loc, disableAttachments, agents = [] } = options;

    // +++ NEW: Dynamically generate agent menu items +++
    const agentMenuItemsHTML = agents.map(agent => `
        <div class="${cls.popupItem}" data-agent-id="${agent.id}">
            <div style="font-size: 1.5rem; width: 24px; text-align: center;">${agent.icon || '🤖'}</div>
            <div class="popup-item-content">
                <strong>${agent.name}</strong>
                ${agent.description ? `<p>${agent.description}</p>` : ''}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="${cls.container}">
            <div class="${cls.toast}" style="display: none;"></div>
            <div class="${cls.errorDisplay}" style="display: none;"></div>
            <div class="${cls.statusBar}" style="display: none;">
                <span class="${cls.agentTag}"></span>
                <span class="${cls.toolChoiceTag}"></span>
            </div>
            <div class="${cls.attachmentTray}" style="display: none;"></div>
            <div class="${cls.mainArea}">
                <div class="${cls.agentSelectorWrapper}">
                    <button class="llm-input-ui-button ${cls.agentSelectorBtn}" title="${loc.agentSelectorTitle}" aria-label="${loc.agentSelectorTitle}">
                       <span class="agent-selector-icon">🤖</span>
                       <span class="agent-selector-name">Select Agent</span>
                    </button>
                    <div class="llm-popup ${cls.agentPopup}" style="display: none; bottom: 50px; left: 0;">
                        ${agentMenuItemsHTML.length > 0 ? agentMenuItemsHTML : `<div class="${cls.popupItem}">No agents configured.</div>`}
                    </div>
                </div>

                <textarea class="${cls.textarea}" rows="1" placeholder="${loc.placeholder}" aria-label="${loc.placeholder}"></textarea>
                
                ${!disableAttachments ? `
                <button class="llm-input-ui-button ${cls.attachBtn}" title="${loc.attachTitle}" aria-label="${loc.attachTitle}">📎</button>
                <input type="file" class="${cls.fileInput}" multiple style="display:none;" />
                ` : ''}

                <button class="llm-input-ui-button ${cls.sendBtn}" title="${loc.sendTitle}" aria-label="${loc.sendTitle}" disabled>➤</button>
            </div>
            <div class="llm-popup ${cls.commandPopup}" style="display: none;" role="listbox"></div>
        </div>
    `;

    const elements = {};
    // This loop will now work correctly with single class names
    for (const key in cls) {
        const el = container.querySelector(`.${cls[key]}`);
        if (el) { // Add a check for safety
            elements[key] = el;
        } else {
            // Silently fail for elements that might not be rendered (like attachBtn if disabled)
            elements[key] = null; 
        }
    }
    // Manually add the base popup class for the command popup
    elements.popup = container.querySelector(`.${cls.commandPopup}`);
    return elements;
}

export function renderAttachments(ui) {
    const { attachmentTray } = ui.elements;
    if (!attachmentTray) return;

    if (ui.state.attachments.length === 0) {
        attachmentTray.style.display = 'none';
        return;
    }

    attachmentTray.style.display = 'flex';
    attachmentTray.innerHTML = ui.state.attachments.map(att => {
        const isImage = att.file.type.startsWith('image/');
        const preview = isImage 
            ? `<img src="${URL.createObjectURL(att.file)}" alt="${att.file.name}" />`
            : `<span>📄</span>`;
        return `
            <div class="${ui.options.classNames.attachmentItem}" data-id="${att.id}">
                ${preview}
                <span class="${ui.options.classNames.attachmentName}">${att.file.name}</span>
                <button class="${ui.options.classNames.removeAttachmentBtn}" aria-label="Remove ${att.file.name}">&times;</button>
            </div>
        `;
    }).join('');

    // Re-attach event listeners for newly created buttons
    attachmentTray.querySelectorAll(`.${ui.options.classNames.removeAttachmentBtn}`).forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.closest(`.${ui.options.classNames.attachmentItem}`).dataset.id;
            ui._removeAttachment(id);
        });
    });
}



/**
 * Injects or updates the theme styles (CSS variables).
 * @param {object} theme - The theme object from options.
 */
export function updateTheme(theme) {
    const styleId = 'llm-input-ui-theme-styles';
    let themeStyle = document.getElementById(styleId);

    if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = styleId;
        document.head.appendChild(themeStyle);
    }

    let themeCss = ':root {';
    for (const [key, value] of Object.entries(theme)) {
        themeCss += `${key}: ${value};`;
    }
    themeCss += '}';
    themeStyle.innerHTML = themeCss;
}