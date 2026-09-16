import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { AutorecMenuApplication } from '../../src/autorec/autorecMenu.js';
import { AutorecExchangeMenuApplication } from '../../src/autorec/autorecExchangeMenu.js';
import { autorecManager } from '../../src/autorec/autorecManager.js';

function createMockDOM() {
    return {
        createElement: (tag) => {
            const el = {
                tagName: tag,
                className: '',
                style: {},
                innerHTML: '',
                value: '',
                querySelector: () => ({ addEventListener: () => {} }),
                querySelectorAll: () => [],
                addEventListener: () => {}
            };
            return el;
        },
        activeElement: null
    };
}

test('AutorecMenuApplication and AutorecExchangeMenuApplication implement both _renderHTML and _replaceHTML and render cleanly', async () => {
    await autorecManager.resetToDefaults(false);
    const origDoc = globalThis.document;
    globalThis.document = createMockDOM();

    try {
        const menuApp = new AutorecMenuApplication();
        const renderedMenu = await menuApp.render({ force: true });
        assert.ok(renderedMenu, 'AutorecMenuApplication should render without throwing');

        const exchangeApp = new AutorecExchangeMenuApplication();
        const renderedExchange = await exchangeApp.render({ force: true });
        assert.ok(renderedExchange, 'AutorecExchangeMenuApplication should render without throwing');
    } finally {
        globalThis.document = origDoc;
    }
});
