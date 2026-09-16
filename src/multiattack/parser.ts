import type { MultiattackSequence } from '../types/global.d.js';

const NUMBER_WORDS: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
};

/**
 * Parses a number word or digit string into an integer.
 * @param {string | undefined} token Word or digit string
 * @param {number} [defaultVal=1] Fallback integer value
 * @returns {number}
 */
export function parseQuantity(token: string | undefined, defaultVal: number = 1): number {
    if (!token) return defaultVal;
    const clean = token.trim().toLowerCase();
    if (NUMBER_WORDS[clean] !== undefined) {
        return NUMBER_WORDS[clean];
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
 * Extracts quantified `<ITEM_N>` or generic attack tokens from a single clause.
 * E.g. "one with its <ITEM_0> and two with its <ITEM_1>" -> ["<ITEM_0>", "<ITEM_1>", "<ITEM_1>"]
 * E.g. "two <ITEM_0> attacks" -> ["<ITEM_0>", "<ITEM_0>"]
 * E.g. "three melee attacks" -> ["melee attack", "melee attack", "melee attack"]
 */
function parseSingleClauseItems(clause: string): string[] {
    const clean = clause.trim();
    if (!clean) return [];

    // 1. Check if clause has a colon specifying breakdown (e.g. "makes three attacks: one with its <ITEM_0> and two with its <ITEM_1>")
    const colonIdx = clean.indexOf(':');
    if (colonIdx !== -1) {
        const afterColon = clean.slice(colonIdx + 1).trim();
        const breakdown = parseQuantifiedItemList(afterColon);
        if (breakdown.length > 0) {
            return breakdown;
        }
    }

    // 2. Check for "can use its <ITEM_N>" or "uses its <ITEM_N>" or "uses <ITEM_N>"
    const useMatch = /\b(?:can\s+use|uses)\s+(?:its\s+)?(<ITEM_\d+>)/i.exec(clean);
    if (useMatch && useMatch[1] && !clean.includes('makes')) {
        return [useMatch[1]];
    }

    // 3. Parse quantified item list from the clause directly
    const directList = parseQuantifiedItemList(clean);
    if (directList.length > 0) {
        return directList;
    }

    return [];
}

/**
 * Parses a list of quantified items or generic melee/ranged attacks from a phrase.
 */
function parseQuantifiedItemList(phrase: string): string[] {
    const results: string[] = [];

    // Pattern A: "<QTY> (?:with (?:its )?|attacks? with (?:its )?)?<ITEM_N>" or "<QTY> <ITEM_N> attacks?"
    // Pattern B: "<QTY> (melee|ranged) attacks?"
    // Let's match tokens in order of occurrence in the phrase
    const tokenRegex = /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:melee|ranged)\s+attacks?\s+with\s+(?:its\s+)?|attacks?\s+with\s+(?:its\s+)?|with\s+(?:its\s+)?)?(<ITEM_\d+>|melee\s+attacks?|ranged\s+attacks?)/gi;

    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(phrase)) !== null) {
        const qtyStr = match[1];
        const rawTarget = match[2] ?? '';
        const qty = parseQuantity(qtyStr, 1);

        let normalizedTarget = rawTarget.trim();
        if (/^melee\s+attacks?$/i.test(normalizedTarget)) {
            normalizedTarget = 'melee attack';
        } else if (/^ranged\s+attacks?$/i.test(normalizedTarget)) {
            normalizedTarget = 'ranged attack';
        }

        results.push(...repeatToken(normalizedTarget, qty));
    }

    // If no quantified matches, check for unquantified single item references like "makes a <ITEM_0> attack" or "with its <ITEM_0>"
    if (results.length === 0) {
        const singleItemRegex = /\b(<ITEM_\d+>)/g;
        let singleMatch: RegExpExecArray | null;
        while ((singleMatch = singleItemRegex.exec(phrase)) !== null) {
            if (singleMatch[1]) {
                results.push(singleMatch[1]);
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

        // Generate sequences where one valid attack is replaced by replacementItem
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
 * into an array of alternative attack sequences (`string[][]`).
 * @param {string} sectionText Abstracted section text
 * @returns {string[][]}
 */
export function parseMultiattackSection(sectionText: string): string[][] {
    const clean = sectionText.trim();
    if (!clean) return [];

    // Check for conditional extra attack sentence: "If <ACTOR> has ... can also make a <ITEM_Z> attack"
    let bonusItem: string | null = null;
    let mainText = clean;

    const bonusMatch = /([.!?]\s*If\b[^.!?]*?\bcan\s+also\s+make\s+(?:a|an|one)?\s*(<ITEM_\d+>)[^.!?]*\.?)/i.exec(clean);
    if (bonusMatch && bonusMatch[1] && bonusMatch[2]) {
        bonusItem = bonusMatch[2];
        mainText = clean.replace(bonusMatch[1], '').trim();
    }

    // Check for replacement sentence: "can replace one (?:of its <ITEM_X> )?attacks? with (?:its )?<ITEM_Y>"
    let replacementItem: string | null = null;
    let replaceTarget: string | undefined = undefined;

    const replaceMatch = /([.!?]?\s*(?:<ACTOR>|it|he|she|they)?\s*can\s+replace\s+one\s+(?:of\s+(?:its|these)\s+(?:(<ITEM_\d+>)\s+)?)?attacks?\s+with\s+(?:a\s+|an\s+|its\s+)?(<ITEM_\d+>)[^.!?]*\.?)/i.exec(mainText);
    if (replaceMatch && replaceMatch[3]) {
        replaceTarget = replaceMatch[2];
        replacementItem = replaceMatch[3];
        mainText = mainText.replace(replaceMatch[1], '').trim();
    }

    // Split remaining mainText on "Or" / "or" branches:
    // Handles ". Or <ACTOR> makes...", ", or <ACTOR> makes...", or "makes X or Y"
    const orBranches = mainText
        .split(/(?:[.!?]\s+Or\b|\bOr\s+<ACTOR>\b|\bor\s+(?=(?:a|an|one|two|three|four|five|six|\d+)\s+(?:<ITEM_\d+>|melee|ranged|attacks?)))/i)
        .map((b) => b.trim())
        .filter(Boolean);

    let sequences: string[][] = [];
    for (const branch of orBranches) {
        const items = parseSingleClauseItems(branch);
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

    // Apply conditional bonus attack if present (creates both the extended sequence and base sequence)
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
 * Deterministically parses an abstracted Multiattack template string into a 3D MultiattackSequence (`string[][][]`).
 * Returns `null` if the template cannot be deterministically parsed into at least one valid attack step.
 *
 * @param {string} template Abstracted template string containing `<ACTOR>` and `<ITEM_N>` placeholders
 * @returns {MultiattackSequence | null}
 */
export function parseMultiattackTemplate(template: string): MultiattackSequence | null {
    if (!template || !template.trim()) return null;

    // Split template into sections by "then" transitions:
    // e.g., "<ACTOR> can use its <ITEM_0>. <ACTOR> then makes..." or "... then ..."
    const rawSections = template
        .split(/(?:[.!?]\s*(?:<ACTOR>|it|he|she|they)\s+then\b|\bthen\s+(?=(?:makes|can\s+use|uses)\b))/i)
        .map((s) => s.trim())
        .filter(Boolean);

    const result: MultiattackSequence = [];
    for (const rawSection of rawSections) {
        const parsedSection = parseMultiattackSection(rawSection);
        if (parsedSection.length > 0) {
            result.push(parsedSection);
        }
    }

    return result.length > 0 ? result : null;
}
