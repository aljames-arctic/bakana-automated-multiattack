import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { adapter } from '../../src/adapter/index.js';
import {
    executeMultiattack,
    registerMultiattackHooks,
    getSelectableTokensFromFlow,
    removeFirstOccurrence,
    getMatchingCategoryItems,
    actorHasAttackOption
} from '../../src/multiattack/executor.js';
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
});

test('getMatchingCategoryItems and actorHasAttackOption support spell attack, any attack, and any:ItemA|ItemB pools', () => {
    const slashItem = {
        id: 'slash-id',
        name: 'Slash',
        type: 'weapon',
        system: { actionType: 'mwak' }
    };
    const fireBoltItem = {
        id: 'firebolt-id',
        name: 'Fire Bolt',
        type: 'spell',
        system: { actionType: 'rsak' }
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

