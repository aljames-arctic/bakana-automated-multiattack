import { BaseSystemAdapter } from './base-system-adapter.js';
import { BaseFoundryAdapter } from '../foundry/base-foundry-adapter.js';

/**
 * D&D 5e System Adapter (supports D&D 5e v4+ Activities as well as standard item properties).
 */
export class Dnd5eSystemAdapter extends BaseSystemAdapter {
    constructor(foundry: BaseFoundryAdapter) {
        super('dnd5e', true, foundry);
    }

    override getItemActionType(item: Item): 'mwak' | 'rwak' | 'msak' | 'rsak' | 'other' {
        if (!item) return 'other';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sys = (item as any).system ?? {};

        // 1. Direct system.actionType
        if (sys.actionType && ['mwak', 'rwak', 'msak', 'rsak'].includes(sys.actionType)) {
            return sys.actionType;
        }

        // 2. Modern D&D 5e v4+ Activities inspection
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
}
