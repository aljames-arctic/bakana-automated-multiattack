import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { abstractMultiattackDescription, hydrateMultiattackSequence } from '../../src/multiattack/abstraction.js';
import { parseMultiattackTemplate } from '../../src/multiattack/parser.js';
import { parseLLMResponse } from '../../src/multiattack/prompt.js';

function createItems(names) {
    return names.map((name) => ({ name }));
}

function parseEndToEnd(description, itemNames, actorName = 'Monster') {
    const items = createItems(itemNames);
    const { template, itemMap } = abstractMultiattackDescription(description, items, actorName);
    const templateSeq = parseMultiattackTemplate(template);
    assert.ok(templateSeq, `Failed to deterministically parse template: "${template}"`);
    return hydrateMultiattackSequence(templateSeq, itemMap);
}

test('Deterministic Parser Suite: 15+ Canonical D&D 5e Multiattack Test Cases & Expected Outputs', async (t) => {
    await t.test('1. Brown Bear (Two attacks: 1 Bite + 1 Claws)', () => {
        const result = parseEndToEnd(
            'The bear makes two attacks: one with its bite and one with its claws.',
            ['Bite', 'Claws'],
            'Brown Bear'
        );
        assert.deepEqual(result, [[['Bite', 'Claws']]]);
    });

    await t.test('2. Owlbear (Two attacks: 1 Beak + 1 Claws)', () => {
        const result = parseEndToEnd(
            'The owlbear makes two attacks: one with its beak and one with its claws.',
            ['Beak', 'Claws'],
            'Owlbear'
        );
        assert.deepEqual(result, [[['Beak', 'Claws']]]);
    });

    await t.test('3. Thug (Two identical weapon attacks: 2 Mace)', () => {
        const result = parseEndToEnd(
            'The thug makes two melee attacks with its mace.',
            ['Mace', 'Heavy Crossbow'],
            'Thug'
        );
        assert.deepEqual(result, [[['Mace', 'Mace']]]);
    });

    await t.test('4. Berserker (Two Greataxe attacks)', () => {
        const result = parseEndToEnd(
            'The berserker makes two greataxe attacks.',
            ['Greataxe'],
            'Berserker'
        );
        assert.deepEqual(result, [[['Greataxe', 'Greataxe']]]);
    });

    await t.test('5. Troll (Three attacks: 1 Bite + 2 Claws)', () => {
        const result = parseEndToEnd(
            'The troll makes three attacks: one with its bite and two with its claws.',
            ['Bite', 'Claw'],
            'Troll'
        );
        assert.deepEqual(result, [[['Bite', 'Claw', 'Claw']]]);
    });

    await t.test('6. Barbed Devil (Three attacks: 2 Claws + 1 Tail)', () => {
        const result = parseEndToEnd(
            'The devil makes three melee attacks: two with its claws and one with its tail.',
            ['Claw', 'Tail', 'Hurl Flame'],
            'Barbed Devil'
        );
        assert.deepEqual(result, [[['Claw', 'Claw', 'Tail']]]);
    });

    await t.test('7. Chimera (Three distinct attacks: 1 Bite + 1 Horns + 1 Claws)', () => {
        const result = parseEndToEnd(
            'The chimera makes three attacks: one with its bite, one with its horns, and one with its claws.',
            ['Bite', 'Horns', 'Claws', 'Fire Breath'],
            'Chimera'
        );
        assert.deepEqual(result, [[['Bite', 'Horns', 'Claws']]]);
    });

    await t.test('8. Adult Red Dragon ("Then" sectioning: Frightful Presence -> 1 Bite + 2 Claws)', () => {
        const result = parseEndToEnd(
            'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.',
            ['Bite', 'Claw', 'Tail', 'Frightful Presence', 'Fire Breath'],
            'Adult Red Dragon'
        );
        assert.deepEqual(result, [
            [['Frightful Presence']],
            [['Bite', 'Claw', 'Claw']]
        ]);
    });

    await t.test('9. Ancient Gold Dragon ("Then" sectioning with different dragon name)', () => {
        const result = parseEndToEnd(
            'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.',
            ['Frightful Presence', 'Bite', 'Claw'],
            'Ancient Gold Dragon'
        );
        assert.deepEqual(result, [
            [['Frightful Presence']],
            [['Bite', 'Claw', 'Claw']]
        ]);
    });

    await t.test('10. Bandit Captain ("Or" branching: 2 Scimitar + 1 Dagger OR 2 Ranged Dagger)', () => {
        const result = parseEndToEnd(
            'The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.',
            ['Scimitar', 'Dagger'],
            'Bandit Captain'
        );
        assert.deepEqual(result, [
            [
                ['Scimitar', 'Scimitar', 'Dagger'],
                ['Dagger', 'Dagger']
            ]
        ]);
    });

    await t.test('11. Gladiator (Generic Melee or Ranged attacks without specific weapon name in text)', () => {
        const result = parseEndToEnd(
            'The gladiator makes three melee attacks or two ranged attacks.',
            ['Spear', 'Shield Bash'],
            'Gladiator'
        );
        assert.deepEqual(result, [
            [
                ['melee attack', 'melee attack', 'melee attack'],
                ['ranged attack', 'ranged attack']
            ]
        ]);
    });

    await t.test('12. Veteran (Conditional bonus attack: 2 Longsword + optional Shortsword)', () => {
        const result = parseEndToEnd(
            'The veteran makes two longsword attacks. If it has a shortsword drawn, it can also make a shortsword attack.',
            ['Longsword', 'Shortsword', 'Heavy Crossbow'],
            'Veteran'
        );
        assert.deepEqual(result, [
            [
                ['Longsword', 'Longsword', 'Shortsword'],
                ['Longsword', 'Longsword']
            ]
        ]);
    });

    await t.test('13. Replacement Clause (2 Longsword attacks, can replace one attack with Grapple)', () => {
        const result = parseEndToEnd(
            'The warrior makes two longsword attacks. It can replace one attack with Grapple.',
            ['Longsword', 'Grapple'],
            'Warrior'
        );
        assert.deepEqual(result, [
            [
                ['Longsword', 'Longsword'],
                ['Grapple', 'Longsword'],
                ['Longsword', 'Grapple']
            ]
        ]);
    });

    await t.test('14. Roper (Four Tendril attacks + 1 Bite)', () => {
        const result = parseEndToEnd(
            'The roper makes four attacks with its tendrils and one attack with its bite.',
            ['Tendril', 'Bite', 'Reel'],
            'Roper'
        );
        assert.deepEqual(result, [
            [['Tendril', 'Tendril', 'Tendril', 'Tendril', 'Bite']]
        ]);
    });

    await t.test('15. Marilith (Seven attacks: six with its longswords and one with its tail)', () => {
        const result = parseEndToEnd(
            'The marilith makes seven attacks: six with its longswords and one with its tail.',
            ['Longsword', 'Tail', 'Teleport'],
            'Marilith'
        );
        assert.deepEqual(result, [
            [['Longsword', 'Longsword', 'Longsword', 'Longsword', 'Longsword', 'Longsword', 'Tail']]
        ]);
    });

    await t.test('16. Blorg (Either three sword attacks then one longbow attack, or two sling attacks)', () => {
        const result = parseEndToEnd(
            'The blorg makes either three attacks with their sword then one with their longbow, or they make two sling attacks.',
            ['Sword', 'Longbow', 'Sling'],
            'Blorg'
        );
        assert.deepEqual(result, [
            [
                ['Sword', 'Sword', 'Sword', '>Longbow'],
                ['Sling', 'Sling']
            ]
        ]);
    });
});

test('parseLLMResponse cleanly strips markdown code blocks and validates 3D string arrays', () => {
    const rawWithFences = '```json\n[\n  [["<ITEM_0>"]],\n  [["<ITEM_1>", "<ITEM_2>", "<ITEM_2>"]]\n]\n```';
    const parsed = parseLLMResponse(rawWithFences);
    assert.deepEqual(parsed, [[['<ITEM_0>']], [['<ITEM_1>', '<ITEM_2>', '<ITEM_2>']]]);

    // Invalid JSON or non-3D arrays should return null
    assert.equal(parseLLMResponse('invalid json'), null);
    assert.equal(parseLLMResponse('{"not": "an array"}'), null);
    assert.equal(parseLLMResponse('["1D array"]'), null);
});
