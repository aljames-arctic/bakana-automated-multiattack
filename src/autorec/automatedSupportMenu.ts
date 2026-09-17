import { MODULE_ID } from '../constants.js';
import { notify } from '../lib/logger.js';
import { llmClient } from '../multiattack/llm-client.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BaseApp = (foundry as any)?.applications?.api?.ApplicationV2 ?? class {};

/**
 * ApplicationV2 Menu for configuring Automated Support (LLM fallback & JSON repair agent settings).
 */
export class AutomatedSupportMenuApplication extends BaseApp {
    static DEFAULT_OPTIONS = {
        id: 'bam-automated-support-menu',
        tag: 'div',
        window: {
            title: 'Automated Support',
            icon: 'fa-solid fa-robot',
            resizable: true
        },
        position: {
            width: 540,
            height: 520
        },
        classes: ['bam-autorec-app']
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async _renderHTML(_context: any, _options: any): Promise<HTMLElement> {
        const container = document.createElement('div');
        container.className = 'bam-autorec-container';
        container.style.padding = '16px';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '12px';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settingsApi = (game as any)?.settings;
        const enableLlmFallback = Boolean(settingsApi?.get(MODULE_ID, 'enableLlmFallback') ?? false);
        const llmProvider = String(settingsApi?.get(MODULE_ID, 'llmProvider') ?? 'openai');
        const llmApiKey = String(settingsApi?.get(MODULE_ID, 'llmApiKey') ?? '');
        const llmModel = String(settingsApi?.get(MODULE_ID, 'llmModel') ?? 'gpt-4o-mini');
        const llmEndpoint = String(settingsApi?.get(MODULE_ID, 'llmEndpoint') ?? '');

        container.innerHTML = `
            <div style="font-size: 0.85rem; color: #cbd5e1; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); padding: 10px 12px; border-radius: 6px; line-height: 1.4;">
                <i class="fas fa-robot" style="color: #818cf8; margin-right: 6px;"></i>
                <b>Automated Support</b> enables optional AI assistance for parsing novel homebrew multiattack phrasings into reusable templates and interactively fixing complex sequence JSON in the Multiattack Manager.
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; background: #1e2436; padding: 10px 12px; border-radius: 6px; border: 1px solid #334155;">
                <div>
                    <div style="font-weight: 600; color: #f8fafc; font-size: 0.9rem;">Enable Automated Support</div>
                    <div style="font-size: 0.78rem; color: #94a3b8;">Allow unknown multiattack phrasings to fall back to the configured LLM and enable the interactive JSON Repair Agent.</div>
                </div>
                <input type="checkbox" id="bam-llm-enable" ${enableLlmFallback ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.82rem; font-weight: 600; color: #e2e8f0;">LLM Provider</label>
                <select id="bam-llm-provider" style="width: 100%; padding: 7px 10px; background: #1e2436; border: 1px solid #475569; color: #f8fafc; border-radius: 5px;">
                    <option value="openai" ${llmProvider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4o / GPT-4o-mini)</option>
                    <option value="gemini" ${llmProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                    <option value="anthropic" ${llmProvider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
                    <option value="custom" ${llmProvider === 'custom' ? 'selected' : ''}>Custom OpenAI-Compatible Endpoint (Ollama / Local)</option>
                </select>
                <span style="font-size: 0.75rem; color: #94a3b8;">Select the LLM API provider for parsing novel multiattack phrasings.</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.82rem; font-weight: 600; color: #e2e8f0;">LLM API Key</label>
                <div style="display: flex; gap: 6px;">
                    <input type="password" id="bam-llm-api-key" value="${llmApiKey.replace(/"/g, '&quot;')}" placeholder="sk-... / AIza..." style="flex: 1; padding: 7px 10px; background: #1e2436; border: 1px solid #475569; color: #f8fafc; border-radius: 5px; font-family: monospace;" />
                    <button type="button" id="bam-toggle-key-btn" class="bam-chat-card-btn" style="width: 38px; padding: 0; display: flex; align-items: center; justify-content: center;" title="Show / Hide API Key">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
                <span style="font-size: 0.75rem; color: #94a3b8;">API key for the selected LLM provider. Leave blank if using local Ollama without auth.</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.82rem; font-weight: 600; color: #e2e8f0;">LLM Model Name</label>
                <input type="text" id="bam-llm-model" value="${llmModel.replace(/"/g, '&quot;')}" placeholder="gpt-4o-mini, gemini-2.5-flash, claude-3-5-haiku-latest" style="width: 100%; padding: 7px 10px; background: #1e2436; border: 1px solid #475569; color: #f8fafc; border-radius: 5px; font-family: monospace;" />
                <span style="font-size: 0.75rem; color: #94a3b8;">Model identifier to request from the provider.</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.82rem; font-weight: 600; color: #e2e8f0;">Custom LLM Endpoint URL (Optional)</label>
                <input type="text" id="bam-llm-endpoint" value="${llmEndpoint.replace(/"/g, '&quot;')}" placeholder="http://localhost:11434/v1/chat/completions" style="width: 100%; padding: 7px 10px; background: #1e2436; border: 1px solid #475569; color: #f8fafc; border-radius: 5px; font-family: monospace;" />
                <span style="font-size: 0.75rem; color: #94a3b8;">Optional custom endpoint URL for OpenAI-compatible servers or local proxies.</span>
            </div>

            <div id="bam-llm-test-status" style="display: none; font-size: 0.8rem; padding: 8px 10px; border-radius: 5px;"></div>

            <div style="display: flex; gap: 10px; margin-top: 6px;">
                <button type="button" id="bam-test-llm-btn" class="bam-chat-card-btn" style="flex: 1; background: #334155; border-color: #475569;">
                    <i class="fas fa-plug"></i> Test Connection
                </button>
                <button type="button" id="bam-save-llm-btn" class="bam-chat-card-btn" style="flex: 1;">
                    <i class="fas fa-save"></i> Save Automated Support
                </button>
            </div>
        `;

        const toggleKeyBtn = container.querySelector('#bam-toggle-key-btn');
        const keyInput = container.querySelector('#bam-llm-api-key') as HTMLInputElement | null;
        toggleKeyBtn?.addEventListener('click', () => {
            if (!keyInput) return;
            const isPassword = keyInput.type === 'password';
            keyInput.type = isPassword ? 'text' : 'password';
            toggleKeyBtn.innerHTML = isPassword
                ? '<i class="fas fa-eye-slash"></i>'
                : '<i class="fas fa-eye"></i>';
        });

        const getFormValues = () => {
            const enableEl = container.querySelector('#bam-llm-enable') as HTMLInputElement | null;
            const providerEl = container.querySelector('#bam-llm-provider') as HTMLSelectElement | null;
            const modelEl = container.querySelector('#bam-llm-model') as HTMLInputElement | null;
            const endpointEl = container.querySelector('#bam-llm-endpoint') as HTMLInputElement | null;
            return {
                enableLlmFallback: Boolean(enableEl?.checked ?? false),
                llmProvider: providerEl?.value ?? 'openai',
                llmApiKey: keyInput?.value?.trim() ?? '',
                llmModel: modelEl?.value?.trim() ?? 'gpt-4o-mini',
                llmEndpoint: endpointEl?.value?.trim() ?? ''
            };
        };

        const statusEl = container.querySelector('#bam-llm-test-status') as HTMLElement | null;
        const testBtn = container.querySelector('#bam-test-llm-btn');
        testBtn?.addEventListener('click', async () => {
            const values = getFormValues();
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(59, 130, 246, 0.15)';
                statusEl.style.border = '1px solid rgba(59, 130, 246, 0.4)';
                statusEl.style.color = '#93c5fd';
                statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing connection with sample multiattack pattern...';
            }

            try {
                const result = await llmClient.queryMultiattackTemplate(
                    '<ACTOR> makes two <ITEM_0> attacks.',
                    {
                        provider: values.llmProvider,
                        apiKey: values.llmApiKey,
                        model: values.llmModel,
                        endpoint: values.llmEndpoint
                    }
                );
                if (result && Array.isArray(result)) {
                    if (statusEl) {
                        statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
                        statusEl.style.border = '1px solid rgba(16, 185, 129, 0.4)';
                        statusEl.style.color = '#6ee7b7';
                        statusEl.innerHTML = `<i class="fas fa-check-circle"></i> Connection successful! Parsed sample as <code>${JSON.stringify(result)}</code>`;
                    }
                } else {
                    if (statusEl) {
                        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                        statusEl.style.color = '#fca5a5';
                        statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Connection failed or returned invalid sequence format. Check API key, model, or console logs.';
                    }
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                    statusEl.style.color = '#fca5a5';
                    statusEl.innerHTML = `<i class="fas fa-times-circle"></i> Error testing connection: ${(err as Error)?.message ?? String(err)}`;
                }
            }
        });

        const saveBtn = container.querySelector('#bam-save-llm-btn');
        saveBtn?.addEventListener('click', async () => {
            const values = getFormValues();
            if (settingsApi) {
                await settingsApi.set(MODULE_ID, 'enableLlmFallback', values.enableLlmFallback);
                await settingsApi.set(MODULE_ID, 'llmProvider', values.llmProvider);
                await settingsApi.set(MODULE_ID, 'llmApiKey', values.llmApiKey);
                await settingsApi.set(MODULE_ID, 'llmModel', values.llmModel);
                await settingsApi.set(MODULE_ID, 'llmEndpoint', values.llmEndpoint);
            }
            notify.info('Saved Automated Support settings.');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).close?.();
        });

        return container;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _replaceHTML(result: HTMLElement, content: HTMLElement, _options: any): void {
        content.replaceChildren(result);
    }
}
