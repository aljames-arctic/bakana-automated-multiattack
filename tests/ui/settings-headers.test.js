import test from 'node:test';
import assert from 'node:assert/strict';
import '../setup.js';
import { injectSettingsHeaders } from '../../src/settings.js';
import { MODULE_ID } from '../../src/constants.js';

class MockElement {
    constructor(tagName, attrs = {}) {
        this.tagName = tagName;
        this.className = attrs.className ?? '';
        this.dataset = attrs.dataset ?? {};
        this.name = attrs.name ?? '';
        this.children = [];
        this.parentNode = null;
        this.previousElementSibling = null;
        this.nextElementSibling = null;
        this.innerHTML = '';
        this.classList = {
            contains: (cls) => this.className.split(' ').includes(cls),
            add: (cls) => { if (!this.classList.contains(cls)) this.className = `${this.className} ${cls}`.trim(); }
        };
    }

    _updateSiblings() {
        for (let i = 0; i < this.children.length; i++) {
            this.children[i].previousElementSibling = i > 0 ? this.children[i - 1] : null;
            this.children[i].nextElementSibling = i < this.children.length - 1 ? this.children[i + 1] : null;
        }
    }

    appendChild(child) {
        if (child.parentNode) {
            const oldIdx = child.parentNode.children.indexOf(child);
            if (oldIdx !== -1) child.parentNode.children.splice(oldIdx, 1);
            child.parentNode._updateSiblings();
        }
        child.parentNode = this;
        this.children.push(child);
        this._updateSiblings();
        return child;
    }

    insertBefore(newChild, refChild) {
        if (newChild.parentNode) {
            const oldIdx = newChild.parentNode.children.indexOf(newChild);
            if (oldIdx !== -1) newChild.parentNode.children.splice(oldIdx, 1);
            newChild.parentNode._updateSiblings();
        }
        const index = refChild ? this.children.indexOf(refChild) : -1;
        if (index === -1) {
            return this.appendChild(newChild);
        }
        newChild.parentNode = this;
        this.children.splice(index, 0, newChild);
        this._updateSiblings();
        return newChild;
    }

    closest(selector) {
        if (selector === '.form-group') {
            let curr = this;
            while (curr) {
                if (curr.classList?.contains('form-group')) return curr;
                curr = curr.parentNode;
            }
        }
        return null;
    }

    querySelector(selector) {
        const parts = selector.split(',').map(s => s.trim());
        const findMatch = (el) => {
            for (const part of parts) {
                if (part.startsWith('[name="') && part.endsWith('"]')) {
                    const expectedName = part.slice(7, -2);
                    if (el.name === expectedName) return el;
                }
                if (part.startsWith('[data-key="') && part.endsWith('"]')) {
                    const expectedKey = part.slice(11, -2);
                    if (el.dataset?.key === expectedKey) return el;
                }
                if (part.includes('[data-scope="') && part.endsWith('"]')) {
                    const expectedScope = part.split('[data-scope="')[1].slice(0, -2);
                    if (el.dataset?.scope === expectedScope) return el;
                }
            }
            for (const child of el.children) {
                const found = findMatch(child);
                if (found) return found;
            }
            return null;
        };
        return findMatch(this);
    }
}

test('injectSettingsHeaders inserts world, user, and client headers into BAM SettingsConfig DOM and orders client after user', () => {
    const origCreateElement = globalThis.document?.createElement;
    globalThis.document = {
        createElement: (tagName) => new MockElement(tagName)
    };

    try {
        const root = new MockElement('div', { className: 'settings-list' });

        // World menu button
        const fgWorld = new MockElement('div', { className: 'form-group' });
        const btnWorld = new MockElement('button', { dataset: { key: `${MODULE_ID}.autorecMenu` } });
        fgWorld.appendChild(btnWorld);
        root.appendChild(fgWorld);

        // Suppose logVerbosity (client) appeared before autoSelectSingleOption (user)
        const fgClient = new MockElement('div', { className: 'form-group' });
        const inputClient = new MockElement('input', { name: `${MODULE_ID}.logVerbosity` });
        fgClient.appendChild(inputClient);
        root.appendChild(fgClient);

        // User setting
        const fgUser = new MockElement('div', { className: 'form-group' });
        const inputUser = new MockElement('input', { name: `${MODULE_ID}.autoSelectSingleOption` });
        fgUser.appendChild(inputUser);
        root.appendChild(fgUser);

        injectSettingsHeaders(root);

        assert.equal(root.children.length, 6, 'Should have 3 headers + 3 form groups');
        assert.equal(root.children[0].className, 'bam-settings-section-header');
        assert.equal(root.children[0].dataset.scope, 'world');
        assert.equal(root.children[1], fgWorld);

        assert.equal(root.children[2].className, 'bam-settings-section-header');
        assert.equal(root.children[2].dataset.scope, 'user');
        assert.equal(root.children[3], fgUser, 'User setting should be under User header');

        assert.equal(root.children[4].className, 'bam-settings-section-header');
        assert.equal(root.children[4].dataset.scope, 'client');
        assert.equal(root.children[5], fgClient, 'Client setting should be relocated after User setting under Client header');

        // Idempotency check
        injectSettingsHeaders(root);
        assert.equal(root.children.length, 6, 'Should not duplicate headers on repeated calls');
    } finally {
        if (origCreateElement) {
            globalThis.document.createElement = origCreateElement;
        }
    }
});
