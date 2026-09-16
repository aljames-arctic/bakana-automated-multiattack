import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { autorecManager } from '../../src/autorec/autorecManager.js';
import { registerModuleSettings } from '../../src/settings.js';

test('AutorecManager stores gathered multiattacks centrally and never calls setFlag on actors or items', async () => {
    await autorecManager.resetToDefaults(false);

    let setFlagCalled = false;
    const mockItem = {
        name: 'Multiattack',
        system: {
            description: {
                value: '<p>The manticore makes three attacks: one with its bite and two with its tail spikes.</p>'
            }
        },
        setFlag: () => {
            setFlagCalled = true;
        }
    };

    const mockActor = {
        name: 'Manticore',
        items: new Map([
            ['1', mockItem],
            ['2', { name: 'Bite' }],
            ['3', { name: 'Tail Spike' }]
        ]),
        setFlag: () => {
            setFlagCalled = true;
        }
    };

    const result = await autorecManager.resolveOrGather(
        mockActor,
        mockItem,
        'The manticore makes three attacks: one with its bite and two with its tail spikes.'
    );

    assert.ok(result, 'Should resolve sequence from central AutorecManager');
    assert.deepEqual(result.sequence, [[['Bite', 'Tail Spike', 'Tail Spike']]]);
    assert.equal(setFlagCalled, false, 'Must NEVER call setFlag on actor or item documents');

    // Verify specific Actor::Item override takes precedence over template
    await autorecManager.registerEntry({
        id: 'override-manticore',
        name: 'Custom Manticore Override',
        type: 'override',
        pattern: 'Manticore::Multiattack',
        sequence: [[['Tail Spike', 'Tail Spike', 'Tail Spike']]],
        enabled: true
    }, false);

    const overrideResult = await autorecManager.resolveOrGather(
        mockActor,
        mockItem,
        'The manticore makes three attacks: one with its bite and two with its tail spikes.'
    );

    assert.equal(overrideResult.source, 'override');
    assert.deepEqual(overrideResult.sequence, [[['Tail Spike', 'Tail Spike', 'Tail Spike']]]);
});

test('deleteEntry permanently removes both default templates and custom entries without resurrection on settings onChange', async () => {
    registerModuleSettings();
    await autorecManager.resetToDefaults(true);

    const initialCount = autorecManager.getAllEntries().length;
    assert.ok(initialCount > 0, 'Should start with default templates');

    const firstId = autorecManager.getAllEntries()[0]?.id;
    assert.ok(firstId, 'First entry should have an id');

    const deleted = await autorecManager.deleteEntry(firstId, true);
    assert.equal(deleted, true, 'deleteEntry should return true');

    const afterDelete = autorecManager.getAllEntries();
    assert.equal(afterDelete.length, initialCount - 1, 'Entry count should decrease by 1');
    assert.equal(
        afterDelete.some((e) => e.id === firstId),
        false,
        'Deleted default template must not be resurrected by settings onChange'
    );
});

test('findDuplicatePattern detects existing patterns and registerEntry deduplicates against existing entries', async () => {
    await autorecManager.resetToDefaults(false);

    const existing = await autorecManager.registerEntry({
        id: 'dup-test-1',
        name: 'First Entry',
        type: 'template',
        pattern: 'the <actor> makes two <item_0> attacks.',
        sequence: [[['<ITEM_0>', '<ITEM_0>']]],
        enabled: true
    }, false);

    // Case-insensitive and whitespace-normalized match
    const found = autorecManager.findDuplicatePattern('  THE <actor> MAKES TWO <ITEM_0> ATTACKS.  ');
    assert.ok(found, 'Should detect duplicate pattern ignoring case and extra whitespace');
    assert.equal(found.id, existing.id);

    // Excluding self should return null
    const excluded = autorecManager.findDuplicatePattern('the <actor> makes two <item_0> attacks.', existing.id);
    assert.equal(excluded, null, 'Excluding self ID should return null');

    // Empty pattern should never match anything
    assert.equal(autorecManager.findDuplicatePattern('   '), null, 'Empty pattern should return null');

    // Registering a temporary unfilled entry first, then updating it with the duplicate pattern
    await autorecManager.registerEntry({
        id: 'temp-unfilled',
        name: 'New Template',
        type: 'template',
        pattern: '',
        sequence: [],
        enabled: true
    }, false);

    const countBefore = autorecManager.getAllEntries().length;

    const merged = await autorecManager.registerEntry({
        id: 'temp-unfilled',
        name: 'Updated Name',
        type: 'template',
        pattern: 'the <actor> makes two <item_0> attacks.',
        sequence: [[['<ITEM_0>', '<ITEM_0>']]],
        enabled: true
    }, false);

    assert.equal(merged.id, existing.id, 'Should update and return existing entry ID');
    assert.equal(
        autorecManager.getAllEntries().some((e) => e.id === 'temp-unfilled'),
        false,
        'Temporary unfilled entry should be cleaned up when merged into existing pattern'
    );
    assert.equal(autorecManager.getAllEntries().length, countBefore - 1, 'Total entries should not contain duplicate');
});


