import { BaseFoundryAdapter } from './base-foundry-adapter.js';

/**
 * Foundry VTT v12 Adapter subclass.
 */
export class FoundryV12Adapter extends BaseFoundryAdapter {
    override get generation(): number {
        return 12;
    }
}
