import { BaseFoundryAdapter } from './base-foundry-adapter.js';
import { FoundryV12Adapter } from './foundry-v12-adapter.js';
import { FoundryV13Adapter } from './foundry-v13-adapter.js';
import { FoundryV14Adapter } from './foundry-v14-adapter.js';

/**
 * Initializes the version-specific Foundry adapter subclass based on game.release.generation.
 * @returns {BaseFoundryAdapter}
 */
export function initializeFoundryAdapter(): BaseFoundryAdapter {
    const gen = game.release?.generation ?? 12;
    if (gen >= 14) return new FoundryV14Adapter();
    if (gen === 13) return new FoundryV13Adapter();
    return new FoundryV12Adapter();
}

export { BaseFoundryAdapter, FoundryV12Adapter, FoundryV13Adapter, FoundryV14Adapter };
