import { deepFreeze, localize } from '../../lib/utils.js';
import type { SelectOptionItem } from '../../types/global.d.js';

export const USER_PERMISSION_TIERS = deepFreeze({
    PLAYER: 1,
    TRUSTED: 2,
    GM: 3
});

export interface SelectDialogConfig {
    title?: string;
    subtitle?: string;
    cancelLabel?: string;
}

/**
 * Base abstract class for all Foundry platform adapters.
 * Encapsulates version-agnostic Foundry Application, DialogV2 popup selection, speaker resolution, and ownership operations.
 */
export class BaseFoundryAdapter {
    get generation(): number {
        return game.release?.generation ?? 12;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get ApplicationV2(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (foundry as any)?.applications?.api?.ApplicationV2;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get DialogV2(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (foundry as any)?.applications?.api?.DialogV2;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get HandlebarsApplicationMixin(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (foundry as any)?.applications?.api?.HandlebarsApplicationMixin;
    }

    /**
     * Resolves the active rolling or speaker token for a chat message.
     * @param {ChatMessage|null|undefined} message Chat message document
     * @returns {Token|null}
     */
    getSpeakerToken(message: ChatMessage | null | undefined): Token | null {
        if (!canvas?.ready || !canvas.tokens) return null;

        const speakerTokenId = message?.speaker?.token;
        if (speakerTokenId) {
            const speakerTarget = canvas.tokens.get(speakerTokenId);
            if (speakerTarget) return speakerTarget;
        }

        const speakerActorId = message?.speaker?.actor;
        if (speakerActorId) {
            const actorTokens = canvas.tokens.placeables.filter((t: Token) => t.actor?.id === speakerActorId);
            if (actorTokens.length > 0) return actorTokens[0] ?? null;
        }

        return canvas.tokens.controlled?.[0] ?? null;
    }

    /**
     * Resolves the actor associated with a chat message speaker.
     * @param {ChatMessage|null|undefined} message Chat message document
     * @returns {Actor|null}
     */
    getSpeakerActor(message: ChatMessage | null | undefined): Actor | null {
        const speaker = message?.speaker;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (speaker && (ChatMessage as any)?.getSpeakerActor) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actor = (ChatMessage as any).getSpeakerActor(speaker);
            if (actor) return actor;
        }
        const speakerToken = this.getSpeakerToken(message);
        if (speakerToken?.actor) return speakerToken.actor;

        if (speaker?.actor && game.actors) {
            return game.actors.get(speaker.actor) ?? null;
        }
        return game.user?.character ?? null;
    }

    /**
     * Determines whether the active client user is the user who created the given ChatMessage.
     * @param {ChatMessage|null|undefined} message Chat message document
     * @param {string} [hookUserId] Optional userId passed as the 3rd argument to createChatMessage hook
     * @returns {boolean}
     */
    isMessageAuthor(message: ChatMessage | null | undefined, hookUserId?: string): boolean {
        const currentUserId = game.user?.id;
        if (!currentUserId) return false;
        if (hookUserId) {
            return hookUserId === currentUserId;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authorId = message?.author?.id ?? (message as any)?.user?.id ?? (message as any)?.user;
        return authorId === currentUserId;
    }

    /**
     * Classify a Foundry User into a standard permission tier (1: Player, 2: Trusted Player, 3: GM / Co-GM).
     * @param {User} user Concrete User document
     * @returns {number|null}
     */
    getUserPermissionTier(user: User): number | null {
        if (!user) return null;
        if (user.isGM) return USER_PERMISSION_TIERS.GM;

        const userRole = user.role;
        if (userRole === 0) return null;

        const assistantRole = CONST.USER_ROLES?.ASSISTANT ?? 3;
        const trustedRole = CONST.USER_ROLES?.TRUSTED ?? 2;
        const playerRole = CONST.USER_ROLES?.PLAYER ?? 1;

        if (userRole != null && userRole >= assistantRole) {
            return USER_PERMISSION_TIERS.GM;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (userRole === trustedRole || Boolean((user as any).isTrusted)) {
            return USER_PERMISSION_TIERS.TRUSTED;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (userRole === playerRole || !(user as any).isTrusted) {
            return USER_PERMISSION_TIERS.PLAYER;
        }
        return null;
    }

    /**
     * Test whether a user possesses an ownership role for a given document (Actor or TokenDocument).
     * @param {User} user Concrete User document
     * @param {Actor|TokenDocument|null} doc Concrete Document
     * @returns {boolean}
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isUserDocumentOwner(user: User, doc: any): boolean {
        if (!user || !doc) return false;
        if (this.getUserPermissionTier(user) === USER_PERMISSION_TIERS.GM) {
            return true;
        }
        const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        if (doc.testUserPermission) {
            return Boolean(doc.testUserPermission(user, 'OWNER'));
        }
        if (doc.getUserLevel) {
            return doc.getUserLevel(user) >= ownerLevel;
        }
        if (doc.ownership) {
            const level = (user.id ? doc.ownership[user.id] : undefined) ?? doc.ownership.default ?? 0;
            return level >= ownerLevel;
        }
        return (user.id === game.user?.id || user === game.user) && Boolean(doc.isOwner);
    }

    /**
     * Determine if a user is "in-charge" of a token or actor.
     * Prioritizes lower permission tiers (Players > Trusted Players > GMs) among connected owners.
     * @param {Token|null} token Target token placeable
     * @param {Actor|null} actor Fallback actor document if token is null
     * @param {User} [user=game.user] Target user to evaluate
     * @returns {boolean}
     */
    isUserInCharge(token: Token | null, actor: Actor | null = null, user: User | null = game.user ?? null): boolean {
        if (!user) return false;
        const targetActor = token?.actor ?? actor;
        const targetDoc = token?.document ?? targetActor;
        if (!targetDoc) return false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isOwner = (u: any) => this.isUserDocumentOwner(u, targetActor) || this.isUserDocumentOwner(u, token?.document);
        if (!isOwner(user)) return false;

        const userTier = this.getUserPermissionTier(user);
        if (!userTier) return false;
        if (userTier === USER_PERMISSION_TIERS.PLAYER) return true;

        const usersCollection = game.users;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allUsers: any[] = (usersCollection as any)?.contents
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?? ((usersCollection as any)?.values ? Array.from((usersCollection as any).values()) : []);

        for (const otherUser of allUsers) {
            if (!otherUser.active || otherUser.id === user.id) continue;
            if (!isOwner(otherUser)) continue;
            const otherTier = this.getUserPermissionTier(otherUser);
            if (otherTier && otherTier < userTier) {
                return false;
            }
        }
        return true;
    }

    /**
     * Renders Bakana's custom glassmorphism popup selection dialog for choosing the next attack in a Multiattack sequence.
     * Replaces external dependencies like chrisPremades.
     * @param {SelectOptionItem[]} options List of selectable options
     * @param {SelectDialogConfig} [config={}] Dialog configuration
     * @returns {Promise<string | null>} Selected option value, or null if cancelled
     */
    async selectOptionDialog(options: SelectOptionItem[], config: SelectDialogConfig = {}): Promise<string | null> {
        if (!options || options.length === 0) return null;
        if (options.length === 1 && !options[0]?.isFinish) {
            return options[0]?.value ?? null;
        }

        const dialogCls = this.DialogV2;
        const title = config.title ?? localize('BAM.selectDialog.title', 'Select Multiattack Option');
        const subtitle = config.subtitle ?? '';
        const cancelLabel = config.cancelLabel ?? localize('BAM.selectDialog.cancelLabel', 'Cancel Sequence');

        // Build HTML content for custom option buttons
        const optionsHtml = options.map((opt, idx) => {
            const imgHtml = opt.img
                ? `<img class="bam-option-icon" src="${opt.img}" alt="${opt.label}" />`
                : `<i class="fas fa-sword" style="width: 28px; text-align: center; color: #818cf8;"></i>`;
            const badgeHtml = opt.badge ? `<span class="bam-option-badge">${opt.badge}</span>` : '';
            const finishClass = opt.isFinish ? 'bam-option-finish' : '';
            return `
                <button type="button" class="bam-option-btn ${finishClass}" data-option-idx="${idx}" data-option-value="${opt.value}">
                    <div class="bam-option-left">
                        ${imgHtml}
                        <span>${opt.label}</span>
                    </div>
                    ${badgeHtml}
                </button>
            `;
        }).join('');

        const content = `
            <div class="bam-select-container">
                ${subtitle ? `<div class="bam-select-header">${subtitle}</div>` : ''}
                <div class="bam-option-list">
                    ${optionsHtml}
                </div>
            </div>
        `;

        if (dialogCls?.wait) {
            return new Promise<string | null>((resolve) => {
                let resolved = false;
                const finish = (val: string | null) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(val);
                    }
                };

                dialogCls.wait({
                    window: {
                        title,
                        classes: ['standard-form', 'bam-select-dialog']
                    },
                    position: { width: 380 },
                    content,
                    buttons: [
                        {
                            label: cancelLabel,
                            action: 'cancel',
                            callback: () => finish(null)
                        }
                    ],
                    rejectClose: false,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    render: (_event: any, app: any) => {
                        const root = app?.element ?? (_event?.element ?? _event);
                        if (root?.querySelectorAll) {
                            const btns = root.querySelectorAll('.bam-option-btn');
                            btns.forEach((btn: HTMLElement) => {
                                btn.addEventListener('click', () => {
                                    const val = btn.getAttribute('data-option-value');
                                    finish(val);
                                    app?.close?.();
                                });
                            });
                        }
                    },
                    close: () => finish(null)
                }).catch(() => finish(null));
            });
        }

        // Fallback if DialogV2 is mocked or unavailable in headless test environments
        return options[0]?.value ?? null;
    }

    /**
     * Merge two objects recursively.
     */
    mergeObject<T extends object, U extends object>(original: T, other: U = {} as U, options: Record<string, unknown> = {}): T & U {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return foundry.utils.mergeObject(original, other, options as any) as T & U;
    }

    /**
     * Deep clone an object.
     */
    deepClone<T>(obj: T): T {
        return foundry.utils.deepClone(obj) as T;
    }

    /**
     * Generate a random ID.
     */
    randomID(length: number = 16): string {
        return foundry.utils.randomID(length);
    }

    /**
     * Test whether an object is empty.
     */
    isEmpty(obj: object): boolean {
        return foundry.utils.isEmpty(obj);
    }

    /**
     * Compare two semantic version strings.
     */
    isNewerVersion(v1: string | number, v0: string | number): boolean {
        return foundry.utils.isNewerVersion(v1, v0);
    }
}
