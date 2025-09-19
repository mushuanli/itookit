// src/anki/services/dataService.js

import { db } from '../../common/db.js';
import { generateId } from '../../common/utils.js';
import { INITIAL_ANKI_CONTENT } from '../../common/config.js';
import { parseAndStructureHeadings } from './renderService.js'; // [NEW] 导入统一的解析函数

// --- Initialization ---

// [RESTORED] The function to parse H1/H2 headings from Markdown content.
function anki_parseAndStructureHeadings(content) {
    const headingRegex = /^(#{1,2})\s+(.+)$/gm;
    const structuredHeadings = [];
    let lastH1 = null;
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
        const level = match[1].length;
        const text = match[2].trim();
        const heading = {
            id: generateId(), // Give each heading a unique transient ID
            text,
            level,
            children: level === 1 ? [] : undefined
        };

        if (level === 1) {
            structuredHeadings.push(heading);
            lastH1 = heading;
        } else if (level === 2 && lastH1) {
            lastH1.children.push(heading);
        }
    }
    return structuredHeadings;
}


/**
 * Loads all initial data required for the Anki module from IndexedDB.
 * @returns {Promise<object>} An object containing the initial state.
 */
export async function loadInitialAnkiState() {
    const [sessions, folders, clozeStates, appStateValues] = await Promise.all([
        db.anki_sessions.toArray(),
        db.anki_folders.toArray(),
        db.anki_clozeStates.toArray(),
        db.global_appState.toArray(),
    ]);

    const reconstructedClozeStates = clozeStates.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});

    const persistentAppState = appStateValues.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});
    
    // Handle case where DB is empty
    if (sessions.length === 0) {
        const id = generateId();
        const initialSession = { id, name: '初始笔记', content: INITIAL_ANKI_CONTENT, type: 'file', folderId: null, createdAt: new Date() };
        sessions.push(initialSession);
        persistentAppState.currentSessionId = id;
        await db.anki_sessions.add(initialSession); // Persist the initial file
    }

    // [FIXED] After loading sessions, parse headings for each one.
    const fileSubsessions = {};
    sessions.forEach(session => {
        fileSubsessions[session.id] = anki_parseAndStructureHeadings(session.content);
    });

    return {
        sessions,
        folders,
        clozeStates: reconstructedClozeStates,
        fileSubsessions, // Return the parsed headings
        ...persistentAppState
    };
}

// --- File & Folder Management ---

export async function anki_addFile(name, content = INITIAL_ANKI_CONTENT, parentFolderId) {
    const newFile = { 
        id: generateId(), 
        name, 
        content, 
        type: 'file', 
        folderId: parentFolderId, 
        createdAt: new Date() 
    };
    await db.anki_sessions.add(newFile);
    
    // 直接返回文件对象，保持一致性
    return newFile;
}


export async function anki_addFolder(name, parentFolderId) {
    const newFolder = { 
        id: generateId(), 
        name, 
        type: 'folder', 
        folderId: parentFolderId, 
        createdAt: new Date() 
    };
    await db.anki_folders.add(newFolder);
    return newFolder;
}

export async function anki_removeItems(itemIds) {
    const idsToRemove = new Set(itemIds);
    const allFolders = await db.anki_folders.toArray();
    const allSessions = await db.anki_sessions.toArray();
    
    // Find all descendant folders and files to delete
    const folderIdsToDelete = new Set();
    itemIds.forEach(id => {
        if (allFolders.some(f => f.id === id)) {
            folderIdsToDelete.add(id);
        }
    });

    let changed = true;
    while(changed) {
        changed = false;
        allFolders.forEach(f => {
            if (folderIdsToDelete.has(f.folderId) && !folderIdsToDelete.has(f.id)) {
                folderIdsToDelete.add(f.id);
                changed = true;
            }
        });
    }

    const fileIdsToDelete = new Set(allSessions.filter(s => folderIdsToDelete.has(s.folderId) || idsToRemove.has(s.id)).map(s => s.id));
    
    // Perform deletions in a transaction
    await db.transaction('rw', [db.anki_sessions, db.anki_folders, db.anki_clozeStates], async () => {
        await db.anki_folders.bulkDelete(Array.from(folderIdsToDelete));
        await db.anki_sessions.bulkDelete(Array.from(fileIdsToDelete));
        
        // Delete associated cloze states
        const clozeKeysToDelete = (await db.anki_clozeStates.where('fileId').anyOf(Array.from(fileIdsToDelete)).toArray()).map(c => c.id);
        await db.anki_clozeStates.bulkDelete(clozeKeysToDelete);
    });
    
    // Return remaining items for state update
    return {
        remainingSessions: await db.anki_sessions.toArray(),
        remainingFolders: await db.anki_folders.toArray(),
        remainingClozeStates: (await db.anki_clozeStates.toArray()).reduce((acc, item) => {
            acc[item.id] = item;
            return acc;
        }, {})
    };
}

export async function anki_moveItems(itemIds, targetFolderId) {
    const itemsToUpdate = await Promise.all([
        db.anki_sessions.where('id').anyOf(itemIds).toArray(),
        db.anki_folders.where('id').anyOf(itemIds).toArray(),
    ]);

    const updatedSessions = itemsToUpdate[0].map(s => ({...s, folderId: targetFolderId}));
    const updatedFolders = itemsToUpdate[1].map(f => ({...f, folderId: targetFolderId}));

    await db.transaction('rw', [db.anki_sessions, db.anki_folders], async () => {
        if (updatedSessions.length > 0) await db.anki_sessions.bulkPut(updatedSessions);
        if (updatedFolders.length > 0) await db.anki_folders.bulkPut(updatedFolders);
    });

    return { updatedSessions: await db.anki_sessions.toArray(), updatedFolders: await db.anki_folders.toArray() };
}

export async function anki_updateItemName(itemId, newName, itemType) {
    const table = itemType === 'file' ? db.anki_sessions : db.anki_folders;
    await table.update(itemId, { name: newName });
    return await table.get(itemId);
}

// --- Session & Content ---

export async function saveSession(sessionId, content) {
    await db.anki_sessions.update(sessionId, { content, lastActive: new Date() });
    await db.global_appState.put({ key: 'currentSessionId', value: sessionId });

    // [FIXED] Return the parsed subsessions for the updated content.
    return {
        subsessions: anki_parseAndStructureHeadings(content)
    };
}

// --- Cloze & SRS ---

export async function anki_updateClozeState(newState) {
    await db.anki_clozeStates.put(newState);
}

export async function anki_getDueClozes(filters) {
    let dueClozes = await db.anki_clozeStates.where('due').belowOrEqual(Date.now()).toArray();

    if (filters) {
        // Apply custom filters on top of the due clozes
        const allSessions = await db.anki_sessions.toArray();
        const sessionMap = new Map(allSessions.map(s => [s.id, s]));

        dueClozes = dueClozes.filter(cs => {
            const session = sessionMap.get(cs.fileId);
            if (!session) return false;

            // File/Folder filter
            const { fileOrFolder } = filters;
            if (fileOrFolder && fileOrFolder !== 'all') {
                if (fileOrFolder.startsWith('file_')) {
                    if (cs.fileId !== fileOrFolder.substring(5)) return false;
                } else if (fileOrFolder.startsWith('folder_')) {
                    if (session.folderId !== fileOrFolder.substring(7)) return false;
                }
            }

            // Card state filter
            if (filters.cardStates && !filters.cardStates.includes(cs.state)) return false;
            
            return true;
        });

        // Shuffle and limit
        dueClozes.sort(() => Math.random() - 0.5);
        if (filters.maxCards) {
            dueClozes = dueClozes.slice(0, filters.maxCards);
        }
    }
    
    return dueClozes;
}

// --- Statistics ---

export async function anki_recordReview(fileId) {
    if (!fileId) return;
    const file = await db.anki_sessions.get(fileId);
    if (!file) return;

    const folderId = file.folderId || 'root';
    const date = new Date().toISOString().slice(0, 10);
    const id = `${date}:${folderId}`;
    
    await db.transaction('rw', db.anki_reviewStats, async () => {
        const stat = await db.anki_reviewStats.get(id);
        if (stat) {
            await db.anki_reviewStats.update(id, { count: stat.count + 1 });
        } else {
            await db.anki_reviewStats.add({ id, date, folderId, count: 1 });
        }
    });
}

export async function anki_getTodaysTotalCount() {
    const today = new Date().toISOString().slice(0, 10);
    const stats = await db.anki_reviewStats.where('date').equals(today).toArray();
    return stats.reduce((total, current) => total + current.count, 0);
}

export function getFolderNavigationState(currentStack, currentFolderId, targetFolderId) {
    const stackIndex = currentStack.indexOf(targetFolderId);
    if (stackIndex > -1) {
        // Going up the tree
        return {
            newCurrentFolderId: targetFolderId,
            newFolderStack: currentStack.slice(0, stackIndex)
        };
    } else {
        // Going down the tree
        return {
            newCurrentFolderId: targetFolderId,
            newFolderStack: [...currentStack, currentFolderId].filter(Boolean)
        };
    }
}