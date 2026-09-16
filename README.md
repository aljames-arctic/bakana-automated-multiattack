# Bakana's Automated Multiattack

Automates D&D 5e monster and NPC multiattacks in Foundry VTT (v12–v14) with **Weapon & Item Name Abstraction (`<ITEM_N>`)**, a **Central Autorecognition Manager & UI**, **Zero-DIME Chat Card Activation**, and **Native Item Execution**.

---

## Key Features & Architectural Refinements

### 1. Weapon & Item Name Abstraction (`<ITEM_N>` & `<ACTOR>`)
Instead of relying on an LLM to guess which words in a Multiattack description are weapon or feature names, `Bakana's Automated Multiattack` inspects the actor's actual inventory (`actor.items`) and abstracts item names by order of appearance:
- **Brown Bear**: *"The bear makes two attacks: one with its bite and one with its claws."*
  - Items: `Bite` $\rightarrow$ `<ITEM_0>`, `Claws` $\rightarrow$ `<ITEM_1>`
  - Abstracted Template: `<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>.`
- **Owlbear**: *"The owlbear makes two attacks: one with its beak and one with its claws."*
  - Items: `Beak` $\rightarrow$ `<ITEM_0>`, `Claws` $\rightarrow$ `<ITEM_1>`
  - Abstracted Template: `<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>.`

Both creatures collapse into the **exact same canonical template** (`[[["<ITEM_0>", "<ITEM_1>"]]]`), allowing a single pattern to recognize dozens of monsters without redundant LLM calls or per-monster configuration.

### 2. Zero LLM Key Required for 95%+ of Creatures (Deterministic Parser + Central Autorec)
- **Built-in System Defaults & Deterministic Grammar Parser**: Standard D&D 5e SRD and Monster Manual multiattacks (including `"then"` sectioning, `"or"` branching, replacement clauses, conditional bonus attacks, and generic melee/ranged categories) are parsed deterministically with **0 latency and no API key required**.
- **Optional Multi-Provider LLM Fallback**: For complex homebrew phrasings, GMs can optionally enable LLM fallback (supporting **OpenAI**, **Google Gemini**, **Anthropic Claude**, or **Local Ollama/OpenAI-compatible endpoints**). Because the abstracted `<ITEM_N>` template is sent and cached centrally, any future creature using that phrasing will hit the central cache immediately.

### 3. Central Autorecognition Menu (Zero Actor/Item `setFlag` Pollution)
- All recognized templates and custom monster overrides (`Actor::Item`) are stored centrally in module settings (`autorecEntries`) and managed via the **Multiattack Autorecognition Menu** (`AutorecMenuApplication`) and **JSON Import/Export Menu** (`AutorecExchangeMenuApplication`).
- Actors and items are never polluted with `flags.world['llm-multiattack']` documents.

### 4. Zero-DIME Chat Card Activation & Custom Popup Select Menu
- **Automatic Chat Card Trigger**: No DIME macro setup or item on-use macros required. When a Multiattack chat card is posted, the module automatically detects it and initiates the attack sequence exclusively for the user who created the chat card (`adapter.isMessageAuthor`).
- **Interactive Chat Card Button**: Injects a sleek **⚡ Execute Multiattack** button onto Multiattack chat cards for manual or repeat execution.
- **Native `item.use()` Execution & Custom Popup Select Menu**: Rolls each weapon/feature natively via `item.use()` so workflow modules like **Midi-QOL** hook into rolls naturally without brittle direct API dependencies, and presents choices via a built-in glassmorphism **Popup Select Dialog** (removing any dependency on `chrisPremades`).

---

## Development & Verification

```bash
# 1. Static Type Checking (Strict TypeScript + fvtt-types)
npm run typecheck

# 2. Unit Tests (24 test cases covering abstraction, deterministic parsing, central autorec, and chat card execution)
npm test

# 3. Production Bundle (Vite with minify: false for console signature preservation)
npm run build
```
