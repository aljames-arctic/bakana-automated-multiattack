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

