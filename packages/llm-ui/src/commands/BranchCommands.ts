// @file: llm-ui/commands/BranchCommands.ts

import { Command } from '../base/core/Command';
import { Toast, showConfirmDialog } from '@itookit/common';
import type { BranchItem } from '../base/core/types';

export class CreateBranchCommand extends Command<{ sourceNodeId: string }> {
    protected readonly name = 'Create Branch';

    protected async execute({ sourceNodeId }: { sourceNodeId: string }): Promise<void> {
        const branchName = await this.promptBranchName();
        if (branchName === null) return;

        const branchPointId = this.findBranchPoint(sourceNodeId);
        const newNodeId = await this.ctx.sessionManager.createBranch(branchPointId, {
            name: branchName || undefined,
            copyContent: true,
        });

        const branches = await this.ctx.sessionManager.listBranches();
        const branch = branches.find(b => b.headNodeId === newNodeId);
        if (branch) {
            await this.ctx.sessionManager.switchBranch(branch.name);
        }

        Toast.success(`Branch "${branchName || 'Untitled'}" created`);
    }

    private findBranchPoint(sourceNodeId: string): string {
        const sessions = this.ctx.sessionManager.getSessions();
        const idx = sessions.findIndex(s => s.id === sourceNodeId);
        if (idx === -1) return sourceNodeId;

        const session = sessions[idx];
        if (session.role !== 'user') return sourceNodeId;
        return idx > 0 ? sessions[idx - 1].id : sourceNodeId;
    }

    private promptBranchName(): Promise<string | null> {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'llm-branch-name-dialog';
            dialog.innerHTML = `
                <div class="llm-branch-name-dialog__overlay"></div>
                <div class="llm-branch-name-dialog__content">
                    <h4>Create New Branch</h4>
                    <p>Enter a name for this branch (optional):</p>
                    <input type="text" class="llm-input" placeholder="Branch name">
                    <div class="llm-branch-name-dialog__actions">
                        <button class="llm-btn" data-action="cancel">Cancel</button>
                        <button class="llm-btn llm-btn--primary" data-action="create">Create</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);
            const input = dialog.querySelector('input') as HTMLInputElement;
            input.focus();

            const cleanup = () => dialog.remove();
            const submit = () => { cleanup(); resolve(input.value.trim()); };
            const cancel = () => { cleanup(); resolve(null); };

            dialog.querySelector('[data-action="create"]')?.addEventListener('click', submit);
            dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', cancel);
            dialog.querySelector('.llm-branch-name-dialog__overlay')?.addEventListener('click', cancel);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                else if (e.key === 'Escape') cancel();
            });
        });
    }
}

export class SwitchBranchCommand extends Command<{ branchName: string }> {
    protected readonly name = 'Switch Branch';

    protected async execute({ branchName }: { branchName: string }): Promise<void> {
        await this.ctx.sessionManager.switchBranch(branchName);
    }
}

export class SwitchBranchByIdCommand extends Command<{ headNodeId: string }> {
    protected readonly name = 'Switch Branch By ID';

    protected async execute({ headNodeId }: { headNodeId: string }): Promise<void> {
        const branches = await this.ctx.sessionManager.listBranches();
        const branch = branches.find(b => b.headNodeId === headNodeId);
        if (!branch) throw new Error(`No branch found for head node: ${headNodeId}`);
        await this.ctx.sessionManager.switchBranch(branch.name);
    }
}

export class RenameBranchCommand extends Command<{ oldName: string; newName: string }> {
    protected readonly name = 'Rename Branch';

    protected async execute({ oldName, newName }: { oldName: string; newName: string }): Promise<void> {
        if (!newName.trim()) return;
        await this.ctx.sessionManager.renameBranch(oldName, newName);
        Toast.success('Branch renamed');
    }
}

export class DeleteBranchCommand extends Command<{ branchName: string }> {
    protected readonly name = 'Delete Branch';

    protected async execute({ branchName }: { branchName: string }): Promise<void> {
        const confirmed = await showConfirmDialog(
            `Delete branch "${branchName}" and all its unique children?`
        );
        if (!confirmed) return;
        await this.ctx.sessionManager.deleteBranch(branchName, true);
        Toast.success('Branch deleted');
    }
}

export class SwitchBranchByOffsetCommand extends Command<{ offset: number; cachedBranches: BranchItem[] }> {
    protected readonly name = 'Switch Branch By Offset';

    protected async execute({ offset, cachedBranches }: { offset: number; cachedBranches: BranchItem[] }): Promise<void> {
        if (cachedBranches.length <= 1) {
            Toast.info('No other branches to switch to');
            return;
        }

        const currentIndex = cachedBranches.findIndex(b => b.isCurrent);
        if (currentIndex === -1) return;

        const len = cachedBranches.length;
        const newIndex = ((currentIndex + offset) % len + len) % len;
        if (newIndex === currentIndex) return;

        await this.ctx.sessionManager.switchBranch(cachedBranches[newIndex].name);
    }
}
