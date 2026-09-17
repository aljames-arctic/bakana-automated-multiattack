import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { adapter } from '../../src/adapter/index.js';
import {
    executeMultiattack,
    executeSectionOptionMap,
    registerMultiattackHooks,
    getSelectableTokensFromFlow,
    removeFirstOccurrence,
    getMatchingCategoryItems,
    actorHasAttackOption,
    getTokenUseLimit,
    stripPrefixesAndLimits,
    parseTokenComponents
} from '../../src/multiattack/executor.js';
import { getItemSecondaryActivities } from '../../src/multiattack/abstraction.js';
import { autorecManager } from '../../src/autorec/autorecManager.js';

test('adapter.isMultiattackMessage detects Multiattack chat cards and ignores attack/damage rolls', () => {
    const mockActor = {
        id: 'actor-bear',
        name: 'Brown Bear',
        items: new Map([
            ['item-ma', {
                id: 'item-ma',
                name: 'Multiattack',
                system: { description: { value: 'The bear makes two attacks: one with its bite and one with its claws.' } }
            }],
            ['item-bite', { id: 'item-bite', name: 'Bite' }]
        ])
    };
    globalThis.game.actors.set('actor-bear', mockActor);

    const validCard = {
        id: 'msg-1',
        speaker: { actor: 'actor-bear' },
        flavor: 'Multiattack',
        flags: { dnd5e: { item: { id: 'item-ma' } } }
    };
    assert.equal(adapter.isMultiattackMessage(validCard), true, 'Should detect Multiattack item card');

    const attackRollCard = {
        id: 'msg-2',
        speaker: { actor: 'actor-bear' },
        flavor: 'Multiattack - Attack Roll',
        flags: { dnd5e: { roll: { type: 'attack' }, item: { id: 'item-ma' } } }
    };
    assert.equal(adapter.isMultiattackMessage(attackRollCard), false, 'Should ignore attack roll cards');
});

test('adapter.isMessageAuthor returns true only for the user who created the chat card', () => {
    const cardByCurrentUser = {
        id: 'msg-author-1',
        author: { id: 'user-gm' }
    };
    const cardByOtherUser = {
        id: 'msg-author-2',
        author: { id: 'user-player-2' }
    };

    assert.equal(adapter.isMessageAuthor(cardByCurrentUser), true, 'Should return true when message.author.id matches game.user.id');
    assert.equal(adapter.isMessageAuthor(cardByOtherUser), false, 'Should return false when message was created by another user');
    assert.equal(adapter.isMessageAuthor(cardByCurrentUser, 'user-player-2'), false, 'Hook userId parameter should take precedence');
    assert.equal(adapter.isMessageAuthor(cardByOtherUser, 'user-gm'), true, 'Hook userId parameter matching game.user.id should return true');
});

test('executeMultiattack natively rolls items via item.use() without calling MidiQOL directly', async () => {
    await autorecManager.resetToDefaults(false);

    const rolledItems = [];
    const biteItem = {
        id: 'bite-id',
        name: 'Bite',
        use: async () => {
            rolledItems.push('Bite');
        }
    };
    const clawsItem = {
        id: 'claws-id',
        name: 'Claws',
        use: async () => {
            rolledItems.push('Claws');
        }
    };
    const multiattackItem = {
        id: 'ma-id',
        name: 'Multiattack',
        system: {
            description: {
                value: 'The bear makes two attacks: one with its bite and one with its claws.'
            }
        }
    };

    const bearActor = {
        id: 'bear-id',
        name: 'Brown Bear',
        items: new Map([
            ['ma-id', multiattackItem],
            ['bite-id', biteItem],
            ['claws-id', clawsItem]
        ])
    };

    // Mock selectOptionDialog to pick the first available option when prompted
    const origSelect = adapter.foundry.selectOptionDialog;
    adapter.foundry.selectOptionDialog = async (options) => {
        return options[0]?.value ?? null;
    };

    try {
        await executeMultiattack(bearActor, multiattackItem, null);
        assert.deepEqual(
            rolledItems,
            ['Bite', 'Claws'],
            'Should natively roll Bite then Claws via item.use()'
        );
    } finally {
        adapter.foundry.selectOptionDialog = origSelect;
    }
});

test('registerMultiattackHooks automatically executes multiattack on dnd5e.postUseActivity (D&D 5e v4+)', async () => {
    await autorecManager.resetToDefaults(false);
    registerMultiattackHooks();

    const rolledItems = [];
    const biteItem = {
        id: 'bite-id',
        name: 'Bite',
        use: async () => { rolledItems.push('Bite'); }
    };
    const clawsItem = {
        id: 'claws-id',
        name: 'Claws',
        use: async () => { rolledItems.push('Claws'); }
    };
    const multiattackItem = {
        id: 'ma-id',
        name: 'Multiattack',
        system: {
            description: {
                value: 'The bear makes two attacks: one with its bite and one with its claws.'
            }
        }
    };
    const bearActor = {
        id: 'bear-id-activity',
        name: 'Brown Bear',
        items: new Map([
            ['ma-id', multiattackItem],
            ['bite-id', biteItem],
            ['claws-id', clawsItem]
        ])
    };
    multiattackItem.actor = bearActor;

    const activity = {
        id: 'act-ma',
        name: 'Multiattack',
        item: multiattackItem,
        actor: bearActor
    };

    const origSelect = adapter.foundry.selectOptionDialog;
    adapter.foundry.selectOptionDialog = async (options) => options[0]?.value ?? null;

    try {
        await globalThis.Hooks.callAll('dnd5e.postUseActivity', activity, {}, {});
        assert.deepEqual(
            rolledItems,
            ['Bite', 'Claws'],
            'Should automatically execute multiattack sequence when dnd5e.postUseActivity fires on client'
        );
    } finally {
        adapter.foundry.selectOptionDialog = origSelect;
    }
});

test('getSelectableTokensFromFlow enforces strict-order (>) prefixes while preserving unordered multiset behavior', () => {
    // Standard unordered multiset: both tokens are immediately selectable
    assert.deepEqual(
        getSelectableTokensFromFlow(['Bite', 'Claws']),
        ['Bite', 'Claws'],
        'Unprefixed tokens should all be selectable in any order'
    );

    // Strict-order follow-up: Charge must be executed before >Gore is unlocked
    const chargeGoreFlow = ['Charge', '>Gore'];
    assert.deepEqual(
        getSelectableTokensFromFlow(chargeGoreFlow),
        ['Charge'],
        'Only Charge should be selectable before Charge is consumed'
    );

    // Once Charge is consumed, >Gore becomes selectable (stripped to clean name)
    const remaining = removeFirstOccurrence(chargeGoreFlow, 'Charge');
    assert.deepEqual(remaining, ['>Gore']);
    assert.deepEqual(
        getSelectableTokensFromFlow(remaining),
        ['Gore'],
        'Gore should become selectable after Charge is consumed'
    );

    // Item:Activity:Uses limit notation parsing via parseTokenComponents
    const parsed = parseTokenComponents('Flail:Activity1:1');
    assert.equal(parsed.itemName, 'Flail');
    assert.equal(parsed.activityName, 'Activity1');
    assert.equal(parsed.uses, 1);
    assert.equal(parsed.cleanToken, 'Flail:Activity1');

    assert.equal(getTokenUseLimit('Flail:Activity1:1'), 1);
    assert.equal(getTokenUseLimit('>Flail:Activity1:2'), 2);
    assert.equal(getTokenUseLimit('Flail'), null);

    // Usage limit filtering via tokenUseCounts map with :n notation
    const limitedFlow = ['(Flail:Act1:1 | Flail:Act2:2)'];
    const counts = new Map([['flail:act1', 1]]);
    assert.deepEqual(
        getSelectableTokensFromFlow(limitedFlow, counts),
        ['Flail:Act2:2'],
        'Flail:Act1 should be excluded once 1 use limit is reached'
    );
});

test('getMatchingCategoryItems and actorHasAttackOption support spell attack, any attack, and any:ItemA|ItemB pools', () => {
    const slashItem = {
        id: 'slash-id',
        name: 'Slash',
        type: 'weapon',
        system: {
            activities: [{ attack: { type: { value: 'melee', classification: 'weapon' } } }]
        }
    };
    const fireBoltItem = {
        id: 'firebolt-id',
        name: 'Fire Bolt',
        type: 'spell',
        system: {
            activities: [{ attack: { type: { value: 'ranged', classification: 'spell' } } }]
        }
    };
    const customActor = {
        id: 'custom-actor',
        name: 'Spellsword',
        items: new Map([
            ['slash-id', slashItem],
            ['firebolt-id', fireBoltItem]
        ])
    };

    const spellMatches = getMatchingCategoryItems(customActor, 'spell attack');
    assert.equal(spellMatches.length, 1);
    assert.equal(spellMatches[0].name, 'Fire Bolt');

    const anyMatches = getMatchingCategoryItems(customActor, 'any attack');
    assert.equal(anyMatches.length, 2);

    const poolMatches = getMatchingCategoryItems(customActor, 'any:Slash|Fire Bolt|Nonexistent');
    assert.equal(poolMatches.length, 2);
    assert.deepEqual(poolMatches.map((i) => i.name), ['Slash', 'Fire Bolt']);

    assert.equal(actorHasAttackOption(customActor, 'spell attack'), true);
    assert.equal(actorHasAttackOption(customActor, 'any:Slash|Nonexistent'), true);
    assert.equal(actorHasAttackOption(customActor, 'any:MissingA|MissingB'), false);
});

test('executeMultiattack handles per-item activity calls, (n) use limits, variable stand-ins, and sub-activity discovery (Yeenoghu Flail)', async () => {
    const rolledActivities = [];

    const act1 = { id: 'act-1', name: 'Activity1', use: async () => rolledActivities.push('Flail:Activity1') };
    const act2 = { id: 'act-2', name: 'Activity2', use: async () => rolledActivities.push('Flail:Activity2') };
    const act3 = { id: 'act-3', name: 'Activity3', use: async () => rolledActivities.push('Flail:Activity3') };
    const primaryAttackAct = { id: 'act-main', type: 'attack', name: 'Flail Attack', use: async () => rolledActivities.push('Flail Main') };

    const flailItem = {
        id: 'flail-id',
        name: 'Flail',
        system: {
            activities: new Map([
                ['act-main', primaryAttackAct],
                ['act-1', act1],
                ['act-2', act2],
                ['act-3', act3]
            ]),
            description: { value: 'If it is his turn, Yeenoghu can cause the target to suffer one of the following additional effects, each of which he can apply only once per turn.' }
        },
        use: async (options) => {
            if (options?.activity) {
                return options.activity.use();
            }
            rolledActivities.push('Flail Main');
        }
    };

    const multiattackItem = {
        id: 'ma-yeenoghu',
        name: 'Multiattack',
        system: {
            description: {
                value: 'Yeenoghu makes three Flail attacks.'
            }
        }
    };

    const yeenoghuActor = {
        id: 'yeenoghu-id',
        name: 'Yeenoghu',
        items: new Map([
            ['ma-yeenoghu', multiattackItem],
            ['flail-id', flailItem]
        ])
    };

    await executeMultiattack(yeenoghuActor, multiattackItem);
    assert.equal(rolledActivities.length, 6, 'Should execute 3 Flail attacks and 3 distinct sub-activities');
    assert.equal(rolledActivities[0], 'Flail Main', 'Step 1: Flail attack');
    assert.equal(rolledActivities[1], 'Flail:Activity1', 'Step 2: Sub-activity 1 (1 use limit)');
    assert.equal(rolledActivities[2], 'Flail Main', 'Step 3: Flail attack');
    assert.equal(rolledActivities[3], 'Flail:Activity2', 'Step 4: Sub-activity 2 (1 use limit)');
    assert.equal(rolledActivities[4], 'Flail Main', 'Step 5: Flail attack');
    assert.equal(rolledActivities[5], 'Flail:Activity3', 'Step 6: Sub-activity 3 (1 use limit)');
});

test('cancelling or skipping an optional sub-activity selection step (__SKIP__) does not break the remaining multiattacks', async () => {
    const rolled = [];

    const act1 = { id: 'act-1', name: 'Activity1', use: async () => rolled.push('Flail:Activity1') };
    const act2 = { id: 'act-2', name: 'Activity2', use: async () => rolled.push('Flail:Activity2') };
    const primaryAttackAct = { id: 'act-main', type: 'attack', name: 'Flail Attack', use: async () => rolled.push('Flail Main') };

    const flailItem = {
        id: 'flail-id',
        name: 'Flail',
        system: {
            activities: new Map([
                ['act-main', primaryAttackAct],
                ['act-1', act1],
                ['act-2', act2]
            ])
        },
        use: async (options) => {
            if (options?.activity) {
                return options.activity.use();
            }
            rolled.push('Flail Main');
        }
    };

    const yeenoghuActor = {
        id: 'yeenoghu-id-skip',
        name: 'Yeenoghu',
        items: new Map([['flail-id', flailItem]])
    };

    const sequence = [[
        'Flail', '>(Flail:Activity1:1 | Flail:Activity2:1)', 'Flail', '>(Flail:Activity1:1 | Flail:Activity2:1)'
    ]];

    let promptIndex = 0;
    const origSelectDialog = adapter.selectOptionDialog;
    adapter.selectOptionDialog = async () => {
        promptIndex++;
        if (promptIndex === 1) {
            return '__SKIP__';
        }
        return 'Flail:Activity2:1';
    };

    try {
        await executeSectionOptionMap(yeenoghuActor, sequence);

        assert.equal(rolled.length, 3, 'Should execute 2 Flail attacks and 1 sub-activity');
        assert.equal(rolled[0], 'Flail Main', 'Step 1: First Flail attack');
        assert.equal(rolled[1], 'Flail Main', 'Step 3: Second Flail attack (proceeds after Step 2 skipped)');
        assert.equal(rolled[2], 'Flail:Activity2', 'Step 4: Sub-activity 2 selected');
    } finally {
        adapter.selectOptionDialog = origSelectDialog;
    }
});

