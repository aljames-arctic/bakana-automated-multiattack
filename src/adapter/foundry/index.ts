import { BaseFoundryAdapter } from './base-foundry-adapter.js';

/**
 * Initializes the version-specific Foundry adapter subclass based on game.release.generation.
 * @returns {BaseFoundryAdapter}
 */
export function initializeFoundryAdapter(): BaseFoundryAdapter {
    const gen = game.release?.generation;
    return new BaseFoundryAdapter();
}

export { BaseFoundryAdapter };
