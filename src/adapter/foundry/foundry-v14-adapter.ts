import { FoundryV13Adapter } from './foundry-v13-adapter.js';

/**
 * Foundry VTT v14 Adapter subclass.
 */
export class FoundryV14Adapter extends FoundryV13Adapter {
    override get generation(): number {
        return 14;
    }
}
