import { MODULE_ID } from '../constants.js';
import { log, notify } from '../lib/logger.js';
import { localize } from '../lib/utils.js';
import { adapter } from '../adapter/index.js';
import { autorecManager } from '../autorec/autorecManager.js';
import { resolveActorItem, enrichSequenceWithDiscoveredSubActivities } from './abstraction.js';
import type { SelectOptionItem } from '../types/global.d.js';

export interface ResolvedAttackTarget {
    item: Item;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activity?: any;
    activityId?: string;
    activityName?: string;
}

export interface TokenComponents {
    raw: string;
    strictOrder: boolean;
    cleanToken: string;       // e.g. "Flail:Activity1:1" -> "Flail:Activity1"
    itemName: string;         // e.g. "Flail"
    activityName?: string;    // e.g. "Activity1"
    uses?: number;            // e.g. 1
}

/**
 * Strips leading strict-order prefix (`>`) from an attack token string.
 */
export function stripOrderPrefix(token: string): string {
    return String(token ?? '').replace(/^>\s*/, '').trim();
}

/**
 * Parses a token string strictly using the standard `Item:Activity:Uses` notation (`Item:Activity:n`).
 * Components are separated by colons (`:`).
 * If the last colon segment is numeric (e.g. `:1` or `:2`), it is treated as max uses.
 */
export function parseTokenComponents(token: string): TokenComponents {
    const raw = String(token ?? '').trim();
    const strictOrder = raw.startsWith('>');
    const clean = stripOrderPrefix(raw);

    if (!clean.includes(':') || (clean.startsWith('(') && clean.endsWith(')'))) {
        return {
            raw,
            strictOrder,
            cleanToken: clean,
            itemName: clean
        };
    }

    const parts = clean.split(':').map((s) => s.trim()).filter(Boolean);
    let uses: number | undefined = undefined;
    let itemName = parts[0] ?? clean;
    let activityName: string | undefined = undefined;

    // Check if the last segment is numeric (e.g., :1 or :2)
    const lastPart = parts[parts.length - 1];
    if (parts.length > 1 && lastPart && /^\d+$/.test(lastPart)) {
        const num = parseInt(lastPart, 10);
        if (Number.isFinite(num) && num > 0) {
            uses = num;
            parts.pop();
        }
    }

    if (parts.length >= 2) {
        itemName = parts[0] ?? clean;
        activityName = parts.slice(1).join(':');
    } else if (parts.length === 1) {
        itemName = parts[0] ?? clean;
    }

    const cleanToken = activityName ? `${itemName}:${activityName}` : itemName;

    return {
        raw,
        strictOrder,
        cleanToken,
        itemName,
        activityName,
        uses
    };
}

/**
 * Extracts numeric use limit from an attack token string using `Item:Activity:Uses` notation.
 * Returns `null` if no usage limit is specified (unlimited).
 */
export function getTokenUseLimit(token: string): number | null {
    return parseTokenComponents(token).uses ?? null;
}

/**
 * Strips strict-order (`>`) prefix and numeric use limit (`:n`) notation from an attack token string.
 */
export function stripPrefixesAndLimits(token: string): string {
    return parseTokenComponents(token).cleanToken;
}

/** Alias for backwards compatibility */
export const stripPrefixes = stripPrefixesAndLimits;

/**
 * Resolves individual selectable choice strings from a flow token.
 * Expands choice groups like `(Flail:Activity1:1 | Flail:Activity2:1)` or `any:A|B`.
 */
export function getChoicesFromToken(rawToken: string): string[] {
    const trimmed = String(rawToken ?? '').trim();
    if (!trimmed) return [];

    const isStrict = trimmed.startsWith('>');
    const clean = stripOrderPrefix(trimmed);

    if (clean.startsWith('(') && clean.endsWith(')')) {
        const inner = clean.slice(1, -1).trim();
        const parts = inner.split('|').map((s) => s.trim()).filter(Boolean);
        return parts.map((p) => (isStrict && !p.startsWith('>') ? `>${p}` : p));
    }

    if (clean.toLowerCase().startsWith('any:')) {
        const parts = clean.slice(4).split('|').map((s) => s.trim()).filter(Boolean);
        return parts.map((p) => (isStrict && !p.startsWith('>') ? `>${p}` : p));
    }

    return [rawToken];
}

/**
 * Resolves an Activity document on an Item document by ID, name, or label.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveItemActivity(item: Item, activityRef: string): any | null {
    if (!item || !activityRef) return null;
    const cleanTarget = activityRef.trim().toLowerCase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sys = (item as any).system;
    if (!sys || !sys.activities) return null;

    const activities = sys.activities;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actList: any[] = activities.contents
        ?? (typeof activities.values === 'function' ? Array.from(activities.values()) : (Array.isArray(activities) ? activities : Object.values(activities)));

    if (!actList || actList.length === 0) return null;

    // 1. Match by exact activity ID
    let found = actList.find((a: any) => a?.id === activityRef || a?._id === activityRef);
    if (found) return found;

    // 2. Match by exact activity name or label (case-insensitive)
    found = actList.find((a: any) => {
        const name = String(a?.name ?? a?.label ?? '').trim().toLowerCase();
        return name === cleanTarget;
    });
    if (found) return found;

    // 3. Substring match
    found = actList.find((a: any) => {
        const name = String(a?.name ?? a?.label ?? '').trim().toLowerCase();
        return name.includes(cleanTarget) || cleanTarget.includes(name);
    });

    return found ?? null;
}

/**
 * Returns the subset of attack tokens in a single flow that are legally selectable at the current step.
 * Filters out options that have exceeded their `:n` usage limit in `tokenUseCounts`.
 */
export function getSelectableTokensFromFlow(
    flow: string[],
    tokenUseCounts: Map<string, number> = new Map()
): string[] {
    const selectable: string[] = [];
    for (let i = 0; i < flow.length; i++) {
        const raw = flow[i] ?? '';
        const choices = getChoicesFromToken(raw);

        for (const choice of choices) {
            const cleanTarget = stripPrefixesAndLimits(choice);
            if (!cleanTarget) continue;

            const limit = getTokenUseLimit(choice) ?? getTokenUseLimit(raw);
            if (limit !== null) {
                const used = tokenUseCounts.get(cleanTarget.toLowerCase()) ?? 0;
                if (used >= limit) {
                    continue;
                }
            }

            const cleanChoice = stripOrderPrefix(choice);
            selectable.push(cleanChoice);
        }

        const currentIsStrict = raw.trim().startsWith('>');
        const nextIsStrict = Boolean(flow[i + 1]?.trim().startsWith('>'));
        if (currentIsStrict || nextIsStrict) {
            break;
        }
    }
    return Array.from(new Set(selectable));
}

/**
 * Tests whether a token in a flow matches a selected choice (handling choice groups and Item:Activity).
 */
export function flowTokenMatchesSelection(flowToken: string, selectedToken: string): boolean {
    const cleanSelected = stripPrefixes(selectedToken).toLowerCase();
    const cleanFlowToken = stripPrefixes(flowToken).toLowerCase();
    if (cleanFlowToken === cleanSelected) return true;

    const choices = getChoicesFromToken(flowToken).map((c) => stripPrefixes(c).toLowerCase());
    return choices.includes(cleanSelected);
}

/**
 * Removes the first occurrence of a token matching `selectedToken` from `flow`.
 */
export function removeFirstOccurrence(arr: string[], item: string): string[] {
    const idx = arr.findIndex((x) => flowTokenMatchesSelection(x, item));
    if (idx === -1) return [...arr];
    return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

/**
 * Helper to filter actor items matching a generic category ('melee attack', 'ranged attack', 'spell attack', 'any attack')
 * or pipe-delimited pool ('any:ItemA|ItemB').
 */
export function getMatchingCategoryItems(actor: Actor, categoryOrPool: string): Item[] {
    const clean = stripPrefixes(categoryOrPool);
    const lower = clean.toLowerCase();
    const items = adapter.getActorItems(actor);

    if (lower === 'melee attack') {
        return items.filter((i) => ['mwak', 'msak'].includes(adapter.getItemActionType(i)));
    }
    if (lower === 'ranged attack') {
        return items.filter((i) => ['rwak', 'rsak'].includes(adapter.getItemActionType(i)));
    }
    if (lower === 'spell attack') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return items.filter((i) => ['msak', 'rsak'].includes(adapter.getItemActionType(i)) || (i as any).type === 'spell');
    }
    if (lower === 'any attack') {
        return items.filter((i) => ['mwak', 'rwak', 'msak', 'rsak'].includes(adapter.getItemActionType(i)));
    }
    if (lower.startsWith('any:')) {
        const poolNames = clean
            .slice(4)
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
        const resolved: Item[] = [];
        const seenIds = new Set<string>();
        for (const name of poolNames) {
            const item = resolveActorItem(actor, name);
            if (item && !seenIds.has(item.id ?? item.name)) {
                seenIds.add(item.id ?? item.name);
                resolved.push(item);
            }
        }
        return resolved;
    }
    return [];
}

/**
 * Checks whether an actor possesses a valid item for the given token string,
 * or if the token is a generic category or choice group.
 */
export function actorHasAttackOption(actor: Actor, token: string): boolean {
    const choices = getChoicesFromToken(token);
    if (choices.length > 1) {
        return choices.some((c) => actorHasAttackOption(actor, c));
    }

    const comp = parseTokenComponents(token);
    const clean = comp.cleanToken;
    const lower = clean.toLowerCase();

    if (
        lower === 'melee attack' ||
        lower === 'ranged attack' ||
        lower === 'spell attack' ||
        lower === 'any attack' ||
        lower.startsWith('any:')
    ) {
        return getMatchingCategoryItems(actor, clean).length > 0;
    }

    return resolveActorItem(actor, comp.itemName) !== null;
}

/**
 * Resolves a concrete Item and optional Activity to roll for a given selection string.
 */
export async function resolveConcreteAttackTarget(actor: Actor, selection: string): Promise<ResolvedAttackTarget | null> {
    const comp = parseTokenComponents(selection);
    const clean = comp.cleanToken;
    const lower = clean.toLowerCase();

    if (
        lower === 'melee attack' ||
        lower === 'ranged attack' ||
        lower === 'spell attack' ||
        lower === 'any attack' ||
        lower.startsWith('any:')
    ) {
        const matchingItems = getMatchingCategoryItems(actor, clean);

        if (matchingItems.length === 0) {
            notify.warn(`Multiattack: Could not find a valid ${clean} on ${actor.name}.`);
            return null;
        }

        let chosenItem: Item | null = matchingItems[0] ?? null;
        if (matchingItems.length > 1) {
            const options: SelectOptionItem[] = matchingItems.map((item) => ({
                value: item.name,
                label: item.name,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                img: (item as any).img ?? undefined
            }));

            const title = lower === 'melee attack'
                ? localize('BAM.selectDialog.meleePromptTitle', 'Select Melee Attack')
                : lower === 'ranged attack'
                    ? localize('BAM.selectDialog.rangedPromptTitle', 'Select Ranged Attack')
                    : lower === 'spell attack'
                        ? localize('BAM.selectDialog.spellPromptTitle', 'Select Spell Attack')
                        : localize('BAM.selectDialog.anyPromptTitle', 'Select Attack');

            const chosenName = await adapter.selectOptionDialog(options, { title });
            if (!chosenName) return null;
            chosenItem = resolveActorItem(actor, chosenName);
        }

        if (!chosenItem) return null;
        return { item: chosenItem };
    }

    const itemName = comp.itemName;
    const activityRef = comp.activityName;

    const item = resolveActorItem(actor, itemName);
    if (!item) {
        notify.warn(`Multiattack: Cannot find attack item "${itemName}" on ${actor.name}.`);
        return null;
    }

    if (activityRef) {
        const activity = resolveItemActivity(item, activityRef);
        return {
            item,
            activity,
            activityId: activity?.id ?? activityRef,
            activityName: activity?.name ?? activityRef
        };
    }

    return { item };
}

/** Alias for backwards compatibility */
export async function resolveConcreteAttackItem(actor: Actor, selection: string): Promise<Item | null> {
    const target = await resolveConcreteAttackTarget(actor, selection);
    return target?.item ?? null;
}

/**
 * Executes a single section's option map (`string[][]`) interactively or automatically.
 * Reduces remaining options after each attack roll until a sequence flow completes or is cancelled.
 * Supports `(n)` numeric usage limits, Item:Activity execution, and strict-order (`>`) queues.
 *
 * @param {Actor} actor Concrete Actor performing the multiattack
 * @param {string[][]} initialOptionMap 2D array of alternative attack sequences for this section
 * @param {Token | null} [token=null] Optional caster token placeable
 * @param {Map<string, number>} [tokenUseCounts=new Map()] Map of token usage counts tracked across multiattack steps
 */
export async function executeSectionOptionMap(
    actor: Actor,
    initialOptionMap: string[][],
    token: Token | null = null,
    tokenUseCounts: Map<string, number> = new Map()
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

        // Gather unique selectable attack tokens across all non-empty flows (respecting `>` strict ordering and `:n` usage limits)
        const uniqueTokens = Array.from(
            new Set(nonEmptyFlows.flatMap((flow) => getSelectableTokensFromFlow(flow, tokenUseCounts)))
        );
        if (uniqueTokens.length === 0) {
            break;
        }

        const isChoiceStep = uniqueTokens.length > 1 || nonEmptyFlows.some((f) => f[0]?.includes('(') || f[0]?.includes('|'));
        const autoSelectSingle = Boolean(game.settings?.get(MODULE_ID, 'autoSelectSingleOption'));
        let selectedToken: string | null = null;

        // Auto-select ONLY for plain non-choice attacks when autoSelectSingle is explicitly enabled AND it is NOT a choice/sub-activity step
        if (uniqueTokens.length === 1 && !hasFinishOption && !isChoiceStep && autoSelectSingle) {
            selectedToken = uniqueTokens[0] ?? null;
        } else {
            // Build popup select options
            const dialogOptions: SelectOptionItem[] = uniqueTokens.map((atkToken) => {
                const cleanChoice = stripPrefixesAndLimits(atkToken);
                let itemName = cleanChoice;
                let activityName = '';
                if (cleanChoice.includes(':')) {
                    const parts = cleanChoice.split(':');
                    itemName = parts[0]?.trim() ?? cleanChoice;
                    activityName = parts[1]?.trim() ?? '';
                }

                const resolvedItem = resolveActorItem(actor, itemName);
                const displayLabel = activityName
                    ? `${resolvedItem?.name ?? itemName} (${activityName})`
                    : (resolvedItem?.name ?? cleanChoice);

                // Calculate max remaining count of this token in any single flow
                const maxCount = Math.max(
                    ...nonEmptyFlows.map(
                        (f) => f.filter((x) => stripPrefixesAndLimits(x).toLowerCase() === cleanChoice.toLowerCase()).length
                    )
                );
                return {
                    value: atkToken,
                    label: displayLabel,
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
                subtitle: `Attack Step ${stepCount}`,
                cancelLabel: isChoiceStep
                    ? localize('BAM.selectDialog.skipStepLabel', 'Skip Option')
                    : localize('BAM.selectDialog.cancelLabel', 'Skip Option')
            });
        }

        if (selectedToken === '__FINISH__') {
            log.debug(`executeSectionOptionMap | Multiattack finished early at step ${stepCount}`);
            break;
        }

        if (!selectedToken || selectedToken === '__SKIP__') {
            log.debug(`executeSectionOptionMap | Skipping optional selection step ${stepCount}`);
            // Advance each flow past the current step without executing an attack
            optionMap = nonEmptyFlows.map((flow) => flow.slice(1));
            stepCount++;
            continue;
        }

        // Resolve and natively use the chosen attack target/activity
        const target = await resolveConcreteAttackTarget(actor, selectedToken);
        if (target && target.item) {
            const clearTargets = Boolean(game.settings?.get(MODULE_ID, 'clearTargetsBetweenAttacks'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyUser = game.user as any;
            if (clearTargets && anyUser?.updateTokenTargets) {
                anyUser.updateTokenTargets([]);
            }

            await adapter.useItem(target.item, {
                activity: target.activity,
                activityId: target.activityId,
                token
            });
        }

        // Increment usage count for limited-use tokens
        const cleanTarget = stripPrefixesAndLimits(selectedToken).toLowerCase();
        tokenUseCounts.set(cleanTarget, (tokenUseCounts.get(cleanTarget) ?? 0) + 1);

        // Reduce optionMap: keep flows where `selectedToken` matched the current step head, and remove one occurrence from each
        optionMap = nonEmptyFlows
            .filter((flow) => flow.length > 0 && flowTokenMatchesSelection(flow[0]!, selectedToken!))
            .map((flow) => removeFirstOccurrence(flow, selectedToken!));

        stepCount++;
    }
}

/**
 * Main entry point to execute an automated Multiattack for an Actor and Multiattack Item.
 *
 * @param {Actor} actor Concrete Actor performing the multiattack
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

    // Automatically enrich sequence with sub-activities discovered on non-multiattack items (e.g. Yeenoghu's Flail)
    const enrichedSequence = enrichSequenceWithDiscoveredSubActivities(resolved.sequence, actor, cleanDesc);
    const tokenUseCounts = new Map<string, number>();

    for (const sectionOptionMap of enrichedSequence) {
        await executeSectionOptionMap(actor, sectionOptionMap, token, tokenUseCounts);
    }
}

/**
 * Registers Foundry VTT and D&D 5e v4+ Activity hooks for automatic Multiattack execution
 * upon feature usage (`dnd5e.postUseActivity`) and optional chat card button injection.
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
