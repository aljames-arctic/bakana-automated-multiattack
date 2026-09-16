import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { autorecManager } from '../../src/autorec/autorecManager.js';

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
