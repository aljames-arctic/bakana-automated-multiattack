/**
 * Helper to safely localize a key, falling back to a default string if the key is not found.
 * @param {string} key The translation key
 * @param {string} [fallback] The fallback string if the key is not found (defaults to key)
 * @returns {string} The localized string or fallback
 */
export function localize(key: string, fallback?: string): string;
export function localize(key: string | null | undefined, fallback?: string | null): string | null;
export function localize(key: string | null | undefined, fallback?: string | null): string | null {
    const defaultStr = fallback !== undefined ? fallback : key;
    if (!key) return defaultStr ?? '';
    if (!game.i18n) return defaultStr ?? null;
    if (game.i18n.has(key)) {
        return game.i18n.localize(key) ?? defaultStr ?? null;
    }
    const val = game.i18n.localize?.(key);
    return (val && val !== key) ? val : (defaultStr ?? null);
}

/**
 * Helper to safely format a localized template string with data variables.
 * @param {string} key The translation key
 * @param {Record<string, unknown>} [data={}] Interpolation data object
 * @param {string} [fallback] Fallback string
 * @returns {string} The formatted localized string
 */
export function format(key: string, data: Record<string, unknown> = {}, fallback?: string): string {
    const defaultStr = fallback !== undefined ? fallback : key;
    if (!key) return defaultStr ?? '';
    if (game.i18n?.format) {
        if (game.i18n.has(key)) {
            return game.i18n.format(key, data);
        }
        const val = game.i18n.format(key, data);
        if (val && val !== key) return val;
    }
    let str = localize(key, fallback);
    if (!str || str === key) {
        str = defaultStr;
    }
    if (data && str) {
        return str.replace(/\{(\w+)\}/g, (match: string, p1: string) => String(data[p1] ?? match));
    }
    return str;
}

/**
 * Recursively freezes an object, its nested objects, and arrays.
 * Handles circular references safely via WeakSet.
 * @template T
 * @param {T} obj The object or array to recursively freeze
 * @param {WeakSet<object>} [seen=new WeakSet()] Visited object tracking
 * @returns {Readonly<T>} The deeply frozen object
 */
export function deepFreeze<T>(obj: T, seen: WeakSet<object> = new WeakSet()): Readonly<T> {
    if (obj === null || typeof obj !== 'object' || seen.has(obj)) {
        return obj;
    }
    seen.add(obj);
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
        const val = (obj as Record<string | symbol, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val, seen);
        }
    }
    return obj;
}
