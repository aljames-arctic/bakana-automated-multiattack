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
2. Outer Array (Sections): Each element corresponds to a sequential step separated by sentence-level "then" (e.g., "uses <ITEM_0>. <ACTOR> then makes..."). If there is no top-level "then", the outer array has 1 element.
3. Middle Array (Alternative Flows): Each element is a distinct valid attack sequence option for that section (accounting for "or" choices, "can replace one attack with", or conditional extra attacks).
4. Inner Array (Attack Tokens in Flow):
   - Unordered / Any-Order tokens: Plain strings (e.g. ["<ITEM_0>", "<ITEM_0>", "<ITEM_1>"]).
   - Intra-Branch Sequential ("then") tokens: Prefix a token with ">" (e.g. ["<ITEM_0>", "<ITEM_0>", "<ITEM_0>", "><ITEM_1>"]) when an attack inside a branch must be executed strictly AFTER preceding attacks in that same branch (e.g. "either three <ITEM_0> attacks then one <ITEM_1> attack, or two <ITEM_2> attacks").
5. Valid Tokens: ONLY output exact placeholder tokens present in the input (<ITEM_0>, <ITEM_1>, etc.) or "melee attack" / "ranged attack" / "spell attack" / "any attack". NEVER output words like "Optional", "Ranged <ITEM_0>", or invented names.
6. Conditional / Optional Attacks: If an attack is conditional ("If <ACTOR> has <ITEM_1> drawn, it can also make a <ITEM_1> attack"), represent it by providing BOTH sequences in the middle array: one with the conditional attack included, and one without it.

### Examples
Input: "<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>."
Output: [[["<ITEM_0>", "<ITEM_1>"]]]

Input: "<ACTOR> can use its <ITEM_0>. <ACTOR> then makes three attacks: one with its <ITEM_1> and two with its <ITEM_2>."
Output: [[["<ITEM_0>"]], [["<ITEM_1>", "<ITEM_2>", "<ITEM_2>"]]]

Input: "<ACTOR> makes either three attacks with their <ITEM_0> then one with their <ITEM_1>, or they make two <ITEM_2> attacks."
Output: [[["<ITEM_0>", "<ITEM_0>", "<ITEM_0>", "><ITEM_1>"], ["<ITEM_2>", "<ITEM_2>"]]]`;

/**
 * System prompt for the interactive LLM sequence repair agent in the Autorecognition Manager.
 */
export const MULTIATTACK_REPAIR_SYSTEM_PROMPT = `You are an expert D&D 5e Multiattack sequence debugger and rules parser.
Your task is to FIX an existing 3D JSON Multiattack sequence array based on:
1. The Multiattack description or pattern text.
2. The current 3D JSON sequence that is not working as intended.
3. The user's explanation of what is wrong or how the sequence should behave.

### 3D Array Schema Rules (string[][][])
1. Return ONLY a valid 3D JSON array of strings: string[][][]. Do NOT wrap in markdown code blocks (\`\`\`json). Do NOT include any commentary or explanation.
2. Level 1 (Outer Array — Sequential Steps): Each element is a sequential step separated by sentence-level "then" transitions (e.g. Step 1: Frightful Presence, Then Step 2: Attacks).
3. Level 2 (Middle Array — Alternative "OR" Branches): Mutually exclusive choices within a step (e.g. "either Option A, or Option B").
4. Level 3 (Inner Array — Attack Tokens in that Branch):
   - Unordered / Any-Order tokens: Plain strings (e.g. ["<ITEM_0>", "<ITEM_0>", "<ITEM_1>"]).
   - Intra-Branch Sequential ("THEN") tokens: Prefix a token with ">" (e.g. ["<ITEM_0>", "<ITEM_0>", "<ITEM_0>", "><ITEM_1>"]) to enforce that it can ONLY be rolled AFTER all preceding tokens in that branch have been completed (e.g. "either three sword attacks then one longbow attack, or two sling attacks").
   - Generic / Pool tokens: "melee attack", "ranged attack", "spell attack", "any attack", or "any:ItemA|ItemB".
   - Optional / Early-Exit Step: Include an empty array [] as one of the Level 2 branches in that step if the step is optional.
5. Token Naming Consistency: If the current JSON uses <ITEM_0>/<ITEM_1> placeholders, output <ITEM_0>/<ITEM_1> placeholders; if it uses concrete weapon names (e.g. "Sword", "Longbow"), output concrete weapon names.`;

/**
 * Constructs the structured user prompt for the LLM repair agent containing the formatting context,
 * multiattack description, current JSON, and user's error description.
 */
export function buildRepairUserPrompt(params: {
    description: string;
    currentJson: string;
    userFeedback: string;
}): string {
    return [
        `Multiattack Description / Pattern:`,
        params.description ? params.description : '(not provided)',
        ``,
        `Current 3D JSON Sequence:`,
        params.currentJson,
        ``,
        `User's Explanation of Error / Desired Behavior:`,
        params.userFeedback,
        ``,
        `Please return ONLY the corrected 3D JSON array (string[][][]):`
    ].join('\n');
}

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
