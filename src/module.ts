import { MODULE_ID, MODULE_NAME } from './constants.js';
import { log } from './lib/logger.js';
import { adapter } from './adapter/index.js';
import { registerModuleSettings } from './settings.js';
import { autorecManager } from './autorec/autorecManager.js';
import { executeMultiattack, registerMultiattackChatHooks } from './multiattack/executor.js';
import { abstractMultiattackDescription } from './multiattack/abstraction.js';
import { parseMultiattackTemplate } from './multiattack/parser.js';

Hooks.once('init', () => {
    log.info(`Initializing ${MODULE_NAME} (${MODULE_ID})`);
    registerModuleSettings();
    adapter.init();
});

Hooks.once('ready', () => {
    autorecManager.loadSavedEntries();
    registerMultiattackChatHooks();

    // Expose public API on window.bakanaMultiattack
    window.bakanaMultiattack = {
        adapter,
        autorecManager,
        executeMultiattack,
        abstractMultiattackDescription,
        parseMultiattackTemplate
    };

    log.info(`${MODULE_NAME} ready. Loaded ${autorecManager.getAllEntries().length} central autorecognition entries.`);
});

export {
    adapter,
    autorecManager,
    executeMultiattack,
    abstractMultiattackDescription,
    parseMultiattackTemplate
};
