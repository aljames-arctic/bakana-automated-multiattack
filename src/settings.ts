import { MODULE_ID, MODULE_NAME } from './constants.js';
import { log } from './lib/logger.js';
import { localize, deepFreeze } from './lib/utils.js';
import { autorecManager, SYSTEM_DEFAULT_TEMPLATES } from './autorec/autorecManager.js';
import { AutorecMenuApplication } from './autorec/autorecMenu.js';
import { AutorecExchangeMenuApplication } from './autorec/autorecExchangeMenu.js';
import { AutomatedSupportMenuApplication } from './autorec/automatedSupportMenu.js';

const USER_SETTING_KEYS = deepFreeze([
    'autoSelectSingleOption',
    'clearTargetsBetweenAttacks'
]);

const SETTINGS_SECTIONS = deepFreeze([
    {
        keys: [
            'autorecMenu',
            'autorecExchangeMenu',
            'automatedSupportMenu',
            'autoTriggerOnUse',
            'showChatCardButton'
        ],
        scope: 'world',
        titleKey: 'BAM.settingsSections.world',
        defaultTitle: 'World Settings',
        icon: 'fas fa-globe'
    },
    {
        keys: [
            'autoSelectSingleOption',
            'clearTargetsBetweenAttacks'
        ],
        scope: 'user',
        titleKey: 'BAM.settingsSections.user',
        defaultTitle: 'User Settings',
        icon: 'fas fa-user'
    },
    {
        keys: [
            'logVerbosity'
        ],
        scope: 'client',
        titleKey: 'BAM.settingsSections.client',
        defaultTitle: 'Client Settings',
        icon: 'fas fa-desktop'
    }
]);

function getSettingSelector(key: string): string {
    return [
        `[data-setting-id="${MODULE_ID}.${key}"]`,
        `[data-entry-id="${MODULE_ID}.${key}"]`,
        `[name="${MODULE_ID}.${key}"]`,
        `[data-key="${MODULE_ID}.${key}"]`,
        `[data-action="${MODULE_ID}.${key}"]`,
        `[data-setting-id="${key}"]`,
        `[data-entry-id="${key}"]`,
        `[name="${key}"]`,
        `[data-key="${key}"]`,
        `[data-action="${key}"]`
    ].join(', ');
}

/**
 * Registers module settings and menus during Foundry VTT initialization.
 */
export function registerModuleSettings(): void {
    log.info(`Initializing ${MODULE_NAME} settings`);
    if (!game.settings) return;

    // ==========================================
    // World Scope Settings & Menus
    // ==========================================

    game.settings.registerMenu(MODULE_ID, 'autorecMenu', {
        name: 'BAM.settings.autorecMenu.name',
        label: 'BAM.settings.autorecMenu.label',
        hint: 'BAM.settings.autorecMenu.hint',
        icon: 'fa-solid fa-swords',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: AutorecMenuApplication as any,
        restricted: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.registerMenu(MODULE_ID, 'autorecExchangeMenu', {
        name: 'BAM.settings.autorecExchangeMenu.name',
        label: 'BAM.settings.autorecExchangeMenu.label',
        hint: 'BAM.settings.autorecExchangeMenu.hint',
        icon: 'fa-solid fa-file-import',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: AutorecExchangeMenuApplication as any,
        restricted: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.registerMenu(MODULE_ID, 'automatedSupportMenu', {
        name: 'BAM.settings.automatedSupportMenu.name',
        label: 'BAM.settings.automatedSupportMenu.label',
        hint: 'BAM.settings.automatedSupportMenu.hint',
        icon: 'fa-solid fa-robot',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: AutomatedSupportMenuApplication as any,
        restricted: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const defaultEntriesRecord: Record<string, unknown> = {};
    for (const entry of SYSTEM_DEFAULT_TEMPLATES) {
        defaultEntriesRecord[entry.id] = entry;
    }

    game.settings.register(MODULE_ID, 'autorecEntries', {
        name: 'Multiattack Autorecognition Entries',
        scope: 'world',
        config: false,
        type: Object,
        default: defaultEntriesRecord,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange: (saved: Record<string, any>) => {
            autorecManager.loadSavedEntries(saved ?? {});
        }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'autoTriggerOnUse', {
        name: 'BAM.settings.autoTriggerOnUse.name',
        hint: 'BAM.settings.autoTriggerOnUse.hint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'showChatCardButton', {
        name: 'BAM.settings.showChatCardButton.name',
        hint: 'BAM.settings.showChatCardButton.hint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'enableLlmFallback', {
        name: 'BAM.settings.enableLlmFallback.name',
        hint: 'BAM.settings.enableLlmFallback.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'llmProvider', {
        name: 'BAM.settings.llmProvider.name',
        hint: 'BAM.settings.llmProvider.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            openai: 'BAM.settings.llmProvider.choices.openai',
            gemini: 'BAM.settings.llmProvider.choices.gemini',
            anthropic: 'BAM.settings.llmProvider.choices.anthropic',
            custom: 'BAM.settings.llmProvider.choices.custom'
        },
        default: 'openai'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'llmApiKey', {
        name: 'BAM.settings.llmApiKey.name',
        hint: 'BAM.settings.llmApiKey.hint',
        scope: 'world',
        config: false,
        type: String,
        default: ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'llmModel', {
        name: 'BAM.settings.llmModel.name',
        hint: 'BAM.settings.llmModel.hint',
        scope: 'world',
        config: false,
        type: String,
        default: 'gpt-4o-mini'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'llmEndpoint', {
        name: 'BAM.settings.llmEndpoint.name',
        hint: 'BAM.settings.llmEndpoint.hint',
        scope: 'world',
        config: false,
        type: String,
        default: ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // ==========================================
    // User Scope Settings
    // ==========================================

    game.settings.register(MODULE_ID, 'autoSelectSingleOption', {
        name: 'BAM.settings.autoSelectSingleOption.name',
        hint: 'BAM.settings.autoSelectSingleOption.hint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    game.settings.register(MODULE_ID, 'clearTargetsBetweenAttacks', {
        name: 'BAM.settings.clearTargetsBetweenAttacks.name',
        hint: 'BAM.settings.clearTargetsBetweenAttacks.hint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // ==========================================
    // Client Scope Settings
    // ==========================================

    game.settings.register(MODULE_ID, 'logVerbosity', {
        name: 'BAM.settings.logVerbosity.name',
        hint: 'BAM.settings.logVerbosity.hint',
        scope: 'client',
        config: true,
        type: String,
        choices: {
            error: 'BAM.settings.logVerbosity.choices.error',
            warn: 'BAM.settings.logVerbosity.choices.warn',
            info: 'BAM.settings.logVerbosity.choices.info',
            debug: 'BAM.settings.logVerbosity.choices.debug'
        },
        default: 'warn',
        onChange: (value: string) => log.setVerbosity(value ?? 'warn')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
}

/**
 * Injects structured World, User, and Client section headers into SettingsConfig.
 * Ensures client settings (`logVerbosity`) are positioned after user settings.
 *
 * @param {HTMLElement | JQuery} html Rendered settings config DOM element
 * @param {unknown} [_app=null] Settings application instance
 */
export function injectSettingsHeaders(html: HTMLElement | JQuery, _app: unknown = null): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root: HTMLElement | null = (html as any)?.querySelector ? (html as HTMLElement) : (html as any)?.[0] ?? null;
    if (!root?.querySelector) return;

    // 1. Ensure logVerbosity (Client Setting) is placed after the last User Setting
    let lastUserSettingEl: Element | null = null;
    for (const key of USER_SETTING_KEYS) {
        const found = root.querySelector(getSettingSelector(key));
        if (found) lastUserSettingEl = found;
    }

    const logVerbosityEl = root.querySelector(getSettingSelector('logVerbosity'));
    if (lastUserSettingEl && logVerbosityEl) {
        const lastUserFg = lastUserSettingEl.closest('.form-group') ?? lastUserSettingEl;
        const logFg = logVerbosityEl.closest('.form-group') ?? logVerbosityEl;
        if (lastUserFg && logFg && lastUserFg.parentNode && lastUserFg.parentNode === logFg.parentNode) {
            const parentChildren = Array.from(lastUserFg.parentNode.children);
            if (parentChildren.indexOf(logFg) < parentChildren.indexOf(lastUserFg)) {
                lastUserFg.parentNode.insertBefore(logFg, lastUserFg.nextElementSibling);
            }
        }
    }

    // 2. Insert section headers before the respective first setting in each scope
    for (const section of SETTINGS_SECTIONS) {
        let targetEl: Element | null = null;
        for (const key of section.keys) {
            targetEl = root.querySelector(getSettingSelector(key));
            if (targetEl) break;
        }

        if (!targetEl) continue;

        const formGroup = targetEl.closest('.form-group') ?? targetEl;
        const parent = formGroup?.parentNode;
        if (!formGroup || !parent) continue;

        // Ensure we don't insert duplicate headers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = (parent as any).querySelector?.(`.bam-settings-section-header[data-scope="${section.scope}"]`);
        if (existing) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prev = formGroup.previousElementSibling as any;
        if (prev?.classList?.contains('bam-settings-section-header') && prev?.dataset?.scope === section.scope) {
            continue;
        }

        const title = localize(section.titleKey, section.defaultTitle);
        const header = document.createElement('div');
        header.className = 'bam-settings-section-header';
        header.dataset.scope = section.scope;
        header.innerHTML = `<i class="${section.icon}"></i><span>${title}</span>`;
        parent.insertBefore(header, formGroup);
    }
}

Hooks.on('renderSettingsConfig', (_app: unknown, html: HTMLElement | JQuery) => {
    injectSettingsHeaders(html, _app);
});
