import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import {
    AutorecMenuApplication,
    formatTokenHumanLabel,
    groupFlowTokens,
    expandGroupedTokens,
    summarizeSequenceInPlainEnglish
} from '../../src/autorec/autorecMenu.js';
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

test('Visual flow builder helpers format, group, expand, and summarize 3D attack sequences into human-readable English', () => {
    // Token formatting
    assert.equal(formatTokenHumanLabel('<ITEM_0>'), '1st Item (<ITEM_0>)');
    assert.equal(formatTokenHumanLabel('>Gore'), 'Gore');
    assert.equal(formatTokenHumanLabel('any:Slash|Pierce'), 'Any of [Slash, Pierce]');

    // Grouping and round-trip expansion (including strict order prefix)
    const rawFlow = ['<ITEM_0>', '<ITEM_0>', '><ITEM_1>'];
    const grouped = groupFlowTokens(rawFlow);
    assert.deepEqual(grouped, [
        { token: '<ITEM_0>', count: 2, strictOrder: false },
        { token: '<ITEM_1>', count: 1, strictOrder: true }
    ]);
    assert.deepEqual(expandGroupedTokens(grouped), rawFlow);

    // Plain-English sequence summarization
    const dragonSeq = [
        [['<ITEM_0>']],
        [['<ITEM_1>', '<ITEM_2>', '<ITEM_2>']]
    ];
    const summary = summarizeSequenceInPlainEnglish(dragonSeq);
    assert.ok(summary.includes('Step 1:'), 'Summary should include Step 1 header');
    assert.ok(summary.includes('Then Step 2:'), 'Summary should include Step 2 header');
    assert.ok(summary.includes('1&times; 1st Item (<ITEM_0>)'), 'Summary should include 1st item count');
    assert.ok(summary.includes('2&times; 3rd Item (<ITEM_2>)'), 'Summary should include 3rd item count');
});

