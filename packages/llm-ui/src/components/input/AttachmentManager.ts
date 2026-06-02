// @file: llm-ui/components/input/AttachmentManager.ts
// File attachment handling: paste, drag-drop, OCR — extracted from ChatInputView.

import { ChatInputTemplates } from '../templates/ChatInputTemplates';
import { downscaleImageForOcr } from '../../utils/imageDownscale';
import { t } from '@itookit/common';
import type { OcrReviewPanel } from './OcrReviewPanel';
import type { PopupPanel, PopupItem } from './plugins/PopupPanel';

export interface AttachmentManagerOptions {
    container: HTMLElement;
    fileInput: HTMLInputElement;
    attachmentContainer: HTMLElement;
    textarea: HTMLTextAreaElement;
    inputWrapper: HTMLElement;
    attachBtn: HTMLButtonElement;
    onOcrImage?: (image: Blob) => Promise<string>;
    onRequestFiles?: (query: string) => Promise<any[]>;
    getLoading: () => boolean;
    getFiles: () => File[];
    setFiles: (files: File[]) => void;
    notifyConfigChange: () => void;
}

export class AttachmentManager {
    private ocrPanel: OcrReviewPanel | null = null;
    private addPopup: PopupPanel | null = null;

    constructor(private opts: AttachmentManagerOptions) {
        if (opts.onOcrImage) {
            // OcrReviewPanel is created lazily; imported at top
        }
    }

    // ── Paste ─────────────────────────────────────────────────────────────

    handlePaste(e: ClipboardEvent): void {
        if (this.opts.getLoading()) return;
        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) pastedFiles.push(this.renameFileIfNeeded(file));
            }
        }
        if (pastedFiles.length > 0) this.addFiles(pastedFiles);
    }

    private renameFileIfNeeded(file: File): File {
        if (file.name === 'image.png' || file.name === 'image.jpg') {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            return new File([file], `paste_${timestamp}.${file.name.split('.').pop()}`, { type: file.type });
        }
        return file;
    }

    addFiles(newFiles: File[]): void {
        this.opts.setFiles([...this.opts.getFiles(), ...newFiles]);
        this.renderAttachments();
    }

    renderAttachments(): void {
        const files = this.opts.getFiles();
        if (files.length === 0) {
            this.opts.attachmentContainer.style.display = 'none';
            return;
        }
        this.opts.attachmentContainer.style.display = 'flex';
        const canOcr = !!this.opts.onOcrImage;
        this.opts.attachmentContainer.innerHTML = ChatInputTemplates.renderAttachments(files, canOcr);
    }

    // ── Drag events ───────────────────────────────────────────────────────

    bindDragEvents(): void {
        const wrapper = this.opts.inputWrapper;

        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.opts.getLoading()) {
                wrapper.classList.add('llm-input__field-wrapper--drag-active');
            }
        });

        wrapper.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('llm-input__field-wrapper--drag-active');
        });

        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('llm-input__field-wrapper--drag-active');
            if (this.opts.getLoading()) return;
            const droppedFiles = e.dataTransfer?.files;
            if (droppedFiles && droppedFiles.length > 0) {
                this.addFiles(Array.from(droppedFiles));
            }
        });
    }

    // ── "+" add-source menu ───────────────────────────────────────────────

    toggleAddMenu(createPopup: (anchor: HTMLElement, opts?: any) => PopupPanel): void {
        if (!this.addPopup) {
            this.addPopup = createPopup(this.opts.attachBtn, { animated: true });
        }
        if (this.addPopup.isVisible) { this.addPopup.hide(); return; }

        const items: PopupItem[] = [
            { id: 'attach', label: t('chatInput.add.attach'), icon: '📎' },
        ];
        if (this.opts.onRequestFiles) {
            items.push({ id: 'fileRef', label: t('chatInput.add.fileRef'), icon: '@' });
        }

        this.addPopup.show(items, {
            onSelect: (item) => {
                if (item.id === 'attach') {
                    this.opts.fileInput.click();
                } else if (item.id === 'fileRef') {
                    // Insert '@' at cursor to trigger MentionPlugin's file picker
                    const ta = this.opts.textarea;
                    const pos = ta.selectionStart;
                    const before = ta.value.slice(0, pos);
                    const after = ta.value.slice(pos);
                    ta.value = before + '@' + after;
                    ta.selectionStart = ta.selectionEnd = pos + 1;
                    ta.focus();
                    this.opts.notifyConfigChange();
                }
            },
        });
    }

    // ── OCR (image → text) ────────────────────────────────────────────────

    async ocrImage(file: File, index: number): Promise<void> {
        if (!this.opts.onOcrImage) return;
        // Lazy-create OcrReviewPanel
        if (!this.ocrPanel) {
            const { OcrReviewPanel } = require('./OcrReviewPanel');
            this.ocrPanel = new OcrReviewPanel(this.opts.container);
        }
        const panel = this.ocrPanel!;
        const ocr = this.opts.onOcrImage;

        let cancelled = false;
        panel.showProcessing(file.name, () => { cancelled = true; panel.hide(); });

        try {
            const downscaled = await downscaleImageForOcr(file);
            const markdown = (await ocr(downscaled)).trim();
            if (cancelled) return;

            if (!markdown) {
                panel.showError(t('chatInput.ocr.empty'),
                    () => this.ocrImage(file, index), () => panel.hide());
                return;
            }

            panel.showReview(file, markdown, {
                onConfirm: (text) => this.applyOcrResult(text, index, true),
                onConfirmKeep: (text) => this.applyOcrResult(text, index, false),
                onRetry: () => this.ocrImage(file, index),
                onCancel: () => panel.hide(),
            });
        } catch (err) {
            if (cancelled) return;
            const msg = err instanceof Error ? err.message : String(err);
            panel.showError(msg, () => this.ocrImage(file, index), () => panel.hide());
        }
    }

    private applyOcrResult(text: string, index: number, removeImage: boolean): void {
        // Insert at cursor
        const ta = this.opts.textarea;
        const pos = ta.selectionStart;
        ta.value = ta.value.slice(0, pos) + text + ta.value.slice(pos);
        ta.selectionStart = ta.selectionEnd = pos + text.length;

        if (removeImage && this.opts.getFiles()[index]) {
            const files = [...this.opts.getFiles()];
            files.splice(index, 1);
            this.opts.setFiles(files);
            this.renderAttachments();
        }
        this.opts.notifyConfigChange();
        this.ocrPanel?.hide();
        ta.focus();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    destroy(): void {
        this.addPopup?.destroy();
        this.addPopup = null;
        this.ocrPanel?.destroy();
        this.ocrPanel = null;
    }
}
