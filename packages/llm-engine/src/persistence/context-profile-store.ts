// @file: llm-engine/src/persistence/context-profile-store.ts
// ContextProfileStore — immutable versioned context profiles for branches.
//
// Phase 2 (WP-03): Each branch points to a BranchContextProfile revision.
// When a user modifies context rules (include/exclude/summary), the store
// creates a new revision via copy-on-write. Other branches keep pointing
// to the old revision.
//
// Storage layout:
//   context-profile-<profileId>-r<revision>.json

import type { RoundId } from '@itookit/common';
import type {
    BranchContextProfile,
    ContextProfileId,
    ContextRule,
} from '@itookit/common';
import type { IChatEngine } from './types';
import { ulid } from './ulid';

export class ContextProfileStore {
    private static readonly writeTails = new Map<string, Promise<void>>();
    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
    ) {}

    /** Create an initial empty profile for a new branch. */
    async createProfile(): Promise<BranchContextProfile> {
        const profile: BranchContextProfile = {
            id: ulid() as ContextProfileId,
            revision: 1,
            createdAt: Date.now(),
            rules: {},
        };
        await this.writeProfile(profile);
        return profile;
    }

    /** Read a specific profile revision. */
    async getProfile(id: ContextProfileId, revision: number): Promise<BranchContextProfile | null> {
        try {
            const file = this.engine.openFile(this.nodeId);
            const text = await file.asset(this.profileName(id, revision)).readText();
            if (text) return JSON.parse(text) as BranchContextProfile;
        } catch { /* profile file missing */ }
        return null;
    }

    /**
     * Copy-on-write: create a new revision with updated rules.
     * Returns the new profile (with incremented revision).
     * The old revision remains untouched for other branches.
     */
    async updateProfile(
        id: ContextProfileId,
        revision: number,
        ruleUpdates: Record<RoundId, ContextRule>,
    ): Promise<BranchContextProfile> {
        return this.withWrite(async () => {
            const existing = await this.getProfile(id, revision);
            if (!existing) throw new Error(`Profile not found: ${id} r${revision}`);
            const nextRevision = revision + 1;
            if (await this.getProfile(id, nextRevision)) {
                throw new Error(`Context profile revision conflict: expected ${revision}, latest is at least ${nextRevision}`);
            }
            const newProfile: BranchContextProfile = {
                id,
                revision: nextRevision,
                createdAt: Date.now(),
                rules: { ...existing.rules, ...ruleUpdates },
            };
            await this.writeProfile(newProfile);
            return newProfile;
        });
    }

    /** Resolve the effective context mode for a given round. */
    async effectiveMode(
        profileId: ContextProfileId,
        profileRevision: number,
        roundId: RoundId,
        defaultMode: 'include' | 'exclude' | undefined,
    ): Promise<'include' | 'exclude' | 'summary'> {
        const profile = await this.getProfile(profileId, profileRevision);
        if (profile?.rules[roundId]) return profile.rules[roundId].mode;
        if (defaultMode) return defaultMode;
        return 'include';
    }

    private async writeProfile(profile: BranchContextProfile): Promise<void> {
        await this.engine.createAsset(
            this.nodeId,
            this.profileName(profile.id, profile.revision),
            JSON.stringify(profile, null, 2),
        );
    }

    private profileName(id: ContextProfileId, revision: number): string {
        return `context-profile-${id}-r${revision}.json`;
    }

    private async withWrite<T>(operation: () => Promise<T>): Promise<T> {
        const key = this.nodeId;
        const previous = ContextProfileStore.writeTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        const tail = previous.then(() => current);
        ContextProfileStore.writeTails.set(key, tail);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (ContextProfileStore.writeTails.get(key) === tail) ContextProfileStore.writeTails.delete(key);
        }
    }
}
