import { MODULE_ID } from '../constants.js';
import { log } from '../lib/logger.js';
import {
    MULTIATTACK_SYSTEM_PROMPT,
    MULTIATTACK_REPAIR_SYSTEM_PROMPT,
    buildRepairUserPrompt,
    parseLLMResponse
} from './prompt.js';
import type { MultiattackSequence } from '../types/global.d.js';

export interface LlmRequestOptions {
    provider?: string;
    apiKey?: string;
    model?: string;
    endpoint?: string;
}

export interface LlmRepairRequest {
    description: string;
    currentSequence: MultiattackSequence;
    userFeedback: string;
}

/**
 * Multi-provider LLM client for parsing and repairing abstracted or concrete multiattack templates.
 * Supports OpenAI, Google Gemini, Anthropic Claude, and Custom OpenAI-compatible Local Endpoints (Ollama/LM Studio).
 */
export class LlmClient {
    /**
     * Queries the configured LLM to parse an abstracted Multiattack template string.
     * @param {string} abstractedTemplate Template containing `<ACTOR>` and `<ITEM_N>` placeholders
     * @param {LlmRequestOptions} [options={}] Optional override credentials
     * @returns {Promise<MultiattackSequence | null>}
     */
    async queryMultiattackTemplate(
        abstractedTemplate: string,
        options: LlmRequestOptions = {}
    ): Promise<MultiattackSequence | null> {
        return this._executePrompt(MULTIATTACK_SYSTEM_PROMPT, abstractedTemplate, options);
    }

    /**
     * Queries the configured LLM to repair or refine an existing 3D Multiattack sequence
     * based on the multiattack description, current JSON, and user's explanation of the issue.
     */
    async repairMultiattackSequence(
        request: LlmRepairRequest,
        options: LlmRequestOptions = {}
    ): Promise<MultiattackSequence | null> {
        const userPrompt = buildRepairUserPrompt({
            description: request.description,
            currentJson: JSON.stringify(request.currentSequence),
            userFeedback: request.userFeedback
        });
        return this._executePrompt(MULTIATTACK_REPAIR_SYSTEM_PROMPT, userPrompt, options);
    }

    private async _executePrompt(
        systemPrompt: string,
        userInput: string,
        options: LlmRequestOptions = {}
    ): Promise<MultiattackSequence | null> {
        const provider = options.provider ?? (game.settings?.get(MODULE_ID, 'llmProvider') as string) ?? 'openai';
        const apiKey = options.apiKey ?? (game.settings?.get(MODULE_ID, 'llmApiKey') as string) ?? '';
        const model = options.model ?? (game.settings?.get(MODULE_ID, 'llmModel') as string) ?? 'gpt-4o-mini';
        const customEndpoint = options.endpoint ?? (game.settings?.get(MODULE_ID, 'llmEndpoint') as string) ?? '';

        if (!apiKey && provider !== 'custom') {
            log.warn('LlmClient | LLM request attempted, but no API key is configured in module settings.');
            return null;
        }

        try {
            let rawText = '';
            if (provider === 'gemini') {
                rawText = await this._queryGemini(systemPrompt, userInput, apiKey, model);
            } else if (provider === 'anthropic') {
                rawText = await this._queryAnthropic(systemPrompt, userInput, apiKey, model);
            } else {
                const trimmedEndpoint = customEndpoint.trim();
                const url = trimmedEndpoint ? trimmedEndpoint : 'https://api.openai.com/v1/chat/completions';
                rawText = await this._queryOpenAICompatible(url, systemPrompt, userInput, apiKey, model);
            }

            const sequence = parseLLMResponse(rawText);
            if (!sequence) {
                log.warn('LlmClient | LLM returned unparseable or invalid 3D sequence format:', rawText);
                return null;
            }
            return sequence;
        } catch (err) {
            log.error('LlmClient | Error querying LLM provider:', err);
            return null;
        }
    }

    private async _queryOpenAICompatible(
        url: string,
        systemPrompt: string,
        input: string,
        apiKey: string,
        model: string
    ): Promise<string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: input }
                ],
                temperature: 0
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI/Compatible API HTTP ${response.status}`);
        }
        const data = await response.json();
        return data?.choices?.[0]?.message?.content ?? '';
    }

    private async _queryGemini(
        systemPrompt: string,
        input: string,
        apiKey: string,
        model: string
    ): Promise<string> {
        const geminiModel = model.startsWith('gemini') ? model : 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: input }] }],
                generationConfig: { temperature: 0 }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API HTTP ${response.status}`);
        }
        const data = await response.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    private async _queryAnthropic(
        systemPrompt: string,
        input: string,
        apiKey: string,
        model: string
    ): Promise<string> {
        const claudeModel = model.startsWith('claude') ? model : 'claude-3-5-haiku-latest';
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: claudeModel,
                max_tokens: 1024,
                system: systemPrompt,
                messages: [{ role: 'user', content: input }],
                temperature: 0
            })
        });

        if (!response.ok) {
            throw new Error(`Anthropic API HTTP ${response.status}`);
        }
        const data = await response.json();
        return data?.content?.[0]?.text ?? '';
    }
}

export const llmClient = new LlmClient();
