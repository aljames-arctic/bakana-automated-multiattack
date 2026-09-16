import { BaseSystemAdapter } from './base-system-adapter.js';
import { Dnd5eSystemAdapter } from './dnd5e-system-adapter.js';
import { BaseFoundryAdapter } from '../foundry/base-foundry-adapter.js';

/**
 * Initializes the system adapter based on active game.system.id.
 * @param {string|undefined} systemId Active Foundry system ID
 * @param {BaseFoundryAdapter} foundry Active Foundry adapter
 * @returns {BaseSystemAdapter}
 */
export function initializeSystemAdapter(systemId: string | undefined, foundry: BaseFoundryAdapter): BaseSystemAdapter {
    if (systemId === 'dnd5e') {
        return new Dnd5eSystemAdapter(foundry);
    }
    return new BaseSystemAdapter(systemId ?? 'default', false, foundry);
}

export { BaseSystemAdapter, Dnd5eSystemAdapter };
