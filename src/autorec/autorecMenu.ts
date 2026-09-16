import { autorecManager } from './autorecManager.js';
import { abstractMultiattackDescription } from '../multiattack/abstraction.js';
import { parseMultiattackTemplate } from '../multiattack/parser.js';
import { localize } from '../lib/utils.js';
import { notify } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BaseApp = (foundry as any)?.applications?.api?.ApplicationV2 ?? class {};

/**
 * ApplicationV2 Menu for inspecting, editing, testing, and managing central Multiattack Autorecognition entries.
 */
export class AutorecMenuApplication extends BaseApp {
    private _selectedId: string | null = null;
    private _searchFilter: string = '';

    static DEFAULT_OPTIONS = {
        id: 'bam-autorec-menu',
        tag: 'div',
        window: {
            title: 'BAM.autorecMenu.title',
            icon: 'fa-solid fa-swords',
            resizable: true
        },
        position: {
            width: 820,
            height: 580
        },
        classes: ['bam-autorec-app']
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async _renderHTML(_context: any, _options: any): Promise<HTMLElement> {
        const entries = autorecManager.getAllEntries().filter((e) => {
            if (!this._searchFilter) return true;
            const q = this._searchFilter.toLowerCase();
            return e.name.toLowerCase().includes(q) || e.pattern.toLowerCase().includes(q);
        });

        const selected = entries.find((e) => e.id === this._selectedId) ?? entries[0] ?? null;
        if (selected) this._selectedId = selected.id;

        const container = document.createElement('div');
        container.className = 'bam-autorec-container';

        const sidebarItemsHtml = entries.map((e) => `
            <div class="bam-sidebar-item ${e.id === selected?.id ? 'active' : ''}" data-entry-id="${e.id}">
                <span>${e.name}</span>
                <span style="font-size: 0.7rem; opacity: 0.7;">${e.type === 'override' ? 'Override' : 'Template'}</span>
            </div>
        `).join('');

        const inspectorHtml = selected ? `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <label style="font-size: 0.8rem; color: #94a3b8;">Entry Name</label>
                <input type="text" id="bam-edit-name" value="${selected.name}" style="padding: 6px; background: #1e2436; border: 1px solid #4f46e5; color: #fff; border-radius: 4px;" />

                <label style="font-size: 0.8rem; color: #94a3b8;">Pattern / Key (use &lt;ACTOR&gt; and &lt;ITEM_0&gt;, &lt;ITEM_1&gt; or Actor::Item)</label>
                <textarea id="bam-edit-pattern" rows="3" style="padding: 6px; background: #1e2436; border: 1px solid #4f46e5; color: #fff; border-radius: 4px; font-family: monospace;">${selected.pattern}</textarea>

                <label style="font-size: 0.8rem; color: #94a3b8;">3D Multiattack Sequence JSON (Sections &rarr; Alternative Flows &rarr; Attack Tokens)</label>
                <textarea id="bam-edit-sequence" rows="6" style="padding: 6px; background: #1e2436; border: 1px solid #4f46e5; color: #a5b4fc; border-radius: 4px; font-family: monospace;">${JSON.stringify(selected.sequence, null, 2)}</textarea>

                <div style="display: flex; gap: 10px; margin-top: 8px;">
                    <button type="button" id="bam-save-btn" class="bam-chat-card-btn" style="flex: 1;">
                        <i class="fas fa-save"></i> ${localize('BAM.autorecMenu.saveBtn', 'Save Changes')}
                    </button>
                    <button type="button" id="bam-delete-btn" class="bam-option-btn bam-option-finish" style="width: auto; padding: 6px 14px;">
                        <i class="fas fa-trash"></i> ${localize('BAM.autorecMenu.deleteBtn', 'Delete')}
                    </button>
                </div>
            </div>
        ` : `<div style="color: #94a3b8;">No entries found.</div>`;

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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            });
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        const resetBtn = root.querySelector('#bam-reset-defaults-btn');
        resetBtn?.addEventListener('click', async () => {
            await autorecManager.resetToDefaults(true);
            notify.info('Reset multiattack autorecognition entries to system defaults.');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).render?.();
        });

        const saveBtn = root.querySelector('#bam-save-btn');
        saveBtn?.addEventListener('click', async () => {
            if (!this._selectedId) return;
            const nameEl = root.querySelector('#bam-edit-name') as HTMLInputElement | null;
            const patternEl = root.querySelector('#bam-edit-pattern') as HTMLTextAreaElement | null;
            const seqEl = root.querySelector('#bam-edit-sequence') as HTMLTextAreaElement | null;
            if (!nameEl || !patternEl || !seqEl) return;

            try {
                const parsedSeq = JSON.parse(seqEl.value);
                await autorecManager.registerEntry({
                    id: this._selectedId,
                    name: nameEl.value.trim(),
                    type: patternEl.value.includes('::') ? 'override' : 'template',
                    pattern: patternEl.value.trim(),
                    sequence: parsedSeq,
                    enabled: true
                });
                notify.info(`Saved Multiattack Autorec entry: "${nameEl.value.trim()}"`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this as any).render?.();
            } catch (_err) {
                notify.error('Invalid 3D JSON sequence format.');
            }
        });

        const deleteBtn = root.querySelector('#bam-delete-btn');
        deleteBtn?.addEventListener('click', async () => {
            if (!this._selectedId) return;
            await autorecManager.deleteEntry(this._selectedId);
            this._selectedId = null;
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
