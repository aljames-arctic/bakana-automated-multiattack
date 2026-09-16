import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import { adapter } from '../adapter/index.js';
import { abstractMultiattackDescription, hydrateMultiattackSequence } from '../multiattack/abstraction.js';
import { parseMultiattackTemplate } from '../multiattack/parser.js';
import { llmClient } from '../multiattack/llm-client.js';
import type { AutorecEntry, MultiattackSequence } from '../types/global.d.js';

/**
 * Canonical built-in D&D 5e abstracted templates.
 * A single template entry matches dozens of monsters with identical sentence structures.
 */
export const SYSTEM_DEFAULT_TEMPLATES: AutorecEntry[] = [
    {
        id: 'default-two-attacks-1-1',
        name: 'Two Attacks (1 Primary + 1 Secondary)',
        type: 'template',
        pattern: '<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>.',
        sequence: [[['<ITEM_0>', '<ITEM_1>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-two-same-attacks',
        name: 'Two Identical Weapon Attacks',
        type: 'template',
        pattern: '<ACTOR> makes two <ITEM_0> attacks.',
        sequence: [[['<ITEM_0>', '<ITEM_0>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-three-same-attacks',
        name: 'Three Identical Weapon Attacks',
        type: 'template',
        pattern: '<ACTOR> makes three <ITEM_0> attacks.',
        sequence: [[['<ITEM_0>', '<ITEM_0>', '<ITEM_0>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-four-same-attacks',
        name: 'Four Identical Attacks',
        type: 'template',
        pattern: '<ACTOR> makes four <ITEM_0> attacks.',
        sequence: [[['<ITEM_0>', '<ITEM_0>', '<ITEM_0>', '<ITEM_0>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-three-attacks-1-2',
        name: 'Three Attacks (1 Primary + 2 Secondary)',
        type: 'template',
        pattern: '<ACTOR> makes three attacks: one with its <ITEM_0> and two with its <ITEM_1>.',
        sequence: [[['<ITEM_0>', '<ITEM_1>', '<ITEM_1>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-three-attacks-2-1',
        name: 'Three Attacks (2 Primary + 1 Secondary)',
        type: 'template',
        pattern: '<ACTOR> makes three attacks: two with its <ITEM_0> and one with its <ITEM_1>.',
        sequence: [[['<ITEM_0>', '<ITEM_0>', '<ITEM_1>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-three-attacks-1-1-1',
        name: 'Three Distinct Attacks (1 + 1 + 1)',
        type: 'template',
        pattern: '<ACTOR> makes three attacks: one with its <ITEM_0>, one with its <ITEM_1>, and one with its <ITEM_2>.',
        sequence: [[['<ITEM_0>', '<ITEM_1>', '<ITEM_2>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-dragon-frightful-then-3',
        name: 'Dragon Multiattack (Ability then 1 Bite + 2 Claws)',
        type: 'template',
        pattern: '<ACTOR> can use its <ITEM_0>. <ACTOR> then makes three attacks: one with its <ITEM_1> and two with its <ITEM_2>.',
        sequence: [[['<ITEM_0>']], [['<ITEM_1>', '<ITEM_2>', '<ITEM_2>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-bandit-captain-branch',
        name: 'Melee Combo or Ranged Option (Bandit Captain)',
        type: 'template',
        pattern: '<ACTOR> makes three melee attacks: two with its <ITEM_0> and one with its <ITEM_1>. Or <ACTOR> makes two ranged attacks with its <ITEM_1>.',
        sequence: [[['<ITEM_0>', '<ITEM_0>', '<ITEM_1>'], ['<ITEM_1>', '<ITEM_1>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-gladiator-generic',
        name: 'Generic Melee or Ranged Branch (Gladiator)',
        type: 'template',
        pattern: '<ACTOR> makes three melee attacks or two ranged attacks.',
        sequence: [[['melee attack', 'melee attack', 'melee attack'], ['ranged attack', 'ranged attack']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    },
    {
        id: 'default-veteran-conditional',
        name: 'Two Attacks + Optional Drawn Weapon (Veteran)',
        type: 'template',
        pattern: '<ACTOR> makes two <ITEM_0> attacks. If <ACTOR> has a <ITEM_1> drawn, it can also make a <ITEM_1> attack.',
        sequence: [[['<ITEM_0>', '<ITEM_0>', '<ITEM_1>'], ['<ITEM_0>', '<ITEM_0>']]],
        enabled: true,
        sourceModule: 'system-default',
        version: '1.0.0'
    }
];

export interface AutorecLookupResult {
    sequence: MultiattackSequence;
    source: 'override' | 'template' | 'deterministic' | 'llm';
    entry: AutorecEntry;
    template: string;
    itemMap: Record<string, string>;
}

/**
 * Central Autorecognition Manager for Bakana's Automated Multiattack.
 * Stores all recognized templates and monster overrides in module settings rather than actor/item flags.
 */
export class AutorecManager {
    private _entries: Map<string, AutorecEntry>;

    constructor() {
        this._entries = new Map();
        this.resetToDefaults(false);
    }

    /**
     * Resets in-memory entries to system defaults and optionally persists to world settings.
     * @param {boolean} [persist=true] Whether to save to world settings
     */
    async resetToDefaults(persist: boolean = true): Promise<void> {
        this._entries.clear();
        for (const entry of SYSTEM_DEFAULT_TEMPLATES) {
            this._entries.set(entry.id, adapter.deepClone(entry));
        }
        if (persist) {
            await this.saveToSettings();
        }
    }

    /**
     * Loads saved entries from Foundry world setting `autorecEntries`.
     * Only falls back to seeding `SYSTEM_DEFAULT_TEMPLATES` if no saved setting object exists yet.
     * @param {Record<string, AutorecEntry> | AutorecEntry[]} [saved] Saved entries object or array
     */
    loadSavedEntries(saved?: Record<string, AutorecEntry> | AutorecEntry[]): void {
        this._entries.clear();

        const rawSaved = saved ?? (game.settings?.get(MODULE_ID, 'autorecEntries') as Record<string, AutorecEntry> | undefined);
        if (rawSaved === undefined || rawSaved === null) {
            for (const def of SYSTEM_DEFAULT_TEMPLATES) {
                this._entries.set(def.id, adapter.deepClone(def));
            }
            return;
        }

        const list = Array.isArray(rawSaved) ? rawSaved : Object.values(rawSaved);

        for (const entry of list) {
            if (entry && entry.id && typeof entry.pattern === 'string' && Array.isArray(entry.sequence)) {
                this._entries.set(entry.id, {
                    ...entry,
                    enabled: entry.enabled !== false
                });
            }
        }
    }

    /**
     * Persists all registered entries to the Foundry world setting `autorecEntries`.
     */
    async saveToSettings(): Promise<void> {
        if (!game.settings) return;
        const record: Record<string, AutorecEntry> = {};
        for (const [id, entry] of this._entries.entries()) {
            record[id] = entry;
        }
        try {
            if (game.user?.isGM) {
                await game.settings.set(MODULE_ID, 'autorecEntries', record);
            }
        } catch (err) {
            log.warn('AutorecManager.saveToSettings | Could not persist autorec entries to world settings:', err);
        }
    }

    /**
     * Returns all registered entries as an array.
     */
    getAllEntries(): AutorecEntry[] {
        return Array.from(this._entries.values());
    }

    /**
     * Finds an existing AutorecEntry with the same normalized pattern (optionally excluding a specific entry ID).
     */
    findDuplicatePattern(pattern: string, excludeId?: string): AutorecEntry | null {
        const clean = this._normalizePatternKey(pattern ?? '');
        if (!clean) return null;
        for (const entry of this._entries.values()) {
            if (excludeId && entry.id === excludeId) continue;
            if (this._normalizePatternKey(entry.pattern) === clean) {
                return entry;
            }
        }
        return null;
    }

    /**
     * Registers or updates an AutorecEntry in the central store.
     * If a new entry's pattern matches an existing entry, prevents creating a duplicate and updates/returns the existing entry.
     * @param {AutorecEntry} entry Entry to register
     * @param {boolean} [persist=true] Whether to persist to world settings immediately
     */
    async registerEntry(entry: AutorecEntry, persist: boolean = true): Promise<AutorecEntry> {
        const rawPattern = (entry.pattern ?? '').trim();

        if (rawPattern) {
            const dup = this.findDuplicatePattern(rawPattern, entry.id);
            if (dup) {
                // If entry.id was a temporary unfilled entry, delete the temporary unfilled entry
                if (entry.id && entry.id !== dup.id) {
                    const existingSelf = this._entries.get(entry.id);
                    if (!existingSelf || !existingSelf.pattern.trim()) {
                        this._entries.delete(entry.id);
                    }
                }
                const updatedDup: AutorecEntry = {
                    ...dup,
                    name: entry.name ? entry.name : dup.name,
                    sequence: Array.isArray(entry.sequence) && entry.sequence.length > 0 ? entry.sequence : dup.sequence,
                    enabled: entry.enabled !== false
                };
                this._entries.set(dup.id, updatedDup);
                if (persist) {
                    await this.saveToSettings();
                }
                return updatedDup;
            }
        }

        const cleanEntry: AutorecEntry = {
            id: entry.id ? entry.id : `bam-${adapter.randomID(8)}`,
            name: entry.name ? entry.name : (rawPattern ? rawPattern.slice(0, 48) : 'New Template'),
            type: entry.type === 'override' ? 'override' : 'template',
            pattern: rawPattern,
            sequence: Array.isArray(entry.sequence) ? entry.sequence : [],
            enabled: entry.enabled !== false,
            sourceModule: entry.sourceModule ?? 'world',
            version: entry.version ?? '1.0.0'
        };
        this._entries.set(cleanEntry.id, cleanEntry);
        if (persist) {
            await this.saveToSettings();
        }
        return cleanEntry;
    }

    /**
     * Deletes an entry by ID.
     */
    async deleteEntry(id: string, persist: boolean = true): Promise<boolean> {
        const deleted = this._entries.delete(id);
        if (deleted && persist) {
            await this.saveToSettings();
        }
        return deleted;
    }

    /**
     * Normalizes a pattern string for case-insensitive comparison.
     */
    private _normalizePatternKey(pattern: string): string {
        return pattern
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/^the\s+<actor>(?=[\s,.]|$)/, '<actor>');
    }

    /**
     * Looks up an existing AutorecEntry matching the actor/item override or abstracted template.
     * Does not run new parsing or LLM queries.
     */
    lookup(actor: Actor, item: Item, description: string): AutorecLookupResult | null {
        const actorName = actor?.name?.trim() ?? '';
        const itemName = item?.name?.trim() ?? 'Multiattack';
        const actorItems = adapter.getActorItems(actor);

        // 1. Check specific Actor::Item override
        const overrideKey = `${actorName}::${itemName}`.toLowerCase();
        for (const entry of this._entries.values()) {
            if (!entry.enabled || entry.type !== 'override') continue;
            if (entry.pattern.trim().toLowerCase() === overrideKey || entry.pattern.trim().toLowerCase() === actorName.toLowerCase()) {
                return {
                    sequence: adapter.deepClone(entry.sequence),
                    source: 'override',
                    entry,
                    template: overrideKey,
                    itemMap: {}
                };
            }
        }

        // 2. Abstract description and check central template entries
        const { template, itemMap } = abstractMultiattackDescription(description, actorItems, actorName);
        if (!template) return null;

        const normTemplate = this._normalizePatternKey(template);
        for (const entry of this._entries.values()) {
            if (!entry.enabled || entry.type !== 'template') continue;
            if (this._normalizePatternKey(entry.pattern) === normTemplate) {
                const hydrated = hydrateMultiattackSequence(entry.sequence, itemMap);
                return {
                    sequence: hydrated,
                    source: 'template',
                    entry,
                    template,
                    itemMap
                };
            }
        }

        return null;
    }

    /**
     * Resolves the concrete 3D MultiattackSequence for an actor and item.
     * 1. Checks central Autorec overrides & templates.
     * 2. If not found, runs deterministic template parser.
     * 3. If deterministic fails and LLM fallback is enabled, queries LLM.
     * 4. Newly gathered templates are automatically stored in the central Autorecognition Menu (never in actor/item flags).
     */
    async resolveOrGather(actor: Actor, item: Item, description: string): Promise<AutorecLookupResult | null> {
        // 1. Central lookup
        const existing = this.lookup(actor, item, description);
        if (existing) {
            log.debug(`AutorecManager.resolveOrGather | Matched central ${existing.source} entry "${existing.entry.name}"`);
            return existing;
        }

        const actorName = actor?.name?.trim() ?? '';
        const actorItems = adapter.getActorItems(actor);
        const { template, itemMap } = abstractMultiattackDescription(description, actorItems, actorName);
        if (!template) return null;

        // 2. Deterministic Grammar Parser
        let rawTemplateSequence = parseMultiattackTemplate(template);
        let source: 'deterministic' | 'llm' = 'deterministic';

        // 3. Optional LLM Fallback if deterministic parser could not parse complex homebrew phrasing
        if (!rawTemplateSequence) {
            const enableLlm = Boolean(game.settings?.get(MODULE_ID, 'enableLlmFallback'));
            if (enableLlm) {
                log.info(`AutorecManager.resolveOrGather | Querying LLM for unrecognized template: "${template}"`);
                rawTemplateSequence = await llmClient.queryMultiattackTemplate(template);
                source = 'llm';
            }
        }

        if (!rawTemplateSequence) {
            log.warn(`AutorecManager.resolveOrGather | Could not parse multiattack description for "${actorName}": "${description}"`);
            return null;
        }

        // 4. Automatically register the newly gathered template in the central Autorecognition Manager!
        const newEntry = await this.registerEntry({
            id: `gathered-${adapter.randomID(8)}`,
            name: `Auto-Gathered (${actorName || 'Template'})`,
            type: 'template',
            pattern: template,
            sequence: rawTemplateSequence,
            enabled: true,
            sourceModule: source,
            version: '1.0.0'
        });

        const hydrated = hydrateMultiattackSequence(rawTemplateSequence, itemMap);
        return {
            sequence: hydrated,
            source,
            entry: newEntry,
            template,
            itemMap
        };
    }
}

export const autorecManager = new AutorecManager();
