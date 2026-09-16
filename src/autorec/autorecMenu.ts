import { autorecManager } from './autorecManager.js';
import { adapter } from '../adapter/index.js';
import { abstractMultiattackDescription } from '../multiattack/abstraction.js';
import { parseMultiattackTemplate } from '../multiattack/parser.js';
import { stripOrderPrefix } from '../multiattack/executor.js';
import { localize } from '../lib/utils.js';
import { notify } from '../lib/logger.js';
import type { MultiattackSequence } from '../types/global.d.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BaseApp = (foundry as any)?.applications?.api?.ApplicationV2 ?? class {};

export interface GroupedAttackPill {
    token: string;
    count: number;
    strictOrder: boolean;
}

const STANDARD_TOKEN_CHOICES: Array<{ value: string; label: string }> = [
    { value: '<ITEM_0>', label: '1st Mentioned Item (<ITEM_0>)' },
    { value: '<ITEM_1>', label: '2nd Mentioned Item (<ITEM_1>)' },
    { value: '<ITEM_2>', label: '3rd Mentioned Item (<ITEM_2>)' },
    { value: '<ITEM_3>', label: '4th Mentioned Item (<ITEM_3>)' },
    { value: 'melee attack', label: 'Any Melee Attack' },
    { value: 'ranged attack', label: 'Any Ranged Attack' },
    { value: 'spell attack', label: 'Any Spell Attack' },
    { value: 'any attack', label: 'Any Attack (Pool)' }
];

/**
 * Formats an attack token string into a human-friendly label for UI display.
 */
export function formatTokenHumanLabel(rawToken: string): string {
    const clean = stripOrderPrefix(rawToken);
    const lower = clean.toLowerCase();

    const itemMatch = /^<item_(\d+)>$/i.exec(clean);
    if (itemMatch && itemMatch[1]) {
        const idx = parseInt(itemMatch[1], 10);
        const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
        const ord = ordinals[idx] ?? `${idx + 1}th`;
        return `${ord} Item (${clean.toUpperCase()})`;
    }
    if (lower === 'melee attack') return 'Any Melee Attack';
    if (lower === 'ranged attack') return 'Any Ranged Attack';
    if (lower === 'spell attack') return 'Any Spell Attack';
    if (lower === 'any attack') return 'Any Attack';
    if (lower.startsWith('any:')) {
        return `Any of [${clean.slice(4).split('|').join(', ')}]`;
    }
    return clean;
}

/**
 * Groups consecutive identical tokens in a flow array into compact `{ token, count, strictOrder }` pills.
 */
export function groupFlowTokens(flow: string[]): GroupedAttackPill[] {
    const groups: GroupedAttackPill[] = [];
    for (const raw of flow) {
        const strictOrder = raw.trim().startsWith('>');
        const clean = stripOrderPrefix(raw);
        if (!clean) continue;
        const prev = groups[groups.length - 1];
        if (prev && prev.token.toLowerCase() === clean.toLowerCase() && prev.strictOrder === strictOrder) {
            prev.count++;
        } else {
            groups.push({ token: clean, count: 1, strictOrder });
        }
    }
    return groups;
}

/**
 * Expands grouped attack pills back into a flat `string[]` flow array.
 */
export function expandGroupedTokens(groups: GroupedAttackPill[]): string[] {
    const out: string[] = [];
    for (const g of groups) {
        const prefix = g.strictOrder ? '>' : '';
        for (let i = 0; i < Math.max(1, g.count); i++) {
            out.push(`${prefix}${g.token}`);
        }
    }
    return out;
}

/**
 * Generates a human-readable plain-English HTML summary of a 3D MultiattackSequence.
 */
export function summarizeSequenceInPlainEnglish(sequence: MultiattackSequence): string {
    if (!Array.isArray(sequence) || sequence.length === 0) {
        return 'No attack steps configured.';
    }

    const stepSummaries = sequence.map((section, stepIdx) => {
        const stepTitle = stepIdx === 0 ? `<b>Step 1:</b>` : `<b>Then Step ${stepIdx + 1}:</b>`;
        const nonEmptyFlows = (Array.isArray(section) ? section : []).filter((f) => f.length > 0);
        const hasOptionalExit = (Array.isArray(section) ? section : []).some((f) => f.length === 0);

        if (nonEmptyFlows.length === 0) {
            return `${stepTitle} <i>Empty step</i>`;
        }

        const branchStrings = nonEmptyFlows.map((flow) => {
            const groups = groupFlowTokens(flow);
            const hasStrict = groups.some((g) => g.strictOrder);
            const itemsText = groups
                .map((g) => `<b>${g.count}&times; ${formatTokenHumanLabel(g.token)}</b>${g.strictOrder ? ' <span style="color:#fbbf24;">(strict order)</span>' : ''}`)
                .join(hasStrict ? ' &rarr; then ' : ' + ');
            return itemsText;
        });

        const joinedBranches = branchStrings.join(' <span style="color:#818cf8; font-weight:700;">&mdash; OR &mdash;</span> ');
        const optBadge = hasOptionalExit
            ? ' <span style="font-size:0.75rem; color:#38bdf8; background:rgba(56,189,248,0.15); padding:1px 6px; border-radius:4px;">Optional / Can Finish Early</span>'
            : '';

        return `<div>${stepTitle} Roll ${joinedBranches}${optBadge}</div>`;
    });

    return stepSummaries.join('');
}

export interface DroppedActorInfo {
    actorName: string;
    actorImg: string;
    itemName: string;
    rawDescription: string;
    templateText: string;
    overrideKey: string;
    itemMap: Record<string, string>;
    templateSequence: MultiattackSequence;
    concreteSequence: MultiattackSequence;
    mode: 'template' | 'override';
}

/**
 * ApplicationV2 Menu for inspecting, editing, testing, and managing central Multiattack Autorecognition entries
 * with a human-readable Visual Multiattack Flow Builder and Drag-and-Drop Monster Auto-Fill.
 */
export class AutorecMenuApplication extends BaseApp {
    private _selectedId: string | null = null;
    private _searchFilter: string = '';
    private _workingSequence: MultiattackSequence | null = null;
    private _lastSelectedIdForWorking: string | null = null;
    private _droppedActor: DroppedActorInfo | null = null;
    private _pendingName: string | null = null;
    private _pendingPattern: string | null = null;
    private _pendingType: 'template' | 'override' | null = null;

    static DEFAULT_OPTIONS = {
        id: 'bam-autorec-menu',
        tag: 'div',
        window: {
            title: 'BAM.autorecMenu.title',
            icon: 'fa-solid fa-swords',
            resizable: true
        },
        position: {
            width: 860,
            height: 660
        },
        classes: ['bam-autorec-app']
    };

    /**
     * Reads a dropped Actor document, extracts its Multiattack item & weapons, resolves 2024 enrichers,
     * builds both abstract template and concrete sequences, and populates the editor.
     */
    async handleActorDrop(actor: Actor, mode: 'template' | 'override' = 'template'): Promise<boolean> {
        if (!actor) return false;

        const items = adapter.getActorItems(actor);
        const maItem = items.find((i: Item) => adapter.isMultiattackItem(i));
        if (!maItem) {
            notify.warn(`No Multiattack feature found on actor "${actor.name}".`);
            return false;
        }

        const rawDescription = adapter.getItemDescription(maItem);
        const { template, itemMap } = abstractMultiattackDescription(rawDescription, items, actor.name);
        const parsedTemplateSeq = parseMultiattackTemplate(template);
        const templateSequence: MultiattackSequence = parsedTemplateSeq ?? [[['<ITEM_0>']]];

        const concreteSequence: MultiattackSequence = templateSequence.map((section) =>
            section.map((flow) =>
                flow.map((token) => {
                    const strict = token.trim().startsWith('>');
                    const clean = stripOrderPrefix(token);
                    const concreteName = itemMap[clean.toUpperCase()] ?? clean;
                    return strict ? `>${concreteName}` : concreteName;
                })
            )
        );

        // Ensure an entry is selected so the inspector is active
        if (!this._selectedId) {
            const entries = autorecManager.getAllEntries();
            if (entries.length > 0 && entries[0]) {
                this._selectedId = entries[0].id;
            } else {
                const created = await autorecManager.registerEntry({
                    id: '',
                    name: `${actor.name} Multiattack`,
                    type: mode,
                    pattern: mode === 'override' ? `${actor.name}::${maItem.name}` : template,
                    sequence: mode === 'override' ? concreteSequence : templateSequence,
                    enabled: true
                });
                this._selectedId = created.id;
            }
        }

        this._droppedActor = {
            actorName: actor.name ?? 'Monster',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            actorImg: (actor as any).img ?? 'icons/svg/mystery-man.svg',
            itemName: maItem.name ?? 'Multiattack',
            rawDescription,
            templateText: template,
            overrideKey: `${actor.name}::${maItem.name}`,
            itemMap,
            templateSequence,
            concreteSequence,
            mode
        };

        this._applyDroppedActorMode(mode);
        notify.info(`Loaded Multiattack from "${actor.name}"!`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).render?.();
        return true;
    }

    private _applyDroppedActorMode(mode: 'template' | 'override'): void {
        if (!this._droppedActor) return;
        this._droppedActor.mode = mode;
        if (mode === 'template') {
            this._pendingName = `${this._droppedActor.actorName} Pattern`;
            this._pendingPattern = this._droppedActor.templateText;
            this._pendingType = 'template';
            this._workingSequence = JSON.parse(JSON.stringify(this._droppedActor.templateSequence));
        } else {
            this._pendingName = `${this._droppedActor.actorName} Override`;
            this._pendingPattern = this._droppedActor.overrideKey;
            this._pendingType = 'override';
            this._workingSequence = JSON.parse(JSON.stringify(this._droppedActor.concreteSequence));
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async _renderHTML(_context: any, _options: any): Promise<HTMLElement> {
        const entries = autorecManager.getAllEntries().filter((e) => {
            if (!this._searchFilter) return true;
            const q = this._searchFilter.toLowerCase();
            return e.name.toLowerCase().includes(q) || e.pattern.toLowerCase().includes(q);
        });

        const selected = entries.find((e) => e.id === this._selectedId) ?? entries[0] ?? null;
        if (selected) {
            this._selectedId = selected.id;
            if (this._lastSelectedIdForWorking !== selected.id && !this._droppedActor) {
                this._workingSequence = JSON.parse(JSON.stringify(selected.sequence));
                this._lastSelectedIdForWorking = selected.id;
                this._pendingName = null;
                this._pendingPattern = null;
                this._pendingType = null;
            } else if (!this._workingSequence) {
                this._workingSequence = JSON.parse(JSON.stringify(selected.sequence));
                this._lastSelectedIdForWorking = selected.id;
            }
        } else {
            this._workingSequence = null;
            this._lastSelectedIdForWorking = null;
        }

        const container = document.createElement('div');
        container.className = 'bam-autorec-container';

        const sidebarItemsHtml = entries.map((e) => `
            <div class="bam-sidebar-item ${e.id === selected?.id ? 'active' : ''}" data-entry-id="${e.id}">
                <span>${e.name}</span>
                <span style="font-size: 0.7rem; opacity: 0.7;">${e.type === 'override' ? 'Override' : 'Template'}</span>
            </div>
        `).join('');

        const seq = this._workingSequence ?? [[['<ITEM_0>']]];
        const summaryHtml = summarizeSequenceInPlainEnglish(seq);

        const activeChoices = STANDARD_TOKEN_CHOICES.map((c) => {
            const mappedWeapon = this._droppedActor?.itemMap[c.value.toUpperCase()];
            return {
                value: c.value,
                label: mappedWeapon ? `${c.label} — ${mappedWeapon}` : c.label
            };
        });

        const stepsBuilderHtml = seq.map((section, sectionIdx) => {
            const nonEmptyFlows = (Array.isArray(section) ? section : []).filter((f) => f.length > 0);
            const hasOptionalExit = (Array.isArray(section) ? section : []).some((f) => f.length === 0);
            const displayFlows = nonEmptyFlows.length > 0 ? nonEmptyFlows : [['<ITEM_0>']];

            const branchesHtml = displayFlows.map((flow, flowIdx) => {
                const groups = groupFlowTokens(flow);
                const pillsHtml = groups.map((group, groupIdx) => {
                    const isStandard = activeChoices.some(
                        (c) => c.value.toLowerCase() === group.token.toLowerCase()
                    );
                    const optionsHtml = activeChoices.map(
                        (c) => `<option value="${c.value}" ${c.value.toLowerCase() === group.token.toLowerCase() ? 'selected' : ''}>${c.label}</option>`
                    ).join('') + `<option value="__CUSTOM__" ${!isStandard ? 'selected' : ''}>Custom Weapon / Pool...</option>`;

                    const customInputHtml = !isStandard
                        ? `<input type="text" class="bam-pill-custom-input" data-sec="${sectionIdx}" data-flow="${flowIdx}" data-grp="${groupIdx}" value="${group.token}" placeholder="Weapon or any:A|B" style="width: 120px; padding: 1px 5px; background: #11141d; border: 1px solid #6366f1; color: #fff; border-radius: 3px; font-size: 0.78rem;" />`
                        : '';

                    return `
                        <div class="bam-attack-pill">
                            <div class="bam-pill-stepper">
                                <button type="button" class="bam-pill-btn bam-pill-dec" data-sec="${sectionIdx}" data-flow="${flowIdx}" data-grp="${groupIdx}" title="Decrease Count">&minus;</button>
                                <span>${group.count}&times;</span>
                                <button type="button" class="bam-pill-btn bam-pill-inc" data-sec="${sectionIdx}" data-flow="${flowIdx}" data-grp="${groupIdx}" title="Increase Count">+</button>
                            </div>
                            <select class="bam-pill-select" data-sec="${sectionIdx}" data-flow="${flowIdx}" data-grp="${groupIdx}">
                                ${optionsHtml}
                            </select>
                            ${customInputHtml}
                            <button type="button" class="bam-pill-btn bam-pill-order" data-sec="${sectionIdx}" data-flow="${flowIdx}" data-grp="${groupIdx}" title="Toggle Strict Order vs Any Order" style="color: ${group.strictOrder ? '#fbbf24' : '#94a3b8'};">
                                <i class="fas ${group.strictOrder ? 'fa-lock' : 'fa-random'}"></i>
                            </button>
                            <button type="button" class="bam-pill-btn bam-pill-del" data-sec="${sectionIdx}" data-flow="${flowIdx}" data-grp="${groupIdx}" title="Remove Attack" style="color: #f87171;">
                                &times;
                            </button>
                        </div>
                    `;
                }).join('<span style="color:#64748b; font-weight:700;">+</span>');

                const orDivider = flowIdx > 0
                    ? `<div class="bam-or-divider">&mdash; OR (Alternative Combo) &mdash;</div>`
                    : '';

                return `
                    ${orDivider}
                    <div class="bam-branch-row">
                        ${pillsHtml}
                        <button type="button" class="bam-option-btn bam-add-pill-btn" data-sec="${sectionIdx}" data-flow="${flowIdx}" style="width: auto; padding: 3px 8px; font-size: 0.75rem;">
                            <i class="fas fa-plus"></i> Attack
                        </button>
                        ${displayFlows.length > 1 ? `
                            <button type="button" class="bam-pill-btn bam-del-branch-btn" data-sec="${sectionIdx}" data-flow="${flowIdx}" title="Remove this OR branch" style="margin-left: auto; color: #f87171;">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        ` : ''}
                    </div>
                `;
            }).join('');

            return `
                <div class="bam-step-card">
                    <div class="bam-step-header">
                        <div class="bam-step-badge">
                            <i class="fas fa-layer-group"></i>
                            <span>${sectionIdx === 0 ? 'Step 1 (Initial Attacks)' : `Then Step ${sectionIdx + 1} (After Step ${sectionIdx})`}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <label style="font-size: 0.76rem; color: #cbd5e1; display: flex; align-items: center; gap: 5px; cursor: pointer;">
                                <input type="checkbox" class="bam-step-optional-cb" data-sec="${sectionIdx}" ${hasOptionalExit ? 'checked' : ''} />
                                Optional / Can Finish Early
                            </label>
                            ${seq.length > 1 ? `
                                <button type="button" class="bam-pill-btn bam-del-step-btn" data-sec="${sectionIdx}" title="Delete Step" style="color: #f87171;">
                                    <i class="fas fa-trash"></i> Remove Step
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    ${branchesHtml}
                    <div>
                        <button type="button" class="bam-option-btn bam-add-branch-btn" data-sec="${sectionIdx}" style="width: auto; padding: 4px 10px; font-size: 0.76rem;">
                            <i class="fas fa-code-branch"></i> + Add "OR" Alternative Branch
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const dropZoneHtml = this._droppedActor ? `
            <div class="bam-dropped-actor-card" id="bam-actor-dropzone">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <img src="${this._droppedActor.actorImg}" alt="${this._droppedActor.actorName}" style="width: 38px; height: 38px; border-radius: 6px; object-fit: cover; border: 1px solid #818cf8;" />
                        <div>
                            <div style="font-weight: 700; color: #fff; font-size: 0.88rem;">
                                ${this._droppedActor.actorName} <span style="font-weight: 400; color: #94a3b8; font-size: 0.76rem;">(${this._droppedActor.itemName})</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #cbd5e1; font-style: italic;">
                                "${this._droppedActor.rawDescription}"
                            </div>
                        </div>
                    </div>
                    <button type="button" id="bam-clear-dropped-btn" class="bam-pill-btn" title="Clear dropped monster" style="font-size: 1rem; color: #94a3b8;">&times;</button>
                </div>
                <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; border-top: 1px solid rgba(99, 102, 241, 0.25);">
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <span style="font-size: 0.74rem; color: #94a3b8;">Detected Weapons:</span>
                        ${Object.entries(this._droppedActor.itemMap).map(([k, v]) => `
                            <span class="bam-weapon-mapping-pill"><b style="color:#a5b4fc;">${k}</b> &rarr; ${v}</span>
                        `).join('')}
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" id="bam-drop-mode-template" class="bam-option-btn" style="width: auto; padding: 3px 10px; font-size: 0.74rem; ${this._droppedActor.mode === 'template' ? 'border-color: #818cf8; background: rgba(99, 102, 241, 0.35); font-weight: 700;' : ''}">
                            <i class="fas fa-shapes"></i> Reusable Template (&lt;ITEM_N&gt;)
                        </button>
                        <button type="button" id="bam-drop-mode-override" class="bam-option-btn" style="width: auto; padding: 3px 10px; font-size: 0.74rem; ${this._droppedActor.mode === 'override' ? 'border-color: #818cf8; background: rgba(99, 102, 241, 0.35); font-weight: 700;' : ''}">
                            <i class="fas fa-user-tag"></i> Specific Monster Override
                        </button>
                    </div>
                </div>
            </div>
        ` : `
            <div class="bam-actor-dropzone" id="bam-actor-dropzone">
                <i class="fas fa-dragon" style="font-size: 1.45rem; color: #818cf8;"></i>
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <div style="font-weight: 600; color: #e2e8f0; font-size: 0.84rem;">
                        Drag &amp; Drop Any Monster Actor Here to Auto-Fill
                    </div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">
                        Drop an Actor from the Sidebar or Compendium to automatically extract Multiattack text, weapons, and 2024 enrichers
                    </div>
                </div>
            </div>
        `;

        const displayName = this._pendingName ?? selected?.name ?? '';
        const displayPattern = this._pendingPattern ?? selected?.pattern ?? '';

        const inspectorHtml = selected ? `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <!-- Drag & Drop Monster Auto-Fill Zone -->
                ${dropZoneHtml}

                <!-- Plain English Summary Banner -->
                <div class="bam-summary-banner">
                    <div class="bam-summary-title">
                        <i class="fas fa-magic"></i> Plain-English Attack Summary
                    </div>
                    <div class="bam-summary-body">
                        ${summaryHtml}
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 0.78rem; color: #94a3b8;">Entry Name</label>
                        <input type="text" id="bam-edit-name" value="${displayName}" style="width: 100%; padding: 6px 8px; background: #1e2436; border: 1px solid #4f46e5; color: #fff; border-radius: 4px;" />
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <label style="font-size: 0.78rem; color: #94a3b8;">Pattern / Key (Abstracted sentence or Actor::Item override)</label>
                        <input type="text" id="bam-edit-pattern" value="${displayPattern}" style="width: 100%; padding: 6px 8px; background: #1e2436; border: 1px solid #4f46e5; color: #fff; border-radius: 4px; font-family: monospace;" />
                    </div>
                </div>

                <!-- Visual Multiattack Flow Builder -->
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <label style="font-size: 0.8rem; font-weight: 600; color: #cbd5e1;">
                            Visual Attack Sequence Builder
                        </label>
                        <button type="button" id="bam-add-step-btn" class="bam-option-btn" style="width: auto; padding: 3px 10px; font-size: 0.76rem;">
                            <i class="fas fa-plus"></i> + Add "Then" Step
                        </button>
                    </div>
                    ${stepsBuilderHtml}
                </div>

                <!-- Collapsible Raw JSON for power users -->
                <details style="margin-top: 4px;">
                    <summary style="cursor: pointer; font-size: 0.76rem; color: #64748b;">
                        Advanced: Raw 3D JSON Data
                    </summary>
                    <textarea id="bam-edit-sequence" rows="4" style="width: 100%; margin-top: 6px; padding: 6px; background: #11141d; border: 1px solid #334155; color: #94a3b8; border-radius: 4px; font-family: monospace; font-size: 0.78rem;">${JSON.stringify(seq, null, 2)}</textarea>
                </details>

                <div style="display: flex; gap: 10px; margin-top: 6px;">
                    <button type="button" id="bam-save-btn" class="bam-chat-card-btn" style="flex: 1;">
                        <i class="fas fa-save"></i> ${localize('BAM.autorecMenu.saveBtn', 'Save Changes')}
                    </button>
                    <button type="button" id="bam-delete-btn" class="bam-option-btn bam-option-finish" style="width: auto; padding: 6px 14px;">
                        <i class="fas fa-trash"></i> ${localize('BAM.autorecMenu.deleteBtn', 'Delete')}
                    </button>
                </div>
            </div>
        ` : `<div style="color: #94a3b8;">No entries found. Drag &amp; drop any Monster Actor here to create one.</div>`;

        container.innerHTML = `
            <div class="bam-autorec-topbar">
                <input type="text" class="bam-search-input" id="bam-search-input" placeholder="${localize('BAM.autorecMenu.searchPlaceholder', 'Filter templates or monsters...')}" value="${this._searchFilter}" />
                <button type="button" id="bam-add-template-btn" class="bam-option-btn" style="width: auto; padding: 5px 12px;">
                    <i class="fas fa-plus"></i> ${localize('BAM.autorecMenu.addTemplateBtn', 'Add Template')}
                </button>
                <button type="button" id="bam-reset-defaults-btn" class="bam-option-btn bam-option-finish" style="width: auto; padding: 5px 12px;">
                    <i class="fas fa-rotate-left"></i> ${localize('BAM.autorecMenu.resetDefaultsBtn', 'Reset Defaults')}
                </button>
            </div>
            <div class="bam-autorec-body">
                <div class="bam-autorec-sidebar">
                    ${sidebarItemsHtml}
                </div>
                <div class="bam-autorec-inspector">
                    ${inspectorHtml}
                </div>
            </div>
        `;

        this._attachListeners(container);
        return container;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _replaceHTML(result: HTMLElement, content: HTMLElement, _options: any): void {
        const wasSearchFocused = document.activeElement?.id === 'bam-search-input';
        const selectionStart = (document.activeElement as HTMLInputElement | null)?.selectionStart ?? null;
        const selectionEnd = (document.activeElement as HTMLInputElement | null)?.selectionEnd ?? null;

        content.replaceChildren(result);

        if (wasSearchFocused) {
            const newSearch = content.querySelector('#bam-search-input') as HTMLInputElement | null;
            if (newSearch) {
                newSearch.focus();
                if (selectionStart !== null && selectionEnd !== null) {
                    newSearch.setSelectionRange(selectionStart, selectionEnd);
                }
            }
        }
    }

    private _mutateFlowGroups(
        secIdx: number,
        flowIdx: number,
        mutator: (groups: GroupedAttackPill[]) => GroupedAttackPill[]
    ): void {
        if (!this._workingSequence) return;
        const section = this._workingSequence[secIdx];
        if (!section) return;
        const hasOptionalExit = section.some((f) => f.length === 0);
        const nonEmptyFlows = section.filter((f) => f.length > 0);
        const targetFlow = nonEmptyFlows[flowIdx] ?? ['<ITEM_0>'];
        const updatedGroups = mutator(groupFlowTokens(targetFlow));
        const expanded = expandGroupedTokens(updatedGroups);
        nonEmptyFlows[flowIdx] = expanded.length > 0 ? expanded : ['<ITEM_0>'];
        this._workingSequence[secIdx] = hasOptionalExit ? [...nonEmptyFlows, []] : nonEmptyFlows;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).render?.();
    }

    private _attachListeners(root: HTMLElement): void {
        const searchInput = root.querySelector('#bam-search-input') as HTMLInputElement | null;
        searchInput?.addEventListener('input', (ev) => {
            this._searchFilter = (ev.target as HTMLInputElement).value;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        root.querySelectorAll('.bam-sidebar-item').forEach((el) => {
            el.addEventListener('click', () => {
                this._selectedId = el.getAttribute('data-entry-id');
                this._workingSequence = null;
                this._droppedActor = null;
                this._pendingName = null;
                this._pendingPattern = null;
                this._pendingType = null;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            });
        });

        // Drag & Drop handlers on the dropzone and inspector panel
        const dropTargets = [
            root.querySelector('#bam-actor-dropzone'),
            root.querySelector('.bam-autorec-inspector')
        ].filter(Boolean) as HTMLElement[];

        const dropZoneEl = root.querySelector('#bam-actor-dropzone') as HTMLElement | null;

        dropTargets.forEach((target) => {
            target.addEventListener('dragover', (ev: DragEvent) => {
                ev.preventDefault();
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'copy';
                }
                dropZoneEl?.classList.add('dragover');
            });

            target.addEventListener('dragleave', () => {
                dropZoneEl?.classList.remove('dragover');
            });

            target.addEventListener('drop', async (ev: DragEvent) => {
                ev.preventDefault();
                ev.stopPropagation();
                dropZoneEl?.classList.remove('dragover');

                const rawData = ev.dataTransfer?.getData('text/plain');
                if (!rawData) return;

                try {
                    const data = JSON.parse(rawData) as Record<string, unknown>;
                    const actor = await adapter.resolveActorFromDropData(data);
                    if (!actor) {
                        notify.warn('Could not resolve an Actor from the dropped item.');
                        return;
                    }
                    await this.handleActorDrop(actor, 'template');
                } catch (_err) {
                    notify.warn('Invalid drag-and-drop payload.');
                }
            });
        });

        // Dropped actor mode switch buttons
        root.querySelector('#bam-drop-mode-template')?.addEventListener('click', () => {
            this._applyDroppedActorMode('template');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        root.querySelector('#bam-drop-mode-override')?.addEventListener('click', () => {
            this._applyDroppedActorMode('override');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        root.querySelector('#bam-clear-dropped-btn')?.addEventListener('click', () => {
            this._droppedActor = null;
            this._pendingName = null;
            this._pendingPattern = null;
            this._pendingType = null;
            this._workingSequence = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        // Decrement pill count
        root.querySelectorAll('.bam-pill-dec').forEach((btn) => {
            btn.addEventListener('click', () => {
                const sec = Number(btn.getAttribute('data-sec'));
                const flow = Number(btn.getAttribute('data-flow'));
                const grp = Number(btn.getAttribute('data-grp'));
                this._mutateFlowGroups(sec, flow, (groups) => {
                    const target = groups[grp];
                    if (!target) return groups;
                    if (target.count > 1) {
                        target.count--;
                        return groups;
                    }
                    return groups.filter((_, i) => i !== grp);
                });
            });
        });

        // Increment pill count
        root.querySelectorAll('.bam-pill-inc').forEach((btn) => {
            btn.addEventListener('click', () => {
                const sec = Number(btn.getAttribute('data-sec'));
                const flow = Number(btn.getAttribute('data-flow'));
                const grp = Number(btn.getAttribute('data-grp'));
                this._mutateFlowGroups(sec, flow, (groups) => {
                    if (groups[grp]) groups[grp]!.count++;
                    return groups;
                });
            });
        });

        // Select token change
        root.querySelectorAll('.bam-pill-select').forEach((sel) => {
            sel.addEventListener('change', (ev) => {
                const val = (ev.target as HTMLSelectElement).value;
                const sec = Number(sel.getAttribute('data-sec'));
                const flow = Number(sel.getAttribute('data-flow'));
                const grp = Number(sel.getAttribute('data-grp'));
                this._mutateFlowGroups(sec, flow, (groups) => {
                    if (groups[grp]) {
                        groups[grp]!.token = val === '__CUSTOM__' ? 'Bite' : val;
                    }
                    return groups;
                });
            });
        });

        // Custom input change
        root.querySelectorAll('.bam-pill-custom-input').forEach((inp) => {
            inp.addEventListener('change', (ev) => {
                const val = (ev.target as HTMLInputElement).value.trim();
                const sec = Number(inp.getAttribute('data-sec'));
                const flow = Number(inp.getAttribute('data-flow'));
                const grp = Number(inp.getAttribute('data-grp'));
                if (!val) return;
                this._mutateFlowGroups(sec, flow, (groups) => {
                    if (groups[grp]) groups[grp]!.token = val;
                    return groups;
                });
            });
        });

        // Toggle strict order (`>`)
        root.querySelectorAll('.bam-pill-order').forEach((btn) => {
            btn.addEventListener('click', () => {
                const sec = Number(btn.getAttribute('data-sec'));
                const flow = Number(btn.getAttribute('data-flow'));
                const grp = Number(btn.getAttribute('data-grp'));
                this._mutateFlowGroups(sec, flow, (groups) => {
                    if (groups[grp]) groups[grp]!.strictOrder = !groups[grp]!.strictOrder;
                    return groups;
                });
            });
        });

        // Delete pill
        root.querySelectorAll('.bam-pill-del').forEach((btn) => {
            btn.addEventListener('click', () => {
                const sec = Number(btn.getAttribute('data-sec'));
                const flow = Number(btn.getAttribute('data-flow'));
                const grp = Number(btn.getAttribute('data-grp'));
                this._mutateFlowGroups(sec, flow, (groups) => groups.filter((_, i) => i !== grp));
            });
        });

        // Add Attack Pill to branch
        root.querySelectorAll('.bam-add-pill-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const sec = Number(btn.getAttribute('data-sec'));
                const flow = Number(btn.getAttribute('data-flow'));
                this._mutateFlowGroups(sec, flow, (groups) => {
                    const nextIdx = groups.length;
                    const nextToken = nextIdx < 4 ? `<ITEM_${nextIdx}>` : '<ITEM_0>';
                    groups.push({ token: nextToken, count: 1, strictOrder: false });
                    return groups;
                });
            });
        });

        // Add OR branch to Step
        root.querySelectorAll('.bam-add-branch-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!this._workingSequence) return;
                const sec = Number(btn.getAttribute('data-sec'));
                const section = this._workingSequence[sec];
                if (!section) return;
                const hasOptionalExit = section.some((f) => f.length === 0);
                const nonEmptyFlows = section.filter((f) => f.length > 0);
                nonEmptyFlows.push(['<ITEM_0>']);
                this._workingSequence[sec] = hasOptionalExit ? [...nonEmptyFlows, []] : nonEmptyFlows;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            });
        });

        // Delete OR branch
        root.querySelectorAll('.bam-del-branch-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!this._workingSequence) return;
                const sec = Number(btn.getAttribute('data-sec'));
                const flow = Number(btn.getAttribute('data-flow'));
                const section = this._workingSequence[sec];
                if (!section) return;
                const hasOptionalExit = section.some((f) => f.length === 0);
                const nonEmptyFlows = section.filter((f) => f.length > 0).filter((_, i) => i !== flow);
                this._workingSequence[sec] = hasOptionalExit ? [...nonEmptyFlows, []] : nonEmptyFlows;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            });
        });

        // Toggle Optional / Can Finish Early checkbox
        root.querySelectorAll('.bam-step-optional-cb').forEach((cb) => {
            cb.addEventListener('change', (ev) => {
                if (!this._workingSequence) return;
                const sec = Number(cb.getAttribute('data-sec'));
                const checked = (ev.target as HTMLInputElement).checked;
                const section = this._workingSequence[sec];
                if (!section) return;
                const nonEmptyFlows = section.filter((f) => f.length > 0);
                this._workingSequence[sec] = checked ? [...nonEmptyFlows, []] : nonEmptyFlows;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            });
        });

        // Add "Then" Sequential Step
        const addStepBtn = root.querySelector('#bam-add-step-btn');
        addStepBtn?.addEventListener('click', () => {
            if (!this._workingSequence) return;
            this._workingSequence.push([['<ITEM_0>']]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        // Delete Step
        root.querySelectorAll('.bam-del-step-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!this._workingSequence || this._workingSequence.length <= 1) return;
                const sec = Number(btn.getAttribute('data-sec'));
                this._workingSequence = this._workingSequence.filter((_, i) => i !== sec);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            });
        });

        // Raw JSON textarea manual edit sync
        const rawJsonEl = root.querySelector('#bam-edit-sequence') as HTMLTextAreaElement | null;
        rawJsonEl?.addEventListener('change', () => {
            try {
                const parsed = JSON.parse(rawJsonEl.value);
                if (Array.isArray(parsed)) {
                    this._workingSequence = parsed;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this as any).render?.();
                }
            } catch (_e) {
                // Keep working sequence if JSON is mid-edit invalid
            }
        });

        const addBtn = root.querySelector('#bam-add-template-btn');
        addBtn?.addEventListener('click', async () => {
            const newEntry = await autorecManager.registerEntry({
                id: '',
                name: 'New Custom Multiattack Template',
                type: 'template',
                pattern: '<ACTOR> makes two attacks: one with its <ITEM_0> and one with its <ITEM_1>.',
                sequence: [[['<ITEM_0>', '<ITEM_1>']]],
                enabled: true
            });
            this._selectedId = newEntry.id;
            this._workingSequence = null;
            this._droppedActor = null;
            this._pendingName = null;
            this._pendingPattern = null;
            this._pendingType = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        const resetBtn = root.querySelector('#bam-reset-defaults-btn');
        resetBtn?.addEventListener('click', async () => {
            await autorecManager.resetToDefaults(true);
            this._workingSequence = null;
            this._droppedActor = null;
            this._pendingName = null;
            this._pendingPattern = null;
            this._pendingType = null;
            notify.info('Reset multiattack autorecognition entries to system defaults.');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        const saveBtn = root.querySelector('#bam-save-btn');
        saveBtn?.addEventListener('click', async () => {
            if (!this._selectedId) return;
            const nameEl = root.querySelector('#bam-edit-name') as HTMLInputElement | null;
            const patternEl = root.querySelector('#bam-edit-pattern') as HTMLInputElement | null;
            const seqEl = root.querySelector('#bam-edit-sequence') as HTMLTextAreaElement | null;
            if (!nameEl || !patternEl) return;

            try {
                const parsedSeq = this._workingSequence ?? (seqEl ? JSON.parse(seqEl.value) : [[['<ITEM_0>']]]);
                const entryType = this._pendingType ?? (patternEl.value.includes('::') ? 'override' : 'template');
                await autorecManager.registerEntry({
                    id: this._selectedId,
                    name: nameEl.value.trim(),
                    type: entryType,
                    pattern: patternEl.value.trim(),
                    sequence: parsedSeq,
                    enabled: true
                });
                this._pendingName = null;
                this._pendingPattern = null;
                this._pendingType = null;
                notify.info(`Saved Multiattack Autorec entry: "${nameEl.value.trim()}"`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            } catch (_err) {
                notify.error('Invalid Multiattack sequence format.');
            }
        });

        const deleteBtn = root.querySelector('#bam-delete-btn');
        deleteBtn?.addEventListener('click', async () => {
            if (!this._selectedId) return;
            const deletedEntry = autorecManager.getAllEntries().find((e) => e.id === this._selectedId);
            await autorecManager.deleteEntry(this._selectedId);
            this._selectedId = null;
            this._workingSequence = null;
            this._droppedActor = null;
            this._pendingName = null;
            this._pendingPattern = null;
            this._pendingType = null;
            if (deletedEntry) {
                notify.info(`Deleted Multiattack Autorec entry: "${deletedEntry.name}"`);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });
    }

    /**
     * Helper to test how a raw description abstracts and parses deterministically.
     */
    static previewParse(description: string, itemNames: string[], actorName: string = 'Monster'): {
        template: string;
        itemMap: Record<string, string>;
        sequence: unknown;
    } {
        const mockItems = itemNames.map((name) => ({ name } as unknown as Item));
        const { template, itemMap } = abstractMultiattackDescription(description, mockItems, actorName);
        const sequence = parseMultiattackTemplate(template);
        return { template, itemMap, sequence };
    }
}

