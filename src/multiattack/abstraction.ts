import type { AbstractedMultiattack, MultiattackSequence } from '../types/global.d.js';

/**
 * Generates surface form variations for an item name to match inside natural language descriptions.
 * @param {string} rawName Item name from Actor sheet
 * @returns {string[]} Array of lowercase surface forms sorted longest-first
 */
export function getItemSurfaceForms(rawName: string): string[] {
    const clean = rawName.trim().toLowerCase();
    if (!clean || clean === 'multiattack') return [];

    const forms = new Set<string>();
    forms.add(clean);

    const withoutAttack = clean.replace(/\s+attacks?$/, '').trim();
    if (withoutAttack) {
        forms.add(withoutAttack);
        if (withoutAttack.endsWith('ies')) {
            forms.add(withoutAttack.slice(0, -3) + 'y');
        } else if (withoutAttack.endsWith('es') && withoutAttack.length > 3) {
            forms.add(withoutAttack.slice(0, -2));
            forms.add(withoutAttack.slice(0, -1));
        } else if (withoutAttack.endsWith('s') && withoutAttack.length > 2) {
            forms.add(withoutAttack.slice(0, -1));
        } else {
            forms.add(withoutAttack + 's');
            forms.add(withoutAttack + 'es');
        }
    }

    return Array.from(forms).sort((a, b) => b.length - a.length);
}

/**
 * Escapes special characters in a string for use in a RegExp.
 * @param {string} str Input string
 * @returns {string} Escaped regex string
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Abstracts a D&D Multiattack natural language description by replacing creature subject references
 * with `<ACTOR>` and actor item/weapon names with ordered `<ITEM_0>`, `<ITEM_1>`, etc. placeholders.
 *
 * Numbering `<ITEM_N>` by order of first appearance in the description guarantees that monsters
 * with identical sentence structures (e.g. Brown Bear and Owlbear) collapse into the exact same
 * canonical template regardless of item inventory order.
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

    // 1. Clean HTML and normalize whitespace
    let text = description
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&ndash;/gi, '-')
        .replace(/&mdash;/gi, '-')
        .replace(/\s+/g, ' ')
        .trim();

    // 2. Replace explicit actor name if provided
    if (actorName && actorName.trim().length > 1) {
        const cleanActor = actorName.trim();
        const escapedActor = escapeRegExp(cleanActor);
        text = text.replace(new RegExp(`\\b(?:the\\s+)?${escapedActor}\\b`, 'gi'), '<ACTOR>');

        // Also handle last word of multi-word actor names (e.g., "Adult Red Dragon" -> "the dragon", "Bandit Captain" -> "the captain")
        const words = cleanActor.split(/\s+/);
        if (words.length > 1) {
            const lastWord = words[words.length - 1];
            if (lastWord && lastWord.length > 2) {
                text = text.replace(new RegExp(`\\bthe\\s+${escapeRegExp(lastWord)}\\b`, 'gi'), '<ACTOR>');
            }
        }
    }

    // 3. Replace generic creature subject phrases before action verbs (e.g. "The bear makes", "The owlbear can use", "Or the captain makes")
    text = text.replace(
        /\b(?:the|this)\s+[a-z-]+(?:\s+[a-z-]+)?(?=\s+(?:makes|can\s+use|uses|attacks|casts|has|also\s+makes)\b)/gi,
        '<ACTOR>'
    );

    // Normalize "It then" or "he/she then" after a period to "<ACTOR> then" for uniform sectioning
    text = text.replace(/([.!?]\s+)(?:it|he|she|they)\s+then\b/gi, '$1<ACTOR> then');

    // 4. Identify candidate items on the actor (excluding Multiattack itself)
    const validItems = (actorItems ?? []).filter((item: Item) => {
        const name = item?.name?.trim().toLowerCase();
        return Boolean(name && name !== 'multiattack');
    });

    // Build all candidate surface forms mapped to their canonical Item name
    interface MatchCandidate {
        canonicalName: string;
        form: string;
        regex: RegExp;
    }

    const candidates: MatchCandidate[] = [];
    for (const item of validItems) {
        const canonicalName = item.name.trim();
        const forms = getItemSurfaceForms(canonicalName);
        for (const form of forms) {
            candidates.push({
                canonicalName,
                form,
                regex: new RegExp(`\\b${escapeRegExp(form)}\\b`, 'i')
            });
        }
    }

    // Sort candidates by surface form length descending so multi-word items ("Frightful Presence", "Heavy Crossbow") match before substrings
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
        const globalRegex = new RegExp(`\\b${escapeRegExp(cand.form)}\\b`, 'gi');
        text = text.replace(globalRegex, placeholder);
    }

    // Clean up any accidental double placeholders or trailing "attack(s)" after placeholder when appropriate
    // e.g., if an item was named "Longsword Attack" and replaced "Longsword Attack", ensure we don't have "<ITEM_0> attack" vs "<ITEM_0>" inconsistency
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
 * Supports exact matching, plural/singular variations (`Claw` <-> `Claws`), and stripping `" Attack"`.
 * @param {Actor} actor Concrete Actor document
 * @param {string} selection Selected attack or item name
 * @returns {Item | null}
 */
export function resolveActorItem(actor: Actor, selection: string): Item | null {
    if (!actor?.items || !selection) return null;
    const clean = selection.trim().toLowerCase();
    const items = Array.from(actor.items.values()) as Item[];

    // 1. Exact case-insensitive match
    let found = items.find((i: Item) => i.name.trim().toLowerCase() === clean);
    if (found) return found;

    // 2. Match with added 's' or 'es' (e.g. "Claw" -> "Claws")
    found = items.find((i: Item) => {
        const itemName = i.name.trim().toLowerCase();
        return itemName === clean + 's' || itemName === clean + 'es';
    });
    if (found) return found;

    // 3. Match with trailing 's' stripped (e.g. "Claws" -> "Claw")
    if (clean.endsWith('s')) {
        const singular = clean.slice(0, -1);
        found = items.find((i: Item) => i.name.trim().toLowerCase() === singular);
        if (found) return found;
    }

    // 4. Match without trailing " attack" (e.g. "Morningstar Attack" -> "Morningstar")
    const withoutAttack = clean.replace(/\s+attacks?$/, '').trim();
    if (withoutAttack !== clean) {
        found = items.find((i: Item) => {
            const itemName = i.name.trim().toLowerCase();
            return itemName === withoutAttack || itemName === withoutAttack + 's';
        });
        if (found) return found;
    }

    return null;
}
