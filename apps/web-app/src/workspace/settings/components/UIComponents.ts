// @file app/workspace/settings/components/UIComponents.ts

//import '../styles.css'; // 假设样式文件位置

export interface ModalOptions {
    confirmText?: string;
    cancelText?: string;
    type?: 'default' | 'danger' | 'success';
    onConfirm?: () => void | boolean | Promise<void | boolean>;
    onCancel?: () => void;
}

export class Modal {
    private element: HTMLElement | null = null;

    constructor(
        private title: string,
        private contentHTML: string,
        private options: ModalOptions = {}
    ) {
        this.options = {
            confirmText: '确认',
            cancelText: '取消',
            type: 'default',
            ...options
        };
    }

    show() {
        const modal = document.createElement('div');
        modal.className = 'settings-modal-overlay';
        modal.innerHTML = `
            <div class="settings-modal">
                <div class="settings-modal__header">
                    <h3>${this.title}</h3>
                    <button class="settings-modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="settings-modal__body">${this.contentHTML}</div>
                <div class="settings-modal__footer">
                    <button class="settings-btn settings-btn--secondary settings-modal-cancel">${this.options.cancelText}</button>
                    <button class="settings-btn ${this.options.type === 'danger' ? 'settings-btn--danger' : 'settings-btn--primary'} settings-modal-confirm">${this.options.confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.element = modal;

        const close = () => this.hide();
        
        modal.querySelector('.settings-modal-close')?.addEventListener('click', close);
        modal.querySelector('.settings-modal-cancel')?.addEventListener('click', close);
        modal.querySelector('.settings-modal-confirm')?.addEventListener('click', async () => {
             if (this.options.onConfirm) {
                const result = await this.options.onConfirm();
                if (result === false) return; // 允许 onConfirm 返回 false 阻止关闭
            }
            this.hide();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        requestAnimationFrame(() => modal.classList.add('show'));
    }

    hide() {
        if (!this.element) return;
        this.element.classList.remove('show');
        setTimeout(() => {
            this.element?.remove();
            this.options.onCancel?.();
        }, 300);
    }

    static confirm(title: string, message: string, onConfirm: () => void) {
        new Modal(title, `<p>${message}</p>`, {
            type: 'danger',
            confirmText: '确认',
            onConfirm
        }).show();
    }
}

export class Toast {
    static show(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `settings-toast settings-toast--${type}`;
        
        const icons = {
            success: '<i class="fas fa-check-circle"></i>',
            error: '<i class="fas fa-times-circle"></i>',
            warning: '<i class="fas fa-exclamation-triangle"></i>',
            info: '<i class="fas fa-info-circle"></i>'
        };

        toast.innerHTML = `
            <span class="settings-toast__icon">${icons[type]}</span>
            <span class="settings-toast__message">${message}</span>
        `;

        let container = document.querySelector('.settings-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'settings-toast-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    static success(msg: string) { this.show(msg, 'success'); }
    static error(msg: string) { this.show(msg, 'error'); }
    static warning(msg: string) { this.show(msg, 'warning'); }
    static info(msg: string) { this.show(msg, 'info'); }
}
