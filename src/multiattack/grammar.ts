import { localize } from '../lib/utils.js';

export interface LocalizedGrammar {
    multiattackNames: string[];
    numberWords: Record<string, number>;
    attackSuffixes: string[];
    meleeKeywords: string[];
    rangedKeywords: string[];
    spellKeywords: string[];
    anyAttackKeywords: string[];
    subjectArticles: string[];
    subjectPronouns: string[];
    possessiveKeywords: string[];
    actionVerbs: string[];
    thenDelimiters: string[];
    orDelimiters: string[];
    canUseKeywords: string[];
    replaceKeywords: string[];
    replaceWithKeywords: string[];
    conditionIfKeywords: string[];
    bonusAlsoKeywords: string[];
    actorSubjectRegex: RegExp;
    pronounThenRegex: RegExp;
    thenDelimiterRegex: RegExp;
    orDelimiterRegex: RegExp;
}

const DEFAULT_NUMBER_FALLBACKS: Record<number, string> = {
    1: 'a, an, one',
    2: 'two',
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
    7: 'seven',
    8: 'eight',
    9: 'nine',
    10: 'ten'
};

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Helper to fetch a comma-separated list of localized strings via `localize()`,
 * falling back to the provided default string if untranslated.
 */
function getLocalizedList(key: string, fallback: string): string[] {
    const raw = localize(key, fallback) ?? fallback;
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Converts an array of phrases into an escaped regex alternation string `(?:phrase1|phrase2)`,
 * sorted longest-first to prevent partial prefix matching, and allowing flexible whitespace.
 */
function buildAlternationPattern(phrases: string[]): string {
    const sorted = [...phrases]
        .map((p) => p.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    if (sorted.length === 0) return '(?:\\b\\B)';
    return '(?:' + sorted.map((p) => escapeRegExp(p).replace(/\s+/g, '\\s+')).join('|') + ')';
}

/**
 * Dynamically constructs the active language's grammar ruleset using Foundry's `localize()` (`game.i18n`).
 * All number words, section delimiters ("then"), branch delimiters ("or"), melee/ranged labels,
 * and subject/verb patterns are resolved through `BAM.grammar.*` localization keys.
 *
 * @returns {LocalizedGrammar}
 */
export function getLocalizedGrammar(): LocalizedGrammar {
    const multiattackNames = getLocalizedList('BAM.grammar.multiattackNames', 'Multiattack');
    const attackSuffixes = getLocalizedList('BAM.grammar.attackSuffixes', 'attack, attacks');
    const meleeKeywords = getLocalizedList('BAM.grammar.meleeKeywords', 'melee attack, melee attacks');
    const rangedKeywords = getLocalizedList('BAM.grammar.rangedKeywords', 'ranged attack, ranged attacks');
    const spellKeywords = getLocalizedList('BAM.grammar.spellKeywords', 'spell attack, spell attacks');
    const anyAttackKeywords = getLocalizedList('BAM.grammar.anyAttackKeywords', 'any attack, any attacks');
    const subjectArticles = getLocalizedList('BAM.grammar.subjectArticles', 'the, this');
    const subjectPronouns = getLocalizedList('BAM.grammar.subjectPronouns', 'it, he, she, they');
    const possessiveKeywords = getLocalizedList('BAM.grammar.possessiveKeywords', 'its, his, her, their');
    const actionVerbs = getLocalizedList('BAM.grammar.actionVerbs', 'makes, can use, uses, attacks, casts, has, also makes');
    const thenDelimiters = getLocalizedList('BAM.grammar.thenDelimiters', 'then');
    const orDelimiters = getLocalizedList('BAM.grammar.orDelimiters', 'or');
    const canUseKeywords = getLocalizedList('BAM.grammar.canUseKeywords', 'can use, uses');
    const replaceKeywords = getLocalizedList('BAM.grammar.replaceKeywords', 'can replace');
    const replaceWithKeywords = getLocalizedList('BAM.grammar.replaceWithKeywords', 'with');
    const conditionIfKeywords = getLocalizedList('BAM.grammar.conditionIfKeywords', 'if, when');
    const bonusAlsoKeywords = getLocalizedList('BAM.grammar.bonusAlsoKeywords', 'can also make, also makes');

    const numberWords: Record<string, number> = {};
    for (let n = 1; n <= 10; n++) {
        const words = getLocalizedList(`BAM.grammar.numbers.${n}`, DEFAULT_NUMBER_FALLBACKS[n] ?? String(n));
        for (const word of words) {
            numberWords[word.toLowerCase()] = n;
        }
    }

    const articlesPattern = buildAlternationPattern(subjectArticles);
    const pronounsPattern = buildAlternationPattern(subjectPronouns);
    const verbsPattern = buildAlternationPattern(actionVerbs);
    const thenPattern = buildAlternationPattern(thenDelimiters);
    const orPattern = buildAlternationPattern(orDelimiters);
    const numWordsPattern = buildAlternationPattern(Object.keys(numberWords));
    const meleeRangedPattern = buildAlternationPattern([...meleeKeywords, ...rangedKeywords, ...spellKeywords, ...anyAttackKeywords]);
    const suffixesPattern = buildAlternationPattern(attackSuffixes);

    // Matches localized subject phrases (e.g. "The bear", "Der Bär", "Le capitaine") before localized action verbs
    const actorSubjectRegex = new RegExp(
        `\\b${articlesPattern}\\s+[\\p{L}-]+(?:\\s+[\\p{L}-]+)?(?=\\s+${verbsPattern}\\b)`,
        'giu'
    );

    // Matches sentence boundary + pronoun + "then" transition (e.g. ". It then", ". Er führt danach", ". Il effectue ensuite")
    const pronounThenRegex = new RegExp(
        `([.!?]\\s+)${pronounsPattern}(?:\\s+${verbsPattern})?\\s+${thenPattern}\\b`,
        'giu'
    );

    // Splits sections on "then" delimiters
    const thenDelimiterRegex = new RegExp(
        `(?:[.!?]\\s*(?:<ACTOR>|${pronounsPattern})?\\s*(?:${verbsPattern}\\s+)?${thenPattern}\\b|\\b${thenPattern}\\s+(?=${verbsPattern}\\b))`,
        'iu'
    );

    // Splits alternative "or" branches
    const orDelimiterRegex = new RegExp(
        `(?:[.!?]\\s+${orPattern}\\b|\\b${orPattern}\\s+<ACTOR>|\\b${orPattern}\\s+(?=(?:${numWordsPattern}|\\d+)\\s+(?:<ITEM_\\d+>|${meleeRangedPattern}|${suffixesPattern})))`,
        'iu'
    );

    return {
        multiattackNames,
        numberWords,
        attackSuffixes,
        meleeKeywords,
        rangedKeywords,
        spellKeywords,
        anyAttackKeywords,
        subjectArticles,
        subjectPronouns,
        possessiveKeywords,
        actionVerbs,
        thenDelimiters,
        orDelimiters,
        canUseKeywords,
        replaceKeywords,
        replaceWithKeywords,
        conditionIfKeywords,
        bonusAlsoKeywords,
        actorSubjectRegex,
        pronounThenRegex,
        thenDelimiterRegex,
        orDelimiterRegex
    };
}

/**
 * Checks whether an Item or Activity name matches any localized Multiattack name from `BAM.grammar.multiattackNames`.
 */
export function isLocalizedMultiattackName(name: string): boolean {
    if (!name) return false;
    const clean = name.trim().toLowerCase();
    const grammar = getLocalizedGrammar();
    return grammar.multiattackNames.some((kw) => clean === kw.toLowerCase() || clean.includes(kw.toLowerCase()));
}
