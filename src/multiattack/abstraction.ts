import { getLocalizedGrammar, escapeRegExp, isLocalizedMultiattackName, type LocalizedGrammar } from './grammar.js';
import type { AbstractedMultiattack, MultiattackSequence } from '../types/global.d.js';

/**
 * Generates surface form variations for an item name to match inside natural language descriptions,
 * respecting localized attack suffixes (e.g., "attack", "angriff", "attaque").
 * @param {string} rawName Item name from Actor sheet
 * @param {LocalizedGrammar} [grammar] Optional pre-resolved localized grammar
 * @returns {string[]} Array of lowercase surface forms sorted longest-first
 */
export function getItemSurfaceForms(rawName: string, grammar: LocalizedGrammar = getLocalizedGrammar()): string[] {
    const clean = rawName.trim().toLowerCase();
    if (!clean || isLocalizedMultiattackName(clean)) return [];

    const forms = new Set<string>();
    forms.add(clean);

    // Build suffix removal pattern from localized attackSuffixes
    const suffixAlternation = grammar.attackSuffixes
        .map((s) => escapeRegExp(s.toLowerCase()))
        .sort((a, b) => b.length - a.length)
        .join('|');
    const suffixRegex = suffixAlternation ? new RegExp(`[\\s-]+(?:${suffixAlternation})$`, 'i') : null;

    const withoutAttack = suffixRegex ? clean.replace(suffixRegex, '').trim() : clean;
    if (withoutAttack) {
        forms.add(withoutAttack);
        if (withoutAttack.endsWith('ies')) {
            forms.add(withoutAttack.slice(0, -3) + 'y');
        } else if (withoutAttack.endsWith('es') && withoutAttack.length > 3) {
            forms.add(withoutAttack.slice(0, -2));
            forms.add(withoutAttack.slice(0, -1));
        } else if (withoutAttack.endsWith('en') && withoutAttack.length > 3) {
            // German plural handling (e.g. "Klauen" -> "Klaue")
            forms.add(withoutAttack.slice(0, -1));
            forms.add(withoutAttack.slice(0, -2));
        } else if (withoutAttack.endsWith('s') && withoutAttack.length > 2) {
            forms.add(withoutAttack.slice(0, -1));
        } else {
            forms.add(withoutAttack + 's');
            forms.add(withoutAttack + 'es');
            forms.add(withoutAttack + 'en');
            forms.add(withoutAttack + 'n');
        }
    }

    return Array.from(forms).sort((a, b) => b.length - a.length);
}

/**
 * Abstracts a Multiattack natural language description in any localized language (`localize('BAM.grammar.*')`)
 * by replacing creature subject references with `<ACTOR>` and actor item/weapon names with ordered
 * `<ITEM_0>`, `<ITEM_1>`, etc. placeholders.
 *
 * @param {string} description Raw or cleaned Multiattack description text
 * @param {Item[]} actorItems Array of Item documents belonging to the actor
 * @param {string} [actorName=''] Optional name of the actor
 * @returns {AbstractedMultiattack}
 */
export function abstractMultiattackDescription(
    description: string,
    actorItems: Item[],
    actorName: string = ''
): AbstractedMultiattack {
    if (!description) {
        return { template: '', itemMap: {}, reverseMap: {} };
    }

    const grammar = getLocalizedGrammar();

    // 1. Clean HTML and normalize whitespace
    let text = description
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&ndash;/gi, '-')
        .replace(/&mdash;/gi, '-')
        .replace(/\s+/g, ' ')
        .trim();

    const articlesAlternation = grammar.subjectArticles
        .map((a) => escapeRegExp(a))
        .sort((a, b) => b.length - a.length)
        .join('|');

    // 2. Replace explicit actor name if provided
    if (actorName && actorName.trim().length > 1) {
        const cleanActor = actorName.trim();
        const escapedActor = escapeRegExp(cleanActor);
        const articlePrefix = articlesAlternation ? `(?:(?:${articlesAlternation})\\s+)?` : '(?:the\\s+)?';
        text = text.replace(new RegExp(`\\b${articlePrefix}${escapedActor}\\b`, 'giu'), '<ACTOR>');

        // Also handle last word of multi-word actor names (e.g., "Adult Red Dragon" -> "the dragon", "Roter Drache" -> "der Drache")
        const words = cleanActor.split(/\s+/);
        if (words.length > 1) {
            const lastWord = words[words.length - 1];
            if (lastWord && lastWord.length > 2) {
                text = text.replace(new RegExp(`\\b(?:${articlesAlternation})\\s+${escapeRegExp(lastWord)}\\b`, 'giu'), '<ACTOR>');
            }
        }
    }

    // 3. Replace localized creature subject phrases before localized action verbs (e.g., "The bear makes", "Der Bär führt", "Le capitaine effectue")
    text = text.replace(grammar.actorSubjectRegex, '<ACTOR>');

    // Normalize localized pronoun + "then" after sentence boundaries to "<ACTOR> <thenDelimiter>"
    const primaryThen = grammar.thenDelimiters[0] ?? 'then';
    text = text.replace(grammar.pronounThenRegex, `$1<ACTOR> ${primaryThen}`);

    // 4. Identify candidate items on the actor (excluding Multiattack / Mehrfachangriff / etc.)
    const validItems = (actorItems ?? []).filter((item: Item) => {
        const name = item?.name?.trim();
        return Boolean(name && !isLocalizedMultiattackName(name));
    });

    interface MatchCandidate {
        canonicalName: string;
        form: string;
        regex: RegExp;
    }

    const candidates: MatchCandidate[] = [];
    for (const item of validItems) {
        const canonicalName = item.name.trim();
        const forms = getItemSurfaceForms(canonicalName, grammar);
        for (const form of forms) {
            candidates.push({
                canonicalName,
                form,
                regex: new RegExp(`\\b${escapeRegExp(form)}\\b`, 'iu')
            });
        }
    }

    candidates.sort((a, b) => b.form.length - a.form.length);

    // Find first appearance index in `text` for each distinct canonical item
    const firstAppearance = new Map<string, number>();
    for (const cand of candidates) {
        const match = cand.regex.exec(text);
        if (match && match.index !== undefined) {
            const existingIdx = firstAppearance.get(cand.canonicalName);
            if (existingIdx === undefined || match.index < existingIdx) {
                firstAppearance.set(cand.canonicalName, match.index);
            }
        }
    }

    // Order distinct matched items by their first appearance position in the text
    const orderedCanonicalNames = Array.from(firstAppearance.entries())
        .sort((a, b) => a[1] - b[1])
        .map((entry) => entry[0]);

    const itemMap: Record<string, string> = {};
    const reverseMap: Record<string, string> = {};
    const canonicalToPlaceholder = new Map<string, string>();

    orderedCanonicalNames.forEach((canonicalName, idx) => {
        const placeholder = `<ITEM_${idx}>`;
        itemMap[placeholder] = canonicalName;
        reverseMap[canonicalName.toLowerCase()] = placeholder;
        canonicalToPlaceholder.set(canonicalName, placeholder);
    });

    // Replace all occurrences of matched items in the text (longest forms first)
    for (const cand of candidates) {
        const placeholder = canonicalToPlaceholder.get(cand.canonicalName);
        if (!placeholder) continue;
        const globalRegex = new RegExp(`\\b${escapeRegExp(cand.form)}\\b`, 'giu');
        text = text.replace(globalRegex, placeholder);
    }

    text = text.replace(/\s+/g, ' ').trim();

    return {
        template: text,
        itemMap,
        reverseMap
    };
}

/**
 * Hydrates an abstracted 3D multiattack sequence containing `<ITEM_N>` placeholders back into
 * concrete item names using the actor's `itemMap`.
 * @param {MultiattackSequence} templateSequence 3D array with `<ITEM_N>` placeholders
 * @param {Record<string, string>} itemMap Mapping from `<ITEM_N>` to concrete item names
 * @returns {MultiattackSequence} Concrete 3D sequence array
 */
export function hydrateMultiattackSequence(
    templateSequence: MultiattackSequence,
    itemMap: Record<string, string>
): MultiattackSequence {
    if (!Array.isArray(templateSequence)) return [];
    return templateSequence.map((section) =>
        (Array.isArray(section) ? section : []).map((optionFlow) =>
            (Array.isArray(optionFlow) ? optionFlow : []).map((token) => {
                const trimmed = String(token ?? '').trim();
                return itemMap[trimmed] ?? trimmed;
            })
        )
    );
}

/**
 * Resolves a concrete Item document on an Actor from an attack selection string.
 * Supports exact matching, plural/singular variations, and stripping localized attack suffixes.
 * @param {Actor} actor Concrete Actor document
 * @param {string} selection Selected attack or item name
 * @returns {Item | null}
 */
export function resolveActorItem(actor: Actor, selection: string): Item | null {
    if (!actor?.items || !selection) return null;
    const clean = selection.trim().toLowerCase();
    const items = Array.from(actor.items.values()) as Item[];
    const grammar = getLocalizedGrammar();

    const suffixAlternation = grammar.attackSuffixes
        .map((s) => escapeRegExp(s.toLowerCase()))
        .sort((a, b) => b.length - a.length)
        .join('|');
    const suffixRegex = suffixAlternation ? new RegExp(`[\\s-]+(?:${suffixAlternation})$`, 'i') : null;
    const stripped = suffixRegex ? clean.replace(suffixRegex, '').trim() : clean;

    // 1. Exact case-insensitive match (raw or suffix-stripped)
    let found = items.find((i: Item) => {
        const nameLower = i.name.trim().toLowerCase();
        return nameLower === clean || (stripped && nameLower === stripped);
    });
    if (found) return found;

    // 2. Match using surface forms generated for each actor item
    for (const item of items) {
        const forms = getItemSurfaceForms(item.name, grammar);
        if (forms.includes(clean) || (stripped && forms.includes(stripped))) {
            return item;
        }
    }

    return null;
}
