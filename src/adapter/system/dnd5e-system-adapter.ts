import { BaseSystemAdapter } from './base-system-adapter.js';
import { BaseFoundryAdapter } from '../foundry/base-foundry-adapter.js';
import { isLocalizedMultiattackName } from '../../multiattack/grammar.js';

/**
 * D&D 5e System Adapter (supports D&D 5e v4+ Activities).
 */
export class Dnd5eSystemAdapter extends BaseSystemAdapter {
    constructor(foundry: BaseFoundryAdapter) {
        super('dnd5e', true, foundry);
    }

    override getItemActionType(item: Item): 'mwak' | 'rwak' | 'msak' | 'rsak' | 'other' {
        if (!item) return 'other';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sys = (item as any).system ?? {};

        // Modern D&D 5e v4+ Activities inspection
        const activities = sys.activities;
        if (activities) {
            const actList = activities.contents ?? (activities.values ? Array.from(activities.values()) : Object.values(activities));
            for (const act of actList) {
                if (!act) continue;
                if (act.actionType && ['mwak', 'rwak', 'msak', 'rsak'].includes(act.actionType)) {
                    return act.actionType;
                }
                const atkType = act.attack?.type?.value;
                const classification = act.attack?.type?.classification ?? 'weapon';
                if (atkType === 'melee') {
                    return classification === 'spell' ? 'msak' : 'mwak';
                }
                if (atkType === 'ranged') {
                    return classification === 'spell' ? 'rsak' : 'rwak';
                }
            }
        }

        return 'other';
    }

    override registerItemUsageHook(
        callback: (actor: Actor, item: Item, token: Token | null) => Promise<void> | void
    ): void {
        // D&D 5e v4.0+ Activity usage hook (fires locally on the initiating client only)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Hooks as any).on('dnd5e.postUseActivity', async (activity: any, _usageConfig: any, results: any) => {
            const item: Item | null = activity?.item ?? null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actor: Actor | null = activity?.actor ?? (item as any)?.actor ?? null;
            if (!item || !actor) return;

            const isMultiattack =
                isLocalizedMultiattackName(item.name) ||
                isLocalizedMultiattackName(activity?.name ?? '');
            if (!isMultiattack) return;

            // Resolve optional Token placeable
            let token: Token | null = null;
            const msg = results?.message ?? results?.chatMessage ?? (Array.isArray(results?.messages) ? results.messages[0] : null);
            if (msg) {
                token = this.foundry.getSpeakerToken(msg);
            }
            if (!token) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const anyActor = actor as any;
                if (anyActor.token?.object) {
                    token = anyActor.token.object;
                } else {
                    const controlled = this.foundry.getControlledTokens();
                    token = controlled.find((t: Token) => t.actor?.id === actor.id) ?? null;
                }
            }

            await callback(actor, item, token);
        });
    }
}
