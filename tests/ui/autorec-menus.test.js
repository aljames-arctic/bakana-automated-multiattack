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
import { AutomatedSupportMenuApplication } from '../../src/autorec/automatedSupportMenu.js';
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

test('AutorecMenuApplication, AutorecExchangeMenuApplication, and AutomatedSupportMenuApplication implement both _renderHTML and _replaceHTML and render cleanly', async () => {
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

        const supportApp = new AutomatedSupportMenuApplication();
        const renderedSupport = await supportApp.render({ force: true });
        assert.ok(renderedSupport, 'AutomatedSupportMenuApplication should render without throwing');
        const supportDom = await supportApp._renderHTML({}, {});
        assert.ok(supportDom.innerHTML.includes('Enable Automated Support'), 'Should render Automated Support enable toggle');
        assert.ok(supportDom.innerHTML.includes('LLM Provider'), 'Should render LLM Provider dropdown');
    } finally {
        globalThis.document = origDoc;
    }
});

import { adapter } from '../../src/adapter/index.js';

test('Visual flow builder helpers format, group, expand, and summarize 3D attack sequences into human-readable English', () => {
    // Token formatting
    assert.equal(formatTokenHumanLabel('<ITEM_0>'), 'Item #1');
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
    assert.ok(summary.includes('1&times; Item #1'), 'Summary should include Item #1 count');
    assert.ok(summary.includes('2&times; Item #3'), 'Summary should include Item #3 count');
});

test('Drag & Drop Actor auto-fill resolves Actor from drop payload and extracts template and override sequences', async () => {
    await autorecManager.resetToDefaults(false);
    const origDoc = globalThis.document;
    globalThis.document = createMockDOM();

    const archmageActor = {
        id: 'archmage-2024',
        name: 'Archmage',
        img: 'icons/creatures/magical/humanoid-silhouette-glowing-pink.webp',
        items: new Map([
            ['ma-item', {
                id: 'ma-item',
                name: 'Multiattack',
                system: {
                    description: {
                        value: 'The [[lookup @name lowercase]]{monster} makes four [[/item .mmArcaneBurst000]] attacks.'
                    }
                }
            }],
            ['ab-item', {
                id: 'ab-item',
                name: 'Arcane Burst',
                system: { actionType: 'msak' }
            }]
        ])
    };
    globalThis.game.actors.set('archmage-2024', archmageActor);

    try {
        // Test adapter.resolveActorFromDropData
        const resolved = await adapter.resolveActorFromDropData({ type: 'Actor', uuid: 'Actor.archmage-2024' });
        assert.equal(resolved, archmageActor, 'Should resolve Actor from drop data UUID');

        const menuApp = new AutorecMenuApplication();

        // Drop in template mode
        const handledTemplate = await menuApp.handleActorDrop(archmageActor, 'template');
        assert.equal(handledTemplate, true, 'handleActorDrop should succeed for Archmage');
        const renderedTemplateDom = await menuApp._renderHTML({}, {});
        assert.ok(renderedTemplateDom.innerHTML.includes('Archmage'), 'Should display dropped actor name in preview card');
        assert.ok(renderedTemplateDom.innerHTML.includes('Arcane Burst'), 'Should display detected weapon mapping');
        assert.ok(renderedTemplateDom.innerHTML.includes('&lt;ACTOR&gt; makes four &lt;ITEM_0&gt; attacks.') || renderedTemplateDom.innerHTML.includes('<ACTOR> makes four <ITEM_0> attacks.'), 'Should populate abstracted template pattern');

        // Switch to override mode
        await menuApp.handleActorDrop(archmageActor, 'override');
        const renderedOverrideDom = await menuApp._renderHTML({}, {});
        assert.ok(renderedOverrideDom.innerHTML.includes('Archmage::Multiattack'), 'Should populate Actor::Item override key in override mode');
    } finally {
        globalThis.document = origDoc;
    }
});

test('Dropping a monster whose general template exists defaults to Monster Override so Two Identical Weapon Attacks is never overwritten', async () => {
    await autorecManager.resetToDefaults(false);
    const origDoc = globalThis.document;
    globalThis.document = createMockDOM();

    // Verify Two Identical Weapon Attacks exists in Templates
    const twoSameTemplate = autorecManager.findDuplicatePattern('<ACTOR> makes two <ITEM_0> attacks.', undefined, 'template');
    assert.ok(twoSameTemplate, 'Should start with Two Identical Weapon Attacks template');

    // Create a temporary unfilled template like "+ Add Template" does
    const tempUnfilled = await autorecManager.registerEntry({
        id: 'temp-unfilled-ghost',
        name: 'New Template',
        type: 'template',
        pattern: '',
        sequence: [],
        enabled: true
    }, false);

    const ghostActor = {
        id: 'ghost-actor',
        name: 'Ghost',
        img: 'icons/creatures/undead/ghost-screaming-white.webp',
        items: new Map([
            ['ma-item', {
                id: 'ma-item',
                name: 'Multiattack',
                system: {
                    description: {
                        value: 'The Ghost makes two Withering Touch attacks.'
                    }
                }
            }],
            ['wt-item', {
                id: 'wt-item',
                name: 'Withering Touch',
                system: { actionType: 'mwak' }
            }]
        ])
    };

    try {
        const menuApp = new AutorecMenuApplication();
        menuApp._selectedId = tempUnfilled.id;

        // Drop Ghost onto the unfilled template
        const handled = await menuApp.handleActorDrop(ghostActor);
        assert.equal(handled, true, 'handleActorDrop should return true');

        // Because Two Identical Weapon Attacks already exists in Templates,
        // handleActorDrop must auto-select Monster Override ('Ghost::Multiattack') on the new entry
        // and MUST NOT overwrite or select Two Identical Weapon Attacks!
        assert.notEqual(
            menuApp._selectedId,
            twoSameTemplate.id,
            'Must NOT select or overwrite Two Identical Weapon Attacks template'
        );
        assert.equal(menuApp._pendingType, 'override', 'Should default pendingType to override');
        assert.equal(menuApp._pendingPattern, 'Ghost::Multiattack', 'Should set pattern to Ghost::Multiattack override key');

        // Save the Ghost override
        await autorecManager.registerEntry({
            id: menuApp._selectedId,
            name: 'Ghost Override',
            type: 'override',
            pattern: 'Ghost::Multiattack',
            sequence: [[['Withering Touch', 'Withering Touch']]],
            enabled: true
        }, false);

        // Verify Two Identical Weapon Attacks is STILL intact in Templates!
        const twoSameAfter = autorecManager.getAllEntries().find((e) => e.id === twoSameTemplate.id);
        assert.ok(twoSameAfter, 'Two Identical Weapon Attacks must still exist for all non-ghosts');
        assert.equal(twoSameAfter.type, 'template');
        assert.equal(twoSameAfter.pattern, '<ACTOR> makes two <ITEM_0> attacks.');

        // Verify sidebar renders both Templates and Monster Overrides sections
        const renderedDom = await menuApp._renderHTML({}, {});
        assert.ok(renderedDom.innerHTML.includes('Templates'), 'Sidebar should render Templates section');
        assert.ok(renderedDom.innerHTML.includes('Monster Overrides'), 'Sidebar should render Monster Overrides section');
    } finally {
        globalThis.document = origDoc;
    }
});




