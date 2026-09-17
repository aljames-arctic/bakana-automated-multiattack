import { getLocalizedGrammar, escapeRegExp, type LocalizedGrammar } from './grammar.js';
import type { MultiattackSequence } from '../types/global.d.js';

/**
 * Parses a localized number word or digit string into an integer using `grammar.numberWords`.
 * @param {string | undefined} token Word or digit string
 * @param {number} [defaultVal=1] Fallback integer value
 * @param {LocalizedGrammar} [grammar] Active localized grammar
 * @returns {number}
 */
export function parseQuantity(
    token: string | undefined,
    defaultVal: number = 1,
    grammar: LocalizedGrammar = getLocalizedGrammar()
): number {
    if (!token) return defaultVal;
    const clean = token.trim().toLowerCase();
    if (grammar.numberWords[clean] !== undefined) {
        return grammar.numberWords[clean]!;
    }
    const num = parseInt(clean, 10);
    return Number.isFinite(num) && num > 0 ? num : defaultVal;
}

/**
 * Repeats an item token `count` times as an array.
 */
function repeatToken(token: string, count: number): string[] {
    const res: string[] = [];
    for (let i = 0; i < count; i++) {
        res.push(token);
    }
    return res;
}

/**
 * Extracts quantified `<ITEM_N>` or generic melee/ranged attack tokens from an atomic clause (no 'then' transitions).
 */
function parseAtomicClauseItems(clause: string, grammar: LocalizedGrammar): string[] {
    const clean = clause.trim();
    if (!clean) return [];

    // 1. Check if clause has a colon specifying breakdown (e.g. "makes three attacks: one with its <ITEM_0> and two with its <ITEM_1>")
    const colonIdx = clean.indexOf(':');
    if (colonIdx !== -1) {
        const afterColon = clean.slice(colonIdx + 1).trim();
        const breakdown = parseQuantifiedItemList(afterColon, grammar);
        if (breakdown.length > 0) {
            return breakdown;
        }
    }

    // 2. Check for localized ability usage phrases (e.g. "can use its <ITEM_0>", "kann seine <ITEM_0> einsetzen", "peut utiliser sa <ITEM_0>")
    const canUseAlternation = grammar.canUseKeywords
        .map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+'))
        .join('|');
    if (canUseAlternation) {
        const useRegex = new RegExp(`\\b(?:${canUseAlternation})\\b[^.!?]*?(<ITEM_\\d+>)`, 'iu');
        const useMatch = useRegex.exec(clean);
        // Ensure it's an ability use clause rather than a standard quantified attack list
        if (useMatch && useMatch[1] && !/\b\d+\b/.test(clean.replace(/<ITEM_\d+>/g, ''))) {
            // Check if no number word > 1 precedes it
            const hasMultiQty = Object.entries(grammar.numberWords).some(
                ([word, qty]) => qty > 1 && new RegExp(`\\b${escapeRegExp(word)}\\b`, 'iu').test(clean)
            );
            if (!hasMultiQty) {
                return [useMatch[1]];
            }
        }
    }

    // 3. Parse quantified item list from the clause directly
    const directList = parseQuantifiedItemList(clean, grammar);
    if (directList.length > 0) {
        return directList;
    }

    return [];
}

export interface VariableDefinitions {
    variables: Record<string, string>;
    cleanTemplate: string;
}

/**
 * Extracts variable definitions (e.g., `Activities: (-Flail:Activity1 | -Flail:Activity2)`)
 * from a multiattack pattern template.
 */
export function extractVariableDefinitions(template: string): VariableDefinitions {
    const variables: Record<string, string> = {};
    if (!template) return { variables, cleanTemplate: '' };

    const lines = template.split(/[\r\n]+/);
    const remainingLines: string[] = [];

    const varRegex = /^\s*([A-Za-z0-9_<>]+)\s*:\s*(?:\(([^)]+)\)|(.+))\s*$/;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = varRegex.exec(trimmed);
        if (match && match[1] && (match[2] || match[3])) {
            const varName = match[1].trim();
            const rawChoices = (match[2] ?? match[3] ?? '').trim();
            if (rawChoices.includes('|') || rawChoices.includes(':') || /\(\d+\)/.test(rawChoices)) {
                variables[varName] = rawChoices.startsWith('(') && rawChoices.endsWith(')') ? rawChoices : `(${rawChoices})`;
                continue;
            }
        }
        remainingLines.push(line);
    }

    return {
        variables,
        cleanTemplate: remainingLines.join('\n').trim()
    };
}

/**
 * Expands variable definitions inside a multiattack sequence.
 */
export function expandVariablesInSequence(
    sequence: MultiattackSequence,
    variables: Record<string, string>
): MultiattackSequence {
    if (!Array.isArray(sequence) || Object.keys(variables).length === 0) return sequence;

    return sequence.map((section) =>
        (Array.isArray(section) ? section : []).map((optionFlow) =>
            (Array.isArray(optionFlow) ? optionFlow : []).map((token) => {
                const trimmed = String(token ?? '').trim();
                const isStrict = trimmed.startsWith('>');
                const cleanKey = isStrict ? trimmed.slice(1).trim() : trimmed;

                if (variables[cleanKey]) {
                    const expanded = variables[cleanKey]!;
                    return isStrict ? `>${expanded}` : expanded;
                }
                return token;
            })
        )
    );
}

/**
 * Extracts quantified `<ITEM_N>` or generic melee/ranged attack tokens from a single clause
 * using localized number words and keywords from `grammar`.
 * If the clause contains an intra-clause "then" transition or explicit `>` step operator,
 * tokens are split and prefixed appropriately.
 */
function parseSingleClauseItems(clause: string, grammar: LocalizedGrammar): string[] {
    const clean = clause.trim();
    if (!clean) return [];

    // 1. If clause contains explicit '>' step operators (surrounded by spaces), parse as explicit step flow
    if (/\s+>\s+/.test(clean)) {
        const parts = clean.split(/\s+>\s+/).map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) {
            const explicitFlow: string[] = [];
            parts.forEach((part, idx) => {
                const parsedPart = parseAtomicClauseItems(part, grammar);
                const itemsToUse = parsedPart.length > 0 ? parsedPart : [part];
                for (const item of itemsToUse) {
                    explicitFlow.push(idx > 0 && !item.startsWith('>') ? `>${item}` : item);
                }
            });
            if (explicitFlow.length > 0) return explicitFlow;
        }
    }

    const thenPattern = grammar.thenDelimiters.map((w) => escapeRegExp(w)).join('|');
    if (thenPattern) {
        const intraThenRegex = new RegExp(`\\b(?:and\\s+|und\\s+|et\\s+)?(?:${thenPattern})\\b`, 'iu');
        if (intraThenRegex.test(clean)) {
            const subClauses = clean.split(intraThenRegex).map((s) => s.trim()).filter(Boolean);
            if (subClauses.length > 1) {
                const combined: string[] = [];
                subClauses.forEach((sub, idx) => {
                    const subItems = parseAtomicClauseItems(sub, grammar);
                    for (const item of subItems) {
                        combined.push(idx > 0 && !item.startsWith('>') ? `>${item}` : item);
                    }
                });
                if (combined.length > 0) {
                    return combined;
                }
            }
        }
    }

    return parseAtomicClauseItems(clean, grammar);
}

/**
 * Parses a list of quantified `<ITEM_N>` or localized generic melee/ranged attacks from a phrase.
 * Works across languages by matching `[Localized Number Word or Digit]` followed within a few words
 * by `<ITEM_N>` or a localized melee/ranged keyword.
 */
function parseQuantifiedItemList(phrase: string, grammar: LocalizedGrammar): string[] {
    const results: string[] = [];

    const numWordsSorted = Object.keys(grammar.numberWords)
        .sort((a, b) => b.length - a.length)
        .map((w) => escapeRegExp(w));
    const numPattern = numWordsSorted.length > 0
        ? `(?:${numWordsSorted.join('|')}|\\d+)`
        : '\\d+';

    const meleeSorted = [...grammar.meleeKeywords].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+'));
    const rangedSorted = [...grammar.rangedKeywords].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+'));
    const spellSorted = [...grammar.spellKeywords].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+'));
    const anyAttackSorted = [...grammar.anyAttackKeywords].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+'));

    const hasExplicitItems = /<ITEM_\d+>/.test(phrase);
    const targetAlternatives = hasExplicitItems
        ? '<ITEM_\\d+>'
        : [...meleeSorted, ...rangedSorted, ...spellSorted, ...anyAttackSorted].join('|');

    // Matches: (NumberWord) + up to 8 intervening words + (Target)
    const tokenRegex = new RegExp(
        `\\b(${numPattern})\\b(?:\\s+(?!<ITEM_\\d+>|${numPattern}\\b)[\\p{L}-]+){0,8}?\\s*(${targetAlternatives})`,
        'giu'
    );

    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(phrase)) !== null) {
        const qtyStr = match[1];
        const rawTarget = (match[2] ?? '').trim();
        const qty = parseQuantity(qtyStr, 1, grammar);

        let normalizedTarget = rawTarget;
        const lowerTarget = rawTarget.toLowerCase();

        if (grammar.meleeKeywords.some((k) => k.toLowerCase() === lowerTarget)) {
            normalizedTarget = 'melee attack';
        } else if (grammar.rangedKeywords.some((k) => k.toLowerCase() === lowerTarget)) {
            normalizedTarget = 'ranged attack';
        } else if (grammar.spellKeywords.some((k) => k.toLowerCase() === lowerTarget)) {
            normalizedTarget = 'spell attack';
        } else if (grammar.anyAttackKeywords.some((k) => k.toLowerCase() === lowerTarget)) {
            normalizedTarget = 'any attack';
        }

        results.push(...repeatToken(normalizedTarget, qty));
    }

    // Fallback: if no quantified pairs matched, look for standalone items, choice groups, or activity tokens
    if (results.length === 0) {
        const cleanPhrase = phrase.trim();
        if (cleanPhrase.startsWith('(') || (cleanPhrase.includes(':') && !cleanPhrase.includes(' ')) || (cleanPhrase.includes('|') && !cleanPhrase.includes(' '))) {
            return [cleanPhrase];
        }

        const hasActionVerb = grammar.actionVerbs.some((v) =>
            new RegExp(`\\b${escapeRegExp(v).replace(/\s+/g, '\\s+')}\\b`, 'iu').test(phrase)
        );
        if (hasActionVerb) {
            const singleItemRegex = /(<ITEM_\d+>)/g;
            let singleMatch: RegExpExecArray | null;
            while ((singleMatch = singleItemRegex.exec(phrase)) !== null) {
                if (singleMatch[1]) {
                    results.push(singleMatch[1]);
                }
            }
        }
    }

    return results;
}

/**
 * Applies replacement rules (e.g. "can replace one attack with <ITEM_Y>") to a set of base sequences.
 */
function applyReplacementClause(baseSequences: string[][], replacementItem: string, targetItemToReplace?: string): string[][] {
    const out: string[][] = [];
    const seen = new Set<string>();

    const addUnique = (seq: string[]) => {
        const key = JSON.stringify(seq);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(seq);
        }
    };

    for (const seq of baseSequences) {
        addUnique([...seq]);

        for (let i = 0; i < seq.length; i++) {
            const current = seq[i];
            if (targetItemToReplace && current !== targetItemToReplace) {
                continue;
            }
            const replaced = [...seq];
            replaced[i] = replacementItem;
            addUnique(replaced);
        }
    }

    return out;
}

/**
 * Parses a single "then"-delimited section of an abstracted multiattack template
 * into an array of alternative attack sequences (`string[][]`) using localized grammar rules.
 *
 * @param {string} sectionText Abstracted section text
 * @param {LocalizedGrammar} [grammar] Active localized grammar
 * @returns {string[][]}
 */
export function parseMultiattackSection(
    sectionText: string,
    grammar: LocalizedGrammar = getLocalizedGrammar()
): string[][] {
    const clean = sectionText.trim();
    if (!clean) return [];

    let bonusItem: string | null = null;
    let mainText = clean;

    // 1. Check for localized conditional bonus attack sentence
    const ifAlternation = grammar.conditionIfKeywords.map((w) => escapeRegExp(w)).join('|');
    const alsoAlternation = grammar.bonusAlsoKeywords.map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+')).join('|');
    if (ifAlternation && alsoAlternation) {
        const bonusRegex = new RegExp(
            `([.!?]\\s*(?:${ifAlternation})\\b[^.!?]*?\\b(?:${alsoAlternation})\\b[^.!?]*?(<ITEM_\\d+>)[^.!?]*\\.?$)`,
            'iu'
        );
        const bonusMatch = bonusRegex.exec(clean);
        if (bonusMatch && bonusMatch[1] && bonusMatch[2]) {
            bonusItem = bonusMatch[2];
            mainText = clean.replace(bonusMatch[1], '').trim();
        }
    }

    // 2. Check for localized replacement sentence
    let replacementItem: string | null = null;
    let replaceTarget: string | undefined = undefined;

    const replaceAlternation = grammar.replaceKeywords.map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+')).join('|');
    const withAlternation = grammar.replaceWithKeywords.map((w) => escapeRegExp(w)).join('|');
    if (replaceAlternation && withAlternation) {
        const replaceRegex = new RegExp(
            `([.!?]?\\s*(?:<ACTOR>|[\\p{L}]+)?\\s*(?:${replaceAlternation})\\b[^.!?]*?(?:(<ITEM_\\d+>)[\\s\\p{L}-]+)?(?:${withAlternation})\\b[^.!?]*?(<ITEM_\\d+>)[^.!?]*\\.?$)`,
            'iu'
        );
        const replaceMatch = replaceRegex.exec(mainText);
        if (replaceMatch && replaceMatch[3]) {
            replaceTarget = replaceMatch[2];
            replacementItem = replaceMatch[3];
            mainText = mainText.replace(replaceMatch[1], '').trim();
        }
    }

    // 3. Split remaining mainText on localized "Or" / "oder" / "ou" branches
    const orBranches = mainText
        .split(grammar.orDelimiterRegex)
        .map((b) => b.trim())
        .filter(Boolean);

    let sequences: string[][] = [];
    for (const branch of orBranches) {
        const items = parseSingleClauseItems(branch, grammar);
        if (items.length > 0) {
            sequences.push(items);
        }
    }

    if (sequences.length === 0) {
        return [];
    }

    // Apply replacement permutations if present
    if (replacementItem) {
        sequences = applyReplacementClause(sequences, replacementItem, replaceTarget);
    }

    // Apply conditional bonus attack if present
    if (bonusItem) {
        const withBonus = sequences.map((seq) => [...seq, bonusItem!]);
        sequences = [...withBonus, ...sequences];
    }

    // Deduplicate sequences while preserving order
    const unique: string[][] = [];
    const seen = new Set<string>();
    for (const seq of sequences) {
        const key = JSON.stringify(seq);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(seq);
        }
    }

    return unique;
}

/**
 * Deterministically parses an abstracted Multiattack template string into a 3D MultiattackSequence (`string[][][]`)
 * using the active localized grammar ruleset resolved via `localize('BAM.grammar.*')`.
 *
 * @param {string} template Abstracted template string containing `<ACTOR>` and `<ITEM_N>` placeholders
 * @returns {MultiattackSequence | null}
 */
export function parseMultiattackTemplate(template: string): MultiattackSequence | null {
    if (!template || !template.trim()) return null;

    const { variables, cleanTemplate } = extractVariableDefinitions(template);

    const grammar = getLocalizedGrammar();

    const thenPattern = grammar.thenDelimiters.map((w) => escapeRegExp(w)).join('|');
    const sentenceBoundaryThenRegex = new RegExp(
        `[.!?]\\s*(?:<ACTOR>|[\\p{L}]+)?\\s*(?:[\\p{L}\\s]+?\\s+)?\\b(?:${thenPattern})\\b`,
        'iu'
    );

    const shouldSplitTopLevelThen = sentenceBoundaryThenRegex.test(cleanTemplate) || !grammar.orDelimiterRegex.test(cleanTemplate);

    const rawSections = shouldSplitTopLevelThen
        ? cleanTemplate.split(grammar.thenDelimiterRegex).map((s) => s.trim()).filter(Boolean)
        : [cleanTemplate.trim()];

    let result: MultiattackSequence = [];
    for (const rawSection of rawSections) {
        const parsedSection = parseMultiattackSection(rawSection, grammar);
        if (parsedSection.length > 0) {
            result.push(parsedSection);
        }
    }

    if (result.length > 0 && Object.keys(variables).length > 0) {
        result = expandVariablesInSequence(result, variables);
    }

    return result.length > 0 ? result : null;
}
