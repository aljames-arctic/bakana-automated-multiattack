import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { adapter } from '../../src/adapter/index.js';
import { executeMultiattack } from '../../src/multiattack/executor.js';
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
