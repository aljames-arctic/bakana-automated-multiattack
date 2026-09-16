import { MODULE_ID } from '../constants.js';
import { log, notify } from '../lib/logger.js';
import { localize } from '../lib/utils.js';
import { adapter } from '../adapter/index.js';
import { autorecManager } from '../autorec/autorecManager.js';
import { resolveActorItem } from './abstraction.js';
import type { SelectOptionItem } from '../types/global.d.js';

/**
 * Removes the first occurrence of `item` from `arr`, returning a new array.
 */
export function removeFirstOccurrence(arr: string[], item: string): string[] {
    const idx = arr.findIndex((x) => x.toLowerCase() === item.toLowerCase());
    if (idx === -1) return [...arr];
    return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

/**
 * Checks whether an actor possesses a valid item for the given token string,
 * or if the token is a generic category ('melee attack' / 'ranged attack').
 */
export function actorHasAttackOption(actor: Actor, token: string): boolean {
    const lower = token.trim().toLowerCase();
    if (lower === 'melee attack' || lower === 'ranged attack') {
        const items = adapter.getActorItems(actor);
        const targetTypes = lower === 'melee attack' ? ['mwak', 'msak'] : ['rwak', 'rsak'];
        return items.some((item) => targetTypes.includes(adapter.getItemActionType(item)));
    }
    return resolveActorItem(actor, token) !== null;
}

/**
 * Resolves a concrete Item document to roll for a given selection string.
 * If the selection is generic ('melee attack' or 'ranged attack') and multiple weapons match,
 * prompts the user via `adapter.selectOptionDialog`.
 */
export async function resolveConcreteAttackItem(actor: Actor, selection: string): Promise<Item | null> {
    const lower = selection.trim().toLowerCase();

    if (lower === 'melee attack' || lower === 'ranged attack') {
        const items = adapter.getActorItems(actor);
        const targetTypes = lower === 'melee attack' ? ['mwak', 'msak'] : ['rwak', 'rsak'];
        const matchingItems = items.filter((item) => targetTypes.includes(adapter.getItemActionType(item)));

        if (matchingItems.length === 0) {
            notify.warn(`Multiattack: Could not find a valid ${selection} on ${actor.name}.`);
            return null;
        }
        if (matchingItems.length === 1) {
            return matchingItems[0] ?? null;
        }

        const options: SelectOptionItem[] = matchingItems.map((item) => ({
            value: item.name,
            label: item.name,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            img: (item as any).img ?? undefined
        }));

        const title = lower === 'melee attack'
            ? localize('BAM.selectDialog.meleePromptTitle', 'Select Melee Weapon')
            : localize('BAM.selectDialog.rangedPromptTitle', 'Select Ranged Weapon');

        const chosenName = await adapter.selectOptionDialog(options, { title });
        if (!chosenName) return null;
        return resolveActorItem(actor, chosenName);
    }

    const item = resolveActorItem(actor, selection);
    if (!item) {
        notify.warn(`Multiattack: Cannot find attack item "${selection}" on ${actor.name}.`);
    }
    return item;
}

/**
 * Executes a single section's option map (`string[][]`) interactively or automatically.
 * Reduces remaining options after each attack roll until a sequence flow completes or is cancelled.
 *
 * @param {Actor} actor Concrete Actor performing the multiattack
 * @param {string[][]} initialOptionMap 2D array of alternative attack sequences for this section
 * @param {Token | null} [token=null] Optional caster token placeable
 */
export async function executeSectionOptionMap(
    actor: Actor,
    initialOptionMap: string[][],
    token: Token | null = null
): Promise<void> {
    // Filter flows to only items the actor actually possesses
    let optionMap = initialOptionMap
        .map((flow) => flow.filter((atk) => actorHasAttackOption(actor, atk)))
        .filter((flow) => flow.length > 0 || initialOptionMap.some((orig) => orig.length === 0));

    let stepCount = 1;

    while (optionMap.length > 0) {
        // Check if all remaining flows are empty (sequence complete)
        const nonEmptyFlows = optionMap.filter((flow) => flow.length > 0);
        if (nonEmptyFlows.length === 0) {
            break;
        }

        const hasFinishOption = optionMap.some((flow) => flow.length === 0);

        // Gather unique attack tokens across all non-empty flows
        const uniqueTokens = Array.from(new Set(nonEmptyFlows.flatMap((flow) => flow)));
        if (uniqueTokens.length === 0) {
            break;
        }

        const autoSelectSingle = game.settings?.get(MODULE_ID, 'autoSelectSingleOption') !== false;
        let selectedToken: string | null = null;

        // Auto-select if there is only 1 unique choice and no optional finish branch
        if (uniqueTokens.length === 1 && !hasFinishOption && autoSelectSingle) {
            selectedToken = uniqueTokens[0] ?? null;
        } else {
            // Build popup select options
            const dialogOptions: SelectOptionItem[] = uniqueTokens.map((atkToken) => {
                const resolvedItem = resolveActorItem(actor, atkToken);
                // Calculate max remaining count of this token in any single flow
                const maxCount = Math.max(...nonEmptyFlows.map((f) => f.filter((x) => x.toLowerCase() === atkToken.toLowerCase()).length));
                return {
                    value: atkToken,
                    label: resolvedItem?.name ?? atkToken,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    img: (resolvedItem as any)?.img ?? undefined,
                    badge: maxCount > 1 ? `x${maxCount}` : undefined
                };
            });

            if (hasFinishOption) {
                dialogOptions.push({
                    value: '__FINISH__',
                    label: localize('BAM.selectDialog.finishLabel', 'Finish Multiattack (Skip Optional)'),
                    isFinish: true
                });
            }

            selectedToken = await adapter.selectOptionDialog(dialogOptions, {
                title: `${actor.name} — ${localize('BAM.selectDialog.title', 'Select Multiattack Option')}`,
                subtitle: `Attack Step ${stepCount}`
            });
        }

        if (!selectedToken || selectedToken === '__FINISH__') {
            log.debug(`executeSectionOptionMap | Sequence finished or cancelled at step ${stepCount}`);
            break;
        }

        // Resolve and natively use the chosen attack item
        const attackItem = await resolveConcreteAttackItem(actor, selectedToken);
        if (attackItem) {
            const clearTargets = Boolean(game.settings?.get(MODULE_ID, 'clearTargetsBetweenAttacks'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyUser = game.user as any;
            if (clearTargets && anyUser?.updateTokenTargets) {
                anyUser.updateTokenTargets([]);
            }
            await adapter.useItem(attackItem, { token });
        }

        // Reduce optionMap: keep flows containing `selectedToken` and remove one occurrence from each
        optionMap = nonEmptyFlows
            .filter((flow) => flow.some((x) => x.toLowerCase() === selectedToken!.toLowerCase()))
            .map((flow) => removeFirstOccurrence(flow, selectedToken!));

        stepCount++;
    }
}

/**
 * Main entry point to execute an automated Multiattack for an Actor and Multiattack Item.
 *
 * @param {Actor} actor Concrete Actor document
 * @param {Item} item Multiattack Item document
 * @param {Token | null} [token=null] Optional Token placeable
 */
export async function executeMultiattack(
    actor: Actor,
    item: Item,
    token: Token | null = null
): Promise<void> {
    if (!actor || !item) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawDesc = (item as any).system?.description?.value ?? '';
    const cleanDesc = adapter.system.cleanDescriptionText(rawDesc);

    log.info(`Executing Multiattack for "${actor.name}" (Item: "${item.name}")`);
    const resolved = await autorecManager.resolveOrGather(actor, item, cleanDesc);
    if (!resolved || !resolved.sequence || resolved.sequence.length === 0) {
        notify.warn(`Multiattack: Could not determine attack sequence for "${actor.name}". Check the Multiattack Autorecognition Menu.`);
        return;
    }

    for (const sectionOptionMap of resolved.sequence) {
        await executeSectionOptionMap(actor, sectionOptionMap, token);
    }
}

/**
 * Registers Foundry VTT and D&D 5e v4+ Activity hooks for automatic Multiattack execution
 * upon feature usage (`dnd5e.postUseActivity`) and optional chat card button injection.
 * Eliminates the need for DIME / macro item triggers or websocket chat card scraping.
 */
export function registerMultiattackHooks(): void {
    // 1. Automatic trigger on D&D 5e v4+ Activity usage (executes strictly on the initiating client)
    adapter.registerItemUsageHook(async (actor: Actor, item: Item, token: Token | null) => {
        const autoTrigger = game.settings?.get(MODULE_ID, 'autoTriggerOnUse') !== false;
        if (!autoTrigger) return;

        await executeMultiattack(actor, item, token);
    });

    // 2. Inject interactive "Execute Multiattack" button into Multiattack chat cards for manual re-triggering
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const injectButton = (message: ChatMessage, html: any) => {
        if (!adapter.isMultiattackMessage(message)) return;
        const showBtn = game.settings?.get(MODULE_ID, 'showChatCardButton') !== false;
        if (!showBtn) return;

        const root: HTMLElement | null = html instanceof HTMLElement ? html : html?.[0] ?? null;
        if (!root || !root.querySelector) return;

        // Avoid duplicate injection
        if (root.querySelector('.bam-chat-card-btn')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'bam-chat-card-btn-wrapper';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bam-chat-card-btn';
        btn.innerHTML = `<i class="fas fa-swords"></i> <span>${localize('BAM.chatCard.executeBtn', 'Execute Multiattack')}</span>`;

        btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const context = adapter.extractMultiattackContext(message);
            if (context) {
                await executeMultiattack(context.actor, context.item, context.token);
            }
        });

        wrapper.appendChild(btn);
        const cardContent = root.querySelector('.card-content, .message-content') ?? root;
        cardContent.appendChild(wrapper);
    };

    Hooks.on('renderChatMessageHTML', injectButton);
    Hooks.on('renderChatMessage', injectButton);
}

/** Alias for backwards compatibility */
export const registerMultiattackChatHooks = registerMultiattackHooks;
