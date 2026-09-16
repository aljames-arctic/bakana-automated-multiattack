import type { MultiattackSequence } from '../types/global.d.js';

/**
 * Refined system prompt for LLM Multiattack parsing using abstracted `<ITEM_N>` placeholders.
 */
export const MULTIATTACK_SYSTEM_PROMPT = `You are a deterministic D&D 5e rules parser.
Your task is to convert an abstracted Multiattack description into a strict 3D JSON array representing all valid attack sequences.

The input description uses:
- <ACTOR> for the creature's name.
- <ITEM_0>, <ITEM_1>, <ITEM_2>, etc. for specific weapons, spells, or abilities on the creature's sheet.
- "melee attack" or "ranged attack" for generic attack categories.

### Output Schema Rules
1. Return ONLY a valid 3D JSON array of strings: string[][][]. Do NOT wrap in markdown code blocks (\`\`\`json). Do NOT include any explanation.
2. Outer Array (Sections): Each element corresponds to a sequential step separated by "then" (e.g., "uses <ITEM_0>. <ACTOR> then makes..."). If there is no "then", the outer array has 1 element.
3. Middle Array (Alternative Flows): Each element is a distinct valid attack sequence option for that section (accounting for "or" choices, "can replace one attack with", or conditional extra attacks).
4. Inner Array (Ordered Attack Tokens): An array of attack tokens executed in order.
5. Valid Tokens: ONLY output exact placeholder tokens present in the input (<ITEM_0>, <ITEM_1>, etc.) or "melee attack" / "ranged attack". NEVER output words like "Optional", "Ranged <ITEM_0>", or invented names.
6. Conditional / Optional Attacks: If an attack is conditional ("If <ACTOR> has <ITEM_1> drawn, it can also make a <ITEM_1> attack"), represent it by providing BOTH sequences in the middle array: one with the conditional attack included, and one without it.

### Examples
Input: "<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>."
Output: [[["<ITEM_0>", "<ITEM_1>"]]]

Input: "<ACTOR> can use its <ITEM_0>. <ACTOR> then makes three attacks: one with its <ITEM_1> and two with its <ITEM_2>."
Output: [[["<ITEM_0>"]], [["<ITEM_1>", "<ITEM_2>", "<ITEM_2>"]]]

Input: "<ACTOR> makes three melee attacks: two with its <ITEM_0> and one with its <ITEM_1>. Or <ACTOR> makes two ranged attacks with its <ITEM_1>."
Output: [[["<ITEM_0>", "<ITEM_0>", "<ITEM_1>"], ["<ITEM_1>", "<ITEM_1>"]]]

Input: "<ACTOR> makes two <ITEM_0> attacks. If <ACTOR> has a <ITEM_1> drawn, it can also make a <ITEM_1> attack."
Output: [[["<ITEM_0>", "<ITEM_0>", "<ITEM_1>"], ["<ITEM_0>", "<ITEM_0>"]]]`;

/**
 * Parses and validates an LLM response string into a strongly-typed 3D `MultiattackSequence`.
 * Safely strips any accidental Markdown code fences (` ```json ... ``` `) and validates structure.
 *
 * @param {string} rawResponse Raw text returned by the LLM
 * @returns {MultiattackSequence | null} Validated 3D sequence or null if invalid
 */
export function parseLLMResponse(rawResponse: string): MultiattackSequence | null {
    if (!rawResponse || typeof rawResponse !== 'string') return null;

    // Strip markdown code blocks if present
    const cleaned = rawResponse
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;

        // Validate 3D array structure string[][][]
        for (const section of parsed) {
            if (!Array.isArray(section) || section.length === 0) return null;
            for (const flow of section) {
                if (!Array.isArray(flow)) return null;
                for (const token of flow) {
                    if (typeof token !== 'string' || !token.trim()) return null;
                }
            }
        }

        return parsed as MultiattackSequence;
    } catch (_e) {
        return null;
    }
}
