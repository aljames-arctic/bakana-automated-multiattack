/**
 * Ambient TypeScript declarations for Bakana's Automated Multiattack.
 */

export type MultiattackSequence = string[][][];

export interface AbstractedMultiattack {
    /** Normalized template string with <ACTOR> and <ITEM_N> placeholders */
    template: string;
    /** Map from <ITEM_N> placeholder to concrete Actor Item name */
    itemMap: Record<string, string>;
    /** Reverse map from lowercase item name to <ITEM_N> placeholder */
    reverseMap: Record<string, string>;
}

export interface AutorecEntry {
    id: string;
    name: string;
    /** 'template' for abstracted <ITEM_N> patterns, 'override' for specific Actor::Item overrides */
    type: 'template' | 'override';
    /** Abstracted template string or Actor::Item key */
    pattern: string;
    /** 3D sequence of attack options per 'then' section */
    sequence: MultiattackSequence;
    enabled: boolean;
    sourceModule?: string;
    version?: string;
}

export interface SelectOptionItem {
    value: string;
    label: string;
    img?: string;
    badge?: string;
    isFinish?: boolean;
}

declare global {
    interface SettingConfig {
        "bakana-automated-multiattack.autorecEntries": Record<string, AutorecEntry>;
        "bakana-automated-multiattack.autoTriggerOnUse": boolean;
        "bakana-automated-multiattack.showChatCardButton": boolean;
        "bakana-automated-multiattack.enableLlmFallback": boolean;
        "bakana-automated-multiattack.llmProvider": string;
        "bakana-automated-multiattack.llmApiKey": string;
        "bakana-automated-multiattack.llmModel": string;
        "bakana-automated-multiattack.llmEndpoint": string;
        "bakana-automated-multiattack.autoSelectSingleOption": boolean;
        "bakana-automated-multiattack.clearTargetsBetweenAttacks": boolean;
        "bakana-automated-multiattack.logVerbosity": string;
    }

    namespace HookConfig {
        interface DeprecatedHookConfig {
            "dnd5e.postUseActivity": (activity: unknown, usageConfig: unknown, results: unknown) => Promise<void> | void;
        }
    }

    function fromUuid(uuid: string): Promise<unknown>;

    interface Window {
        bakanaMultiattack?: {
            adapter: unknown;
            autorecManager: unknown;
            executeMultiattack: (actor: Actor, item: Item, token?: Token | null) => Promise<void>;
            abstractMultiattackDescription: (description: string, actorItems: Item[], actorName?: string) => AbstractedMultiattack;
            parseMultiattackTemplate: (template: string) => MultiattackSequence | null;
        };
    }
}
