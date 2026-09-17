# Deterministic Multiattack Parsing

This document describes how the module converts a plain-text Multiattack description
into a structured 3D attack sequence — entirely without an LLM.

The LLM path ([`llm-client.ts`](../src/multiattack/llm-client.ts)) is an **opt-in fallback**
for homebrew phrasings that the rule-based pipeline cannot parse. Everything described here
is the primary, deterministic path.

---

## Output Shape

The final product is a `MultiattackSequence` — a `string[][][]`:

```
MultiattackSequence
└── section[]          ← sequential "then"-separated steps
    └── optionFlow[][] ← alternative "or"-separated branches per step
        └── token[]    ← individual attack tokens within a branch
```

A token prefixed with `>` (e.g. `>Bite`) means it is a **sequential sub-step** within the
same branch (produced by an intra-clause "then" or an explicit `>` step operator in a
manually-authored template). Tokens without `>` are concurrent choices within the same step.

**Example** — *"The bear makes two Claw attacks, then one Bite attack."*

```json
[
  [ ["Claw", "Claw"] ],
  [ [">Bite"]        ]
]
```

---

## Pipeline Overview

```
Plain-text description
        │
        ▼
┌─────────────────────────────┐
│  Stage 1 · Abstraction      │  abstraction.ts
│  abstractMultiattackDescription()
└─────────────┬───────────────┘
              │  AbstractedMultiattack
              │  { template, itemMap, reverseMap }
              ▼
┌─────────────────────────────┐
│  Stage 2 · Grammar          │  grammar.ts
│  getLocalizedGrammar()      │
└─────────────┬───────────────┘
              │  LocalizedGrammar (compiled regexes + word lists)
              ▼
┌─────────────────────────────┐
│  Stage 2 · Parsing          │  parser.ts
│  parseMultiattackTemplate() │
└─────────────┬───────────────┘
              │  MultiattackSequence (string[][][], placeholders)
              ▼
┌─────────────────────────────┐
│  Stage 3 · Hydration        │  abstraction.ts
│  hydrateMultiattackSequence()
└─────────────┬───────────────┘
              │
              ▼
        Concrete MultiattackSequence (real item names)
```

---

## Stage 1 — Abstraction

**Source:** [`src/multiattack/abstraction.ts`](../src/multiattack/abstraction.ts)
**Entry point:** `abstractMultiattackDescription(description, actorItems, actorName?)`

The goal of this stage is to strip the description of all language- and creature-specific
tokens and replace them with stable, parser-friendly placeholders.

### 1a. HTML normalisation

Raw FoundryVTT descriptions may contain HTML. These are cleaned first:

```
<p>…</p>  →  stripped
&nbsp;    →  space
&amp;     →  &
&ndash;   →  -
\s+       →  single space
```

### 1b. Enricher resolution

FoundryVTT D&D 5e v4+ embeds inline enricher tags in description text.
These are resolved against the actor's item list before any further processing:

| Enricher form | Example |
|---|---|
| `[[lookup @name]]` | Replaced with `<ACTOR>` |
| `[[/item .mmArcaneBurst000]]` | Decoded to item name via ID lookup or camelCase split |
| `@UUID[…]{Label}` | Resolved by explicit label, then by ID |

The camelCase decoder strips known compendium prefixes (`mm`, `phb`, `dmg`, `srd`)
and splits on case boundaries: `mmArcaneBurst000` → `Arcane Burst`.

### 1c. Actor subject substitution

The creature's own name is replaced with the placeholder `<ACTOR>`.
This is done in two passes:

1. **Explicit name match** — the actor's full name and its last word
   (e.g. "Adult Red Dragon" also catches "the Dragon") are replaced via
   escaped regex with an optional localized article prefix.
2. **Subject phrase match** — `actorSubjectRegex` catches any
   `[article] [1–2 word name]` immediately before a localized action verb,
   handling languages where the actor name is not known in advance.

The pronoun-then normalisation pass additionally rewrites transitions such as
`. It then` or `. Er führt danach` into a canonical `<ACTOR> then` form so the
section splitter sees a consistent boundary.

### 1d. Item name substitution

Each actor item (excluding Multiattack itself) generates a set of **surface forms**
via `getItemSurfaceForms()`:

- The canonical name as-is
- Name with localized attack suffixes stripped (e.g. "Claw Attack" → "Claw")
- Common plural/singular variants:

  | Ending | Variants generated |
  |---|---|
  | `-ies` | `-y` |
  | `-es` | base, `-e` |
  | `-en` | `-e`, base (German plurals) |
  | `-s` | base (singular) |
  | other | `+s`, `+es`, `+en`, `+n` |

Forms are sorted **longest-first** before matching to prevent a shorter form (e.g. "Claw")
from consuming part of a longer one (e.g. "Claw Attack").

Items are assigned ordered placeholders `<ITEM_0>`, `<ITEM_1>`, … **in order of first
appearance** in the text. All surface-form occurrences of each item are then globally
replaced with its placeholder.

### Stage 1 output

```ts
interface AbstractedMultiattack {
    template: string;                  // e.g. "<ACTOR> makes two <ITEM_0> and one <ITEM_1>"
    itemMap: Record<string, string>;   // "<ITEM_0>" → "Claw",  "<ITEM_1>" → "Bite"
    reverseMap: Record<string, string>;// "claw" → "<ITEM_0>", "bite" → "<ITEM_1>"
}
```

---

## Stage 2 — Grammar

**Source:** [`src/multiattack/grammar.ts`](../src/multiattack/grammar.ts)
**Entry point:** `getLocalizedGrammar()`

All grammar rules are resolved through Foundry's i18n system (`game.i18n.localize()`)
using `BAM.grammar.*` keys. Adding a translation file is sufficient to support a new
language — no code changes are needed, provided the target language's syntax is compatible
(see [Language Support](#language-support) below).

### Grammar word lists

| Key | EN default | Role |
|---|---|---|
| `multiattackNames` | `Multiattack` | Items to exclude from the item map |
| `numberWords` | `one→1, two→2, …` | Quantity resolution |
| `attackSuffixes` | `attack, attacks` | Stripped when building surface forms |
| `meleeKeywords` | `melee attack, melee attacks` | Generic melee token |
| `rangedKeywords` | `ranged attack, ranged attacks` | Generic ranged token |
| `spellKeywords` | `spell attack, spell attacks` | Generic spell token |
| `anyAttackKeywords` | `any attack, any attacks` | Wildcard token |
| `subjectArticles` | `the, this` | Used in subject detection |
| `subjectPronouns` | `it, he, she, they` | Used in pronoun-then normalisation |
| `actionVerbs` | `makes, uses, casts, …` | Anchor for subject and section regexes |
| `thenDelimiters` | `then` | Sequential section boundary |
| `orDelimiters` | `or` | Alternative branch splitter |
| `canUseKeywords` | `can use, uses` | Ability-use clause detection |
| `replaceKeywords` | `can replace` | Replacement clause detection |
| `replaceWithKeywords` | `with` | Replacement target detection |
| `conditionIfKeywords` | `if, when` | Conditional bonus attack detection |
| `bonusAlsoKeywords` | `can also make, also makes` | Bonus attack detection |

### Compiled regexes

All multi-word keyword lists are sorted longest-first before being joined into alternation
groups — this prevents shorter prefixes from matching before longer multi-word phrases.
Whitespace inside phrases is made flexible (`\s+`) to tolerate formatting differences.

| Regex | Pattern shape | Purpose |
|---|---|---|
| `actorSubjectRegex` | `[article] [1–2 words] (?= verb)` | Replaces creature subjects with `<ACTOR>` |
| `pronounThenRegex` | `[.!?] [pronoun] [verb?] [then]` | Normalises pronoun-then transitions |
| `thenDelimiterRegex` | `[.!?] [actor\|pronoun?] [verb?] [then]` | Splits sequential sections |
| `orDelimiterRegex` | `[.!?] or \| , or \| or [subject\|number+item]` | Splits alternative branches |

---

## Stage 2 — Parsing

**Source:** [`src/multiattack/parser.ts`](../src/multiattack/parser.ts)
**Entry point:** `parseMultiattackTemplate(template)`

This stage converts the abstracted template string into the 3D `MultiattackSequence`.
It is a cascading set of pure functions with no side effects or external calls.

### Variable definitions (manual templates)

Before the main parse, `extractVariableDefinitions()` scans the template for
named variable lines:

```
Activities: (-Flail:Activity1 | -Flail:Activity2)
<ITEM_0> makes two attacks then one bite
```

Variables are stripped out and stored separately, then re-injected into the parsed
sequence via `expandVariablesInSequence()` after all other processing is complete.

### Top-level section split — `parseMultiattackTemplate()`

The template is split on `thenDelimiterRegex` into **sections**, each representing
one sequential step. Each section is passed to `parseMultiattackSection()`.

The split is skipped (the whole template is treated as one section) when the text
contains no sentence-boundary "then" but does contain an "or" branch — this handles
single-step multiattacks that offer a choice.

### Per-section parse — `parseMultiattackSection()`

Each section goes through three sub-passes before the branch split:

**1. Conditional bonus attack detection**

Matches a sentence of the form:
> *". If [condition], [actor] can also make a `<ITEM_N>`."*

The bonus item is stored separately. After branch parsing, two sequence variants
are emitted: one with the bonus appended and one without.

**2. Replacement clause detection**

Matches a sentence of the form:
> *". [Actor] can replace one [attack / `<ITEM_N>`] with `<ITEM_M>`."*

The replacement item and optional replacement target are extracted. After branch
parsing, `applyReplacementClause()` generates permutation variants by substituting
the replacement item into every eligible slot across every existing sequence.
Duplicate sequences are deduplicated via `JSON.stringify` key comparison.

**3. "Or" branch split**

The remaining text is split on `orDelimiterRegex`. Each branch is parsed
independently by `parseSingleClauseItems()` and becomes one `optionFlow`
entry (a `string[]`) in the section's `string[][]`.

### Per-clause parse — `parseSingleClauseItems()`

**Explicit `>` step operators**

If the clause contains ` > ` (space-surrounded), it is split on that delimiter and
each sub-part is treated as a sequential sub-step. Items from parts after the first
are prefixed with `>`.

**Intra-clause "then" detection**

If the clause contains a localized "then" keyword internally (without a sentence
boundary), it is split and treated identically to the `>` operator.

Both paths call `parseAtomicClauseItems()` for each sub-clause.

### Atomic clause parse — `parseAtomicClauseItems()`

Three strategies are tried in order:

**Strategy 1 — Colon breakdown**

If the clause contains `:`, the part after the colon is parsed as a quantified
item list. This handles phrasings like:
> *"makes three attacks: one with its `<ITEM_0>` and two with its `<ITEM_1>`"*

**Strategy 2 — Ability-use phrase**

If the clause matches `can use … <ITEM_N>` without a quantity greater than 1,
a single-token list `[<ITEM_N>]` is returned.

**Strategy 3 — Quantified item list**

`parseQuantifiedItemList()` applies the core extraction regex:

```
\b (NumberWord | \d+) \b
(?:\s+ [\p{L}-]+){0,8}?       ← up to 8 intervening words (lazy)
\s* (<ITEM_\d+> | melee | ranged | spell | any)
```

Each match produces `qty` copies of the normalized token. `parseQuantity()` resolves
number words through `grammar.numberWords` before falling back to `parseInt()`.

Generic attack keywords (`Nahkampfangriff`, `attaque au corps à corps`, etc.) are
normalized to canonical English tokens (`melee attack`, `ranged attack`, etc.) so
the executor handles them uniformly regardless of source language.

If no quantified pairs match, the parser falls back to collecting bare `<ITEM_N>`
tokens when an action verb is present, or returning the raw phrase as a single token
if it looks like a choice group or activity reference.

---

## Stage 3 — Hydration

**Source:** [`src/multiattack/abstraction.ts`](../src/multiattack/abstraction.ts)
**Entry point:** `hydrateMultiattackSequence(templateSequence, itemMap)`

The parsed `string[][][]` still contains `<ITEM_N>` placeholders. This stage walks
the entire 3D structure and replaces each placeholder with its concrete item name
from `itemMap`. The `>` step prefix is preserved through hydration.

After hydration, `enrichSequenceWithDiscoveredSubActivities()` may optionally scan
each token for actor items that have **secondary activities** (e.g. Yeenoghu's Flail
per-turn effects). When found, a choice step `>(ItemName:ActivityName:1 | …)` is
interleaved immediately after the relevant token.

---

## Key Design Properties

### Fully deterministic

Given the same input text, actor item list, and active language, the output is always
identical. There are no probabilities, sampling steps, or mutable state between calls.

### Language-agnostic by design

No English strings are hard-coded in the parsing logic. All keywords are resolved
at runtime from `BAM.grammar.*` localization keys. Adding `lang/es.json` with the
appropriate grammar section supports Spanish without any code change — provided
the target language satisfies the structural assumptions below.

### Permutation-aware

Replacement clauses and conditional bonus attacks are not modelled as single sequences.
The parser generates every valid permutation explicitly, so the executor can present
the full set of legal choices to the player at runtime.

### Deduplication throughout

Every stage that produces multiple sequence variants uses `JSON.stringify`-keyed
`Set` deduplication to prevent the same sequence appearing more than once.

---

## Language Support

The pipeline makes **three structural assumptions** about the source language.
Languages that satisfy all three work with a translation file alone. Languages that
violate any of them require regex architecture changes in `grammar.ts` and `parser.ts`.

| Assumption | Satisfied by | Violated by |
|---|---|---|
| Cardinal number precedes the noun | EN, FR, DE, ES, IT, PT, RU, PL | JA, KO (classifiers fused to digit), AR (dual/plural fused morphology) |
| Subject precedes the verb | SVO / V2 languages | VSO (Arabic, Welsh), SOV (Japanese, Korean, Turkish) |
| Sequential steps separated by a splittable keyword | "then", "danach", "puis", … | SOV verb-chaining (JA て-form), aspectual particles |

**Languages with an existing translation file:** English, German, French.

**Languages compatible but without a translation file:** Spanish, Italian, Portuguese
(BR), Russian, Polish. Slavic languages additionally need attention to noun case
inflection in `getItemSurfaceForms()`, which currently handles only English and German
plural endings.

**Languages structurally incompatible with the current pipeline:** Japanese, Korean,
Arabic, Turkish (verb-final subordinate clauses), and any language without inter-word
spaces (Classical Chinese).
