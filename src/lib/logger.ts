import { MODULE_ID, MODULE_NAME, MODULE_TLA } from '../constants.js';
import { deepFreeze } from './utils.js';

export const VERBOSITY_LEVELS = deepFreeze({
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
});

export const GROUP_STYLES = deepFreeze({
    error: 'color: #ef4444; font-weight: bold;',
    warn: 'color: #f59e0b; font-weight: bold;',
    info: 'color: #ffffff; font-weight: bold;',
    debug: 'color: #38bdf8; font-weight: bold;'
});

export const NOTIFICATION_LABELS = deepFreeze({
    error: ' — Errors',
    warn: ' — Warnings',
    info: ''
});

interface GroupEntry {
    message: string;
    level: string;
    groupArgs: unknown[];
    forceCollapse: boolean | null;
    started: boolean;
    enabled: boolean;
}

/**
 * Unified Logger and UI notification dispatcher for Bakana's Automated Multiattack.
 * Enforces strict logging hierarchy: error, warn, info, debug.
 */
export class Logger {
    private _cachedVerbosity: number | null;
    private _groupStack: GroupEntry[];
    private _queues: Record<string, string[]>;
    private _flushTimeout: ReturnType<typeof setTimeout> | number | null;
    private _batchWindowMs: number;
    notify: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
    };

    constructor() {
        this._cachedVerbosity = null;
        this._groupStack = [];
        this._queues = {
            info: [],
            warn: [],
            error: []
        };
        this._flushTimeout = null;
        this._batchWindowMs = 50;

        this.notify = deepFreeze({
            info: (message: string) => this._enqueueNotification('info', message),
            warn: (message: string) => this._enqueueNotification('warn', message),
            error: (message: string) => this._enqueueNotification('error', message)
        });

        this.error = this.error.bind(this);
        this.warn = this.warn.bind(this);
        this.info = this.info.bind(this);
        this.debug = this.debug.bind(this);
        this.group = this.group.bind(this);
        this.groupCollapsed = this.groupCollapsed.bind(this);
        this.groupExpanded = this.groupExpanded.bind(this);
        this.groupEnd = this.groupEnd.bind(this);
        this.getVerbosityLevel = this.getVerbosityLevel.bind(this);
        this.setVerbosity = this.setVerbosity.bind(this);
    }

    getVerbosityLevel(): number {
        if (this._cachedVerbosity !== null) return this._cachedVerbosity;
        try {
            if (game.settings) {
                const setting = game.settings.get(MODULE_ID, 'logVerbosity') as string;
                this._cachedVerbosity = (VERBOSITY_LEVELS as Record<string, number>)[setting] ?? VERBOSITY_LEVELS.warn;
                return this._cachedVerbosity;
            }
        } catch (_e) {
            // Settings not yet registered
        }
        return VERBOSITY_LEVELS.warn;
    }

    setVerbosity(level: string): void {
        this._cachedVerbosity = (VERBOSITY_LEVELS as Record<string, number>)[level] ?? VERBOSITY_LEVELS.warn;
    }

    private _ensureGroupsStarted(): void {
        for (const entry of this._groupStack) {
            if (entry.enabled && !entry.started) {
                const style = (GROUP_STYLES as Record<string, string>)[entry.level] ?? GROUP_STYLES.info;
                const shouldCollapse = entry.forceCollapse ?? (entry.level === 'debug' || entry.level === 'info');
                const consoleFn = (shouldCollapse && console.groupCollapsed) ? console.groupCollapsed : console.group;
                consoleFn(`%c${MODULE_TLA} | ${entry.message}`, style, ...entry.groupArgs);
                entry.started = true;
            }
        }
    }

    private _createGroup(forceCollapse: boolean | null, message: string, ...args: unknown[]): void {
        let level = 'info';
        let groupArgs = args;
        if (args.length > 0 && typeof args[0] === 'string' && (VERBOSITY_LEVELS as Record<string, number>)[args[0]] !== undefined) {
            level = args[0];
            groupArgs = args.slice(1);
        }
        const enabled = this.getVerbosityLevel() >= ((VERBOSITY_LEVELS as Record<string, number>)[level] ?? 0);
        this._groupStack.push({
            message,
            level,
            groupArgs,
            forceCollapse,
            started: false,
            enabled
        });
    }

    error(message: unknown, ...args: unknown[]): void {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.error) {
            this._ensureGroupsStarted();
            console.error(`${MODULE_TLA} | ${message}`, ...args);
        }
    }

    warn(message: unknown, ...args: unknown[]): void {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.warn) {
            this._ensureGroupsStarted();
            console.warn(`${MODULE_TLA} | ${message}`, ...args);
        }
    }

    info(message: unknown, ...args: unknown[]): void {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.info) {
            this._ensureGroupsStarted();
            console.log(`${MODULE_TLA} | ${message}`, ...args);
        }
    }

    debug(message: unknown, ...args: unknown[]): void {
        if (this.getVerbosityLevel() >= VERBOSITY_LEVELS.debug) {
            this._ensureGroupsStarted();
            const timestamp = game.time?.serverTime ?? 'Unknown';
            console.log(`%c[${MODULE_TLA} Debug (${timestamp})]`, 'color: #38bdf8; font-weight: bold;', message, ...args);
        }
    }

    group(message: string, ...args: unknown[]): void {
        this._createGroup(null, message, ...args);
    }

    groupCollapsed(message: string, ...args: unknown[]): void {
        this._createGroup(true, message, ...args);
    }

    groupExpanded(message: string, ...args: unknown[]): void {
        this._createGroup(false, message, ...args);
    }

    groupEnd(): void {
        const group = this._groupStack.pop();
        if (group?.started) {
            console.groupEnd();
        }
    }

    private _scheduleFlush(): void {
        if (this._flushTimeout !== null) return;
        this._flushTimeout = setTimeout(() => {
            this._flushTimeout = null;
            this._flushQueues();
        }, this._batchWindowMs);
    }

    private _flushQueues(): void {
        if (!ui.notifications) {
            this._queues.info.length = 0;
            this._queues.warn.length = 0;
            this._queues.error.length = 0;
            return;
        }

        for (const level of ['info', 'warn', 'error']) {
            const queue = this._queues[level];
            if (queue.length === 0) continue;

            const messages = [...queue];
            queue.length = 0;

            const text = messages.length === 1
                ? messages[0]
                : `${MODULE_NAME}${(NOTIFICATION_LABELS as Record<string, string>)[level] ?? ''} (${messages.length}):\n` +
                  messages.map((m) => `• ${m}`).join('\n');

            ui.notifications[level as 'info' | 'warn' | 'error'](text);
        }
    }

    private _enqueueNotification(level: 'info' | 'warn' | 'error', message: string | unknown): void {
        const trimmed = String(message ?? '').trim();
        if (!trimmed) return;
        const queue = this._queues[level];
        if (queue && !queue.includes(trimmed)) {
            queue.push(trimmed);
            this._scheduleFlush();
        }
    }
}

export const log = new Logger();
export const notify = log.notify;
