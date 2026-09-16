import { BaseFoundryAdapter } from '../foundry/base-foundry-adapter.js';
import { isLocalizedMultiattackName } from '../../multiattack/grammar.js';
import { log } from '../../lib/logger.js';

export interface MultiattackContext {
    actor: Actor;
    token: Token | null;
    item: Item;
    description: string;
}

/**
 * Base abstract class for game system adapters (e.g., D&D 5e).
 */
export class BaseSystemAdapter {
    systemId: string;
    isSupported: boolean;
    foundry: BaseFoundryAdapter;

    constructor(systemId: string, isSupported: boolean, foundry: BaseFoundryAdapter) {
        this.systemId = systemId;
        this.isSupported = isSupported;
        this.foundry = foundry;
    }

    /**
     * Strips HTML tags and normalizes whitespace from a raw HTML description string.
     * @param {string} rawHtml Raw HTML string
     * @returns {string} Clean plain text string
     */
    cleanDescriptionText(rawHtml: string): string {
        if (!rawHtml) return '';
        return rawHtml
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&ndash;/gi, '-')
            .replace(/&mdash;/gi, '-')
            .replace(/&#39;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Checks whether a ChatMessage corresponds to the activation of a Multiattack feature.
     * @param {ChatMessage} message The chat message document
     * @returns {boolean}
     */
    isMultiattackMessage(message: ChatMessage): boolean {
        if (!message) return false;

        // Ignore roll cards (attack, damage, saving throws)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flags = (message as any).flags ?? {};
        const dnd5eRollType = flags.dnd5e?.roll?.type;
        if (dnd5eRollType && ['attack', 'damage', 'save', 'check', 'tool'].includes(dnd5eRollType)) {
            return false;
        }

        const context = this.extractMultiattackContext(message);
        return context !== null;
    }

    /**
     * Extracts the Actor, Token, Multiattack Item, and cleaned Description from a ChatMessage.
     * @param {ChatMessage} message The chat message document
     * @returns {MultiattackContext | null}
     */
    extractMultiattackContext(message: ChatMessage): MultiattackContext | null {
        if (!message) return null;

        const actor = this.foundry.getSpeakerActor(message);
        if (!actor) return null;

        const token = this.foundry.getSpeakerToken(message);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flags = (message as any).flags ?? {};

        let item: Item | null = null;

        // 1. Try resolving item ID from system flags (e.g. flags.dnd5e.item.id or flags.dnd5e.use.itemId)
        const flagItemId = flags.dnd5e?.item?.id ?? flags.dnd5e?.use?.itemId;
        if (flagItemId && actor.items) {
            item = actor.items.get(flagItemId) ?? null;
        }

        // 2. Try matching by localized multiattack item name in flavor or content if item ID wasn't in flags
        if (!item && actor.items) {
            const flavor = String(message.flavor ?? '');
            const content = String(message.content ?? '');
            if (isLocalizedMultiattackName(flavor) || isLocalizedMultiattackName(content)) {
                const items = Array.from(actor.items.values()) as Item[];
                item = items.find((i: Item) => isLocalizedMultiattackName(i.name)) ?? null;
            }
        }

        if (!item) return null;
        if (!isLocalizedMultiattackName(item.name)) return null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawDesc = (item as any).system?.description?.value ?? '';
        const description = this.cleanDescriptionText(rawDesc);

        return {
            actor,
            token,
            item,
            description
        };
    }

    /**
     * Natively rolls/uses an Item document so that core Foundry and any workflow modules (like Midi-QOL)
     * pick up the roll naturally through standard hooks.
     * @param {Item} item Target item document to roll
     * @param {Record<string, unknown>} [options={}] Execution options
     * @returns {Promise<unknown>}
     */
    async useItem(item: Item, options: Record<string, unknown> = {}): Promise<unknown> {
        if (!item) return null;
        log.debug(`BaseSystemAdapter.useItem | Rolling item "${item.name}" natively`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyItem = item as any;
        if (anyItem.use) {
            return anyItem.use({}, options);
        }
        if (anyItem.roll) {
            return anyItem.roll(options);
        }
        return null;
    }

    /**
     * Retrieves all items from an Actor document as an array.
     * @param {Actor} actor Target Actor document
     * @returns {Item[]}
     */
    getActorItems(actor: Actor): Item[] {
        if (!actor?.items) return [];
        return Array.from(actor.items.values()) as Item[];
    }

    /**
     * Checks whether an Item document is a Multiattack feature by checking its localized name.
     * @param {Item} item Target Item document
     * @returns {boolean}
     */
    isMultiattackItem(item: Item): boolean {
        if (!item?.name) return false;
        return isLocalizedMultiattackName(item.name);
    }

    /**
     * Retrieves and cleans the plain-text description of an Item document.
     * @param {Item} item Target Item document
     * @returns {string}
     */
    getItemDescription(item: Item): string {
        if (!item) return '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawDesc = (item as any).system?.description?.value ?? '';
        return this.cleanDescriptionText(rawDesc);
    }

    /**
     * Determines the action type of an item ('mwak', 'rwak', 'msak', 'rsak', or 'other').
     * @param {Item} item Target Item document
     * @returns {'mwak' | 'rwak' | 'msak' | 'rsak' | 'other'}
     */
    getItemActionType(item: Item): 'mwak' | 'rwak' | 'msak' | 'rsak' | 'other' {
        if (!item) return 'other';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sys = (item as any).system ?? {};
        if (sys.actionType && ['mwak', 'rwak', 'msak', 'rsak'].includes(sys.actionType)) {
            return sys.actionType;
        }
        return 'other';
    }

    /**
     * Registers a system-specific hook that triggers when an Item/Activity is used on the local client.
     * @param {(actor: Actor, item: Item, token: Token | null) => Promise<void> | void} _callback
     */
    registerItemUsageHook(_callback: (actor: Actor, item: Item, token: Token | null) => Promise<void> | void): void {
        // Implemented by system adapter subclasses (e.g. Dnd5eSystemAdapter)
    }
}
