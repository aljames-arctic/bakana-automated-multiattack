import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import {
    abstractMultiattackDescription,
    hydrateMultiattackSequence,
    resolveActorItem
} from '../../src/multiattack/abstraction.js';

function createMockActorItems(names) {
    return names.map((name) => ({ name }));
}

test('abstractMultiattackDescription collapses Brown Bear and Owlbear into identical <ITEM_N> templates regardless of inventory order', () => {
    const bearDesc = 'The bear makes two attacks: one with its bite and one with its claws.';
    const bearItems = createMockActorItems(['Multiattack', 'Bite', 'Claws']);

    const owlbearDesc = 'The owlbear makes two attacks: one with its beak and one with its claws.';
    // Notice inventory order is reversed: Claws before Beak!
    const owlbearItems = createMockActorItems(['Multiattack', 'Claws', 'Beak']);

    const bearAbstract = abstractMultiattackDescription(bearDesc, bearItems, 'Brown Bear');
    const owlbearAbstract = abstractMultiattackDescription(owlbearDesc, owlbearItems, 'Owlbear');

    assert.equal(
        bearAbstract.template,
        '<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>.',
        'Brown Bear should abstract to canonical template'
    );
    assert.equal(
        owlbearAbstract.template,
        bearAbstract.template,
        'Owlbear and Brown Bear must produce the EXACT same canonical template string'
    );

    assert.deepEqual(bearAbstract.itemMap, { '<ITEM_0>': 'Bite', '<ITEM_1>': 'Claws' });
    assert.deepEqual(owlbearAbstract.itemMap, { '<ITEM_0>': 'Beak', '<ITEM_1>': 'Claws' });

    // Hydrate canonical template sequence back for each creature
    const canonicalTemplateSeq = [[['<ITEM_0>', '<ITEM_1>']]];
    assert.deepEqual(
        hydrateMultiattackSequence(canonicalTemplateSeq, bearAbstract.itemMap),
        [[['Bite', 'Claws']]]
    );
    assert.deepEqual(
        hydrateMultiattackSequence(canonicalTemplateSeq, owlbearAbstract.itemMap),
        [[['Beak', 'Claws']]]
    );
});

test('abstractMultiattackDescription handles multi-word items, plurals, and sectioning (Adult Red Dragon & Bandit Captain)', () => {
    const dragonDesc = 'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.';
    const dragonItems = createMockActorItems(['Multiattack', 'Bite', 'Claw', 'Tail', 'Frightful Presence', 'Fire Breath']);

    const dragonAbstract = abstractMultiattackDescription(dragonDesc, dragonItems, 'Adult Red Dragon');
    assert.equal(
        dragonAbstract.template,
        '<ACTOR> can use its <ITEM_0>. <ACTOR> then makes three attacks: one with its <ITEM_1> and two with its <ITEM_2>.'
    );
    assert.deepEqual(dragonAbstract.itemMap, {
        '<ITEM_0>': 'Frightful Presence',
        '<ITEM_1>': 'Bite',
        '<ITEM_2>': 'Claw'
    });

    const captainDesc = 'The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.';
    const captainItems = createMockActorItems(['Multiattack', 'Scimitar', 'Dagger']);

    const captainAbstract = abstractMultiattackDescription(captainDesc, captainItems, 'Bandit Captain');
    assert.equal(
        captainAbstract.template,
        '<ACTOR> makes three melee attacks: two with its <ITEM_0> and one with its <ITEM_1>. Or <ACTOR> makes two ranged attacks with its <ITEM_1>.'
    );
    assert.deepEqual(captainAbstract.itemMap, {
        '<ITEM_0>': 'Scimitar',
        '<ITEM_1>': 'Dagger'
    });
});

test('resolveActorItem matches exact names, singular/plural variations, and stripped " Attack" suffixes', () => {
    const mockActor = {
        name: 'Test Monster',
        items: new Map([
            ['1', { name: 'Claws' }],
            ['2', { name: 'Morningstar' }],
            ['3', { name: 'Bite' }]
        ])
    };

    assert.equal(resolveActorItem(mockActor, 'Claw')?.name, 'Claws', 'Singular "Claw" should resolve plural "Claws" item');
    assert.equal(resolveActorItem(mockActor, 'claws')?.name, 'Claws', 'Case-insensitive exact match');
    assert.equal(resolveActorItem(mockActor, 'Morningstar Attack')?.name, 'Morningstar', 'Should strip " Attack" suffix');
    assert.equal(resolveActorItem(mockActor, 'Bites')?.name, 'Bite', 'Plural "Bites" should resolve singular "Bite" item');
});

test('abstractMultiattackDescription resolves D&D 5e v4+ 2024 MM enrichers ([[lookup @name lowercase]] and [[/item .mmArcaneBurst000]])', () => {
    const archmageDesc = 'The [[lookup @name lowercase]]{monster} makes four [[/item .mmArcaneBurst000]] attacks.';
    const archmageItems = createMockActorItems(['Multiattack', 'Arcane Burst']);

    const abstracted = abstractMultiattackDescription(archmageDesc, archmageItems, 'Archmage');
    assert.equal(
        abstracted.template,
        '<ACTOR> makes four <ITEM_0> attacks.',
        'Should replace [[lookup @name]] with <ACTOR> and [[/item .mmArcaneBurst000]] with <ITEM_0>'
    );
    assert.deepEqual(abstracted.itemMap, {
        '<ITEM_0>': 'Arcane Burst'
    });
});
