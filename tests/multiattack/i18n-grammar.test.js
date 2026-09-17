import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../setup.js';
import { abstractMultiattackDescription, hydrateMultiattackSequence } from '../../src/multiattack/abstraction.js';
import { parseMultiattackTemplate } from '../../src/multiattack/parser.js';
import { isLocalizedMultiattackName } from '../../src/multiattack/grammar.js';
import { adapter } from '../../src/adapter/index.js';

const deJson = JSON.parse(fs.readFileSync(path.resolve('lang/de.json'), 'utf8'));
const frJson = JSON.parse(fs.readFileSync(path.resolve('lang/fr.json'), 'utf8'));
const enJson = JSON.parse(fs.readFileSync(path.resolve('lang/en.json'), 'utf8'));

function flattenTranslations(obj, prefix = '', result = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            flattenTranslations(v, key, result);
        } else {
            result[key] = String(v);
        }
    }
    return result;
}

const FLAT_DICT = {
    en: flattenTranslations(enJson),
    de: flattenTranslations(deJson),
    fr: flattenTranslations(frJson)
};

function setMockLanguage(langCode) {
    const dict = FLAT_DICT[langCode] ?? FLAT_DICT.en;
    globalThis.game.i18n = {
        has: (key) => Object.prototype.hasOwnProperty.call(dict, key),
        localize: (key) => dict[key] ?? key,
        format: (key) => dict[key] ?? key
    };
}

function createItems(names) {
    return names.map((name) => ({ name }));
}

function parseEndToEnd(description, itemNames, actorName) {
    const items = createItems(itemNames);
    const { template, itemMap } = abstractMultiattackDescription(description, items, actorName);
    const templateSeq = parseMultiattackTemplate(template);
    assert.ok(templateSeq, `Failed to deterministically parse localized template: "${template}"`);
    return hydrateMultiattackSequence(templateSeq, itemMap);
}

test('Multi-Language Grammar & Localization (localize()) Support', async (t) => {
    t.afterEach(() => {
        setMockLanguage('en');
    });

    await t.test('German (de): detects "Mehrfachangriff" and abstracts/parses Braunbär & Roter Drache via localize()', () => {
        setMockLanguage('de');

        assert.equal(isLocalizedMultiattackName('Mehrfachangriff'), true);
        assert.equal(isLocalizedMultiattackName('Biss'), false);

        // Chat card detection in German
        const mockDeActor = {
            id: 'actor-de-bear',
            name: 'Braunbär',
            items: new Map([
                ['item-ma', { id: 'item-ma', name: 'Mehrfachangriff', system: { description: { value: 'Der Bär führt zwei Angriffe aus.' } } }]
            ])
        };
        globalThis.game.actors.set('actor-de-bear', mockDeActor);
        const chatMsg = {
            speaker: { actor: 'actor-de-bear' },
            flags: { dnd5e: { roll: { type: 'other' }, item: { id: 'item-ma' } } },
            content: '<div class="card-header"><h3>Mehrfachangriff</h3></div>'
        };
        assert.equal(adapter.isMultiattackMessage(chatMsg), true);

        // 1. Braunbär (Two attacks: 1 Biss + 1 Klauen)
        const bearResult = parseEndToEnd(
            'Der Bär führt zwei Angriffe aus: einen mit seinem Biss und einen mit seinen Klauen.',
            ['Mehrfachangriff', 'Biss', 'Klauen'],
            'Braunbär'
        );
        assert.deepEqual(bearResult, [[['Biss', 'Klauen']]]);

        // 2. Roter Drache ("danach" sectioning: Schreckliche Präsenz -> 1 Biss + 2 Klauen)
        const dragonResult = parseEndToEnd(
            'Der Drache kann seine Schreckliche Präsenz einsetzen. Er führt danach drei Angriffe aus: einen mit seinem Biss und zwei mit seinen Klauen.',
            ['Mehrfachangriff', 'Biss', 'Klauen', 'Schreckliche Präsenz'],
            'Roter Drache'
        );
        assert.deepEqual(dragonResult, [
            [['Schreckliche Präsenz']],
            [['Biss', 'Klauen', 'Klauen']]
        ]);
    });

    await t.test('French (fr): detects "Attaques multiples" and abstracts/parses Ours brun & Capitaine bandit via localize()', () => {
        setMockLanguage('fr');

        assert.equal(isLocalizedMultiattackName('Attaques multiples'), true);
        assert.equal(isLocalizedMultiattackName('Attaque multiple'), true);
        assert.equal(isLocalizedMultiattackName('Morsure'), false);

        // Chat card detection in French
        const mockFrActor = {
            id: 'actor-fr-bear',
            name: 'Ours brun',
            items: new Map([
                ['item-ma', { id: 'item-ma', name: 'Attaques multiples', system: { description: { value: "L'ours effectue deux attaques." } } }]
            ])
        };
        globalThis.game.actors.set('actor-fr-bear', mockFrActor);
        const chatMsg = {
            speaker: { actor: 'actor-fr-bear' },
            flags: { dnd5e: { roll: { type: 'other' }, item: { id: 'item-ma' } } },
            content: '<div class="card-header"><h3>Attaques multiples</h3></div>'
        };
        assert.equal(adapter.isMultiattackMessage(chatMsg), true);

        // 1. Ours brun (Deux attaques : une avec sa morsure et une avec ses griffes)
        const bearResult = parseEndToEnd(
            "L'ours effectue deux attaques : une avec sa morsure et une avec ses griffes.",
            ['Attaques multiples', 'Morsure', 'Griffes'],
            'Ours brun'
        );
        assert.deepEqual(bearResult, [[['Morsure', 'Griffes']]]);

        // 2. Capitaine bandit ("Ou" branching: 2 Cimeterre + 1 Dague OU 2 Dague à distance)
        const captainResult = parseEndToEnd(
            'Le capitaine effectue trois attaques au corps à corps : deux avec son cimeterre et une avec sa dague. Ou le capitaine effectue deux attaques à distance avec ses dagues.',
            ['Attaques multiples', 'Cimeterre', 'Dague'],
            'Capitaine bandit'
        );
        assert.deepEqual(captainResult, [
            [
                ['Cimeterre', 'Cimeterre', 'Dague'],
                ['Dague', 'Dague']
            ]
        ]);
    });
});
