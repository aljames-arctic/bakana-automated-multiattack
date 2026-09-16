import { FoundryV12Adapter } from './foundry-v12-adapter.js';

/**
 * Foundry VTT v13 Adapter subclass.
 */
export class FoundryV13Adapter extends FoundryV12Adapter {
    override get generation(): number {
        return 13;
    }
}
