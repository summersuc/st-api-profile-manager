import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';

console.log('[APM] 纯切换器模式已加载');

const MODULE_DIRECTORY = (() => {
    const url = new URL(import.meta.url);
    const parts = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-2) ?? 'st-api-profile-manager');
})();

const MODULE_NAME = `third-party/${MODULE_DIRECTORY}`;

// ── Provider → Group mapping ─────────────────────────────────────────
const PROVIDER_GROUP_MAP = {
    claude: 'Claude 系',
    openai: 'OpenAI 系',
    azure_openai: 'OpenAI 系',
    custom: 'OpenAI 系',
    makersuite: 'Google 系',
    vertexai: 'Google 系',
    openrouter: '聚合接口',
    mistralai: '其他 API',
    cohere: '其他 API',
    perplexity: '其他 API',
    ai21: '其他 API',
    groq: '其他 API',
    deepseek: '其他 API',
    xai: '其他 API',
    moonshot: '其他 API',
    siliconflow: '其他 API',
    fireworks: '其他 API',
    pollinations: '其他 API',
    electronhub: '其他 API',
    cometapi: '其他 API',
    zai: '其他 API',
    chutes: '其他 API',
    nanogpt: '其他 API',
    aimlapi: '其他 API',
    generic: '开源模型',
    ooba: '开源模型',
    vllm: '开源模型',
    aphrodite: '开源模型',
    tabby: '开源模型',
    koboldcpp: '开源模型',
    llamacpp: '开源模型',
    ollama: '开源模型',
    huggingface: '开源模型',
};

const DEFAULT_GROUP_ORDER = ['Claude 系', 'OpenAI 系', 'Google 系', '聚合接口', '其他 API', '开源模型'];

// ── Settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    version: 3,
    profileGroupOverrides: {},
};

function getSettings() {
    extension_settings.apiProfileManager ??= structuredClone(DEFAULT_SETTINGS);
    const s = extension_settings.apiProfileManager;
    s.version ??= 3;
    s.profileGroupOverrides ??= {};
    return s;
}

function persist() {
    saveSettingsDebounced();
}

// ── ST Integration ───────────────────────────────────────────────────
function getStContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

async function getConnectionProfiles() {
    const context = getStContext();

    const directProfiles = context?.extensionSettings?.connectionManager?.profiles;
    if (Array.isArray(directProfiles) && directProfiles.length) {
        return directProfiles;
    }

    const exec = context?.executeSlashCommandsWithOptions;
    if (typeof exec !== 'function') return [];

    const listResult = await exec('/profile-list');
    const names = JSON.parse(String(listResult?.pipe ?? '[]'));
    if (!Array.isArray(names) || !names.length) return [];

    const details = [];
    for (const name of names) {
        const result = await exec(`/profile-get ${JSON.stringify(String(name))}`);
        const parsed = JSON.parse(String(result?.pipe ?? '{}'));
        if (parsed && typeof parsed === 'object') details.push(parsed);
    }
    return details;
}

async function setConnectionProfile(name) {
    const context = getStContext();
    const exec = context?.executeSlashCommandsWithOptions;
    if (typeof exec !== 'function') throw new Error('当前 ST 环境不支持程序化切换 Connection Profile');
    await exec(`/profile ${JSON.stringify(String(name))}`);
}

async function getCurrentProfileName() {
    const context = getStContext();
    const exec = context?.executeSlashCommandsWithOptions;
    if (typeof exec !== 'function') return '';
    const result = await exec('/profile');
    return String(result?.pipe ?? '').trim();
}

// ── Profile grouping ─────────────────────────────────────────────────
function detectProvider(rawProfile) {
    return String(
        rawProfile?.api || rawProfile?.source || rawProfile?.api_source ||
        rawProfile?.api_type || rawProfile?.type || ''
    ).toLowerCase().trim() || 'custom';
}

function getGroupForProfile(rawProfile) {
    const overrides = getSettings().profileGroupOverrides;
    const name = String(rawProfile?.name ?? '');
    if (overrides[name]) return overrides[name];
    const provider = detectProvider(rawProfile);
    return PROVIDER_GROUP_MAP[provider] ?? '其他 API';
}

function groupProfiles(rawProfiles) {
    const grouped = {};
    for (const p of rawProfiles) {
        const group = getGroupForProfile(p);
        grouped[group] ??= [];
        grouped[group].push(p);
    }
    const result = [];
    for (const gName of DEFAULT_GROUP_ORDER) {
        if (grouped[gName]) result.push({ name: gName, profiles: grouped[gName] });
    }
    for (const [gName, profiles] of Object.entries(grouped)) {
        if (!DEFAULT_GROUP_ORDER.includes(gName)) result.push({ name: gName, profiles });
    }
    return result;
}

// ── State ────────────────────────────────────────────────────────────
const state = {
    rawProfiles: [],
    groups: [],
    currentProfileName: '',
    isLoading: false,
};

// ── Helpers ───────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function showToast(msg, type = 'success') {
    const prev = document.querySelector('.apm-toast');
    if (prev) prev.remove();
    const el = document.createElement('div');
    el.className = `apm-toast apm-toast--${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('apm-toast--visible'));
    setTimeout(() => {
        el.classList.remove('apm-toast--visible');
        setTimeout(() => el.remove(), 300);
    }, 2500);
}

// ── Profile switching ─────────────────────────────────────────────────
async function switchProfile(profileName) {
    if (state.isLoading) return;
    try {
        state.isLoading = true;
        await setConnectionProfile(profileName);
        state.currentProfileName = profileName;
        refreshLauncherLabel();
        rebuildQuickRow();
        showToast(`已切换至 ${profileName}`);
    } catch (err) {
        console.error(`${MODULE_NAME}: switch failed`, err);
        showToast(`切换失败：${err.message}`, 'error');
    } finally {
        state.isLoading = false;
    }
}

// ── Launcher bar ──────────────────────────────────────────────────────
function buildLauncher(container) {
    container.innerHTML = `
        <div class="apm-launcher" id="apm-launcher-bar" role="button" tabindex="0" aria-label="API 管家">
            <div class="apm-launcher__left">
                <span class="apm-launcher__icon">⚡</span>
                <div class="apm-launcher__copy">
                    <div class="apm-launcher__title">API 管家</div>
                    <div class="apm-launcher__sub">
                        <span class="apm-launcher__dot"></span>
                        <span class="apm-launcher__active" id="apm-active-label">${escHtml(state.currentProfileName || '未选择')}</span>
                    </div>
                </div>
            </div>
            <span class="apm-launcher__arrow" aria-hidden="true">›</span>
        </div>
    `;
    const bar = container.querySelector('#apm-launcher-bar');
    bar.addEventListener('click', openPanel);
    bar.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openPanel(); });
}

function refreshLauncherLabel() {
    const lbl = document.getElementById('apm-active-label');
    if (lbl) lbl.textContent = state.currentProfileName || '未选择';
}

// ── Quick row ─────────────────────────────────────────────────────────
let quickRowDropdownCloseHandler = null;

function rebuildQuickRow() {
    const container = document.getElementById('apm-quick-row');
    if (!container) return;
    buildQuickRow(container);
}

function buildQuickRow(container) {
    // Detach old outside-click listener
    if (quickRowDropdownCloseHandler) {
        document.removeEventListener('click', quickRowDropdownCloseHandler, true);
        quickRowDropdownCloseHandler = null;
    }

    container.innerHTML = '';
    container.className = 'apm-quick-row';

    if (!state.groups.length) {
        container.innerHTML = '<span class="apm-quick-row__empty">暂无 Connection Profile，请先在 SillyTavern 中创建</span>';
        return;
    }

    // Detect current group
    let activeGroupName = state.groups[0].name;
    for (const g of state.groups) {
        if (g.profiles.some(p => String(p.name) === state.currentProfileName)) {
            activeGroupName = g.name;
            break;
        }
    }

    // -- Group selector (left) --
    const groupSel = document.createElement('select');
    groupSel.className = 'apm-quick-row__group-select';
    for (const g of state.groups) {
        const opt = document.createElement('option');
        opt.value = g.name;
        opt.textContent = g.name;
        groupSel.appendChild(opt);
    }
    groupSel.value = activeGroupName;

    // -- Model dropdown (right, with search) --
    const dropWrap = document.createElement('div');
    dropWrap.className = 'apm-quick-row__drop-wrap';

    function renderDrop(groupName) {
        const group = state.groups.find(g => g.name === groupName);
        if (!group) return;
        buildModelDropdown(dropWrap, group.profiles);
    }

    renderDrop(activeGroupName);

    groupSel.addEventListener('change', () => renderDrop(groupSel.value));

    container.appendChild(groupSel);
    container.appendChild(dropWrap);
}

function buildModelDropdown(wrap, profiles) {
    wrap.innerHTML = '';

    const activeProfile = profiles.find(p => String(p.name) === state.currentProfileName);

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'apm-drop__trigger';
    trigger.innerHTML = `
        <span class="apm-drop__dot${activeProfile ? ' apm-drop__dot--active' : ''}"></span>
        <span class="apm-drop__label">${escHtml(activeProfile?.name ?? profiles[0]?.name ?? '—')}</span>
        <span class="apm-drop__arrow">▼</span>
    `;

    // Panel
    const panel = document.createElement('div');
    panel.className = 'apm-drop__panel';

    // Search input
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'apm-drop__search';
    search.placeholder = '搜索配置…';

    // List
    const list = document.createElement('div');
    list.className = 'apm-drop__list';

    function renderList(q = '') {
        list.innerHTML = '';
        const lower = q.toLowerCase();
        const filtered = lower
            ? profiles.filter(p =>
                String(p.name).toLowerCase().includes(lower) ||
                String(p.model || p.modelId || '').toLowerCase().includes(lower))
            : profiles;

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'apm-drop__empty';
            empty.textContent = '没有找到匹配的配置';
            list.appendChild(empty);
            return;
        }

        for (const p of filtered) {
            const isActive = String(p.name) === state.currentProfileName;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `apm-drop__item${isActive ? ' apm-drop__item--active' : ''}`;
            item.innerHTML = `
                <span class="apm-drop__dot${isActive ? ' apm-drop__dot--active' : ''}"></span>
                <div class="apm-drop__item-text">
                    <span class="apm-drop__item-name">${escHtml(String(p.name))}</span>
                    <span class="apm-drop__item-model">${escHtml(String(p.model || p.modelId || ''))}</span>
                </div>
                ${isActive ? '<span class="apm-drop__badge">使用中</span>' : ''}
            `;
            if (!isActive) {
                item.addEventListener('click', () => {
                    closePanel();
                    switchProfile(String(p.name));
                });
            }
            list.appendChild(item);
        }
    }

    search.addEventListener('input', () => renderList(search.value));
    renderList();

    panel.appendChild(search);
    panel.appendChild(list);

    let isOpen = false;

    function openDrop() {
        isOpen = true;
        panel.classList.add('apm-drop__panel--open');
        trigger.classList.add('apm-drop__trigger--open');
        trigger.querySelector('.apm-drop__arrow').textContent = '▲';
        search.value = '';
        renderList();
        setTimeout(() => search.focus(), 40);
    }

    function closePanel() {
        isOpen = false;
        panel.classList.remove('apm-drop__panel--open');
        trigger.classList.remove('apm-drop__trigger--open');
        const arrowEl = trigger.querySelector('.apm-drop__arrow');
        if (arrowEl) arrowEl.textContent = '▼';
    }

    trigger.addEventListener('click', () => isOpen ? closePanel() : openDrop());

    // Outside-click closes the dropdown
    quickRowDropdownCloseHandler = (e) => {
        if (isOpen && !wrap.contains(e.target)) closePanel();
    };
    document.addEventListener('click', quickRowDropdownCloseHandler, true);

    wrap.appendChild(trigger);
    wrap.appendChild(panel);
}

// ── Full panel popup ──────────────────────────────────────────────────
function buildPanelContent() {
    const allCount = state.groups.reduce((n, g) => n + g.profiles.length, 0);

    let rows = '';
    for (const g of state.groups) {
        rows += `<div class="apm-panel__group-label">
            <span class="apm-panel__group-dot"></span>
            <span>${escHtml(g.name)}</span>
            <span class="apm-panel__group-count">${g.profiles.length} 个配置</span>
        </div>`;
        for (const p of g.profiles) {
            const isActive = String(p.name) === state.currentProfileName;
            rows += `<button class="apm-panel__row${isActive ? ' apm-panel__row--active' : ''}"
                        data-profile-name="${escHtml(String(p.name))}"
                        ${isActive ? 'disabled' : ''}>
                <span class="apm-panel__row-dot${isActive ? ' apm-panel__row-dot--active' : ''}"></span>
                <div class="apm-panel__row-text">
                    <span class="apm-panel__row-name">${escHtml(String(p.name))}</span>
                    <span class="apm-panel__row-model">${escHtml(String(p.model || p.modelId || ''))}</span>
                </div>
                ${isActive
                    ? '<span class="apm-panel__badge apm-panel__badge--active">使用中</span>'
                    : '<span class="apm-panel__badge apm-panel__badge--switch">切换</span>'}
            </button>`;
        }
    }

    return `<div class="apm-panel">
        <div class="apm-panel__header">
            <span class="apm-panel__title">⚡ API 管家</span>
        </div>
        ${state.currentProfileName ? `
        <div class="apm-panel__active-strip">
            <span class="apm-panel__active-dot"></span>
            <span class="apm-panel__active-name">${escHtml(state.currentProfileName)}</span>
            <span class="apm-panel__active-badge">使用中</span>
        </div>` : ''}
        <div class="apm-panel__search-wrap">
            <input class="apm-panel__search" type="text" placeholder="搜索配置名或模型…" />
        </div>
        <div class="apm-panel__list">${rows}</div>
        <div class="apm-panel__footer">
            <span>密钥保存在 SillyTavern 本地，不经过插件</span>
            <span>${allCount} 个配置</span>
        </div>
    </div>`;
}

async function openPanel() {
    if (!state.groups.length) {
        showToast('暂无 Connection Profile，请先在 SillyTavern 中创建', 'error');
        return;
    }

    const popup = new Popup(buildPanelContent(), POPUP_TYPE.DISPLAY, '', { wide: false, large: false });
    const dlg = popup.dlg;
    dlg.classList.add('apm-panel-popup');

    // Search filter
    const searchInput = dlg.querySelector('.apm-panel__search');
    const panelList = dlg.querySelector('.apm-panel__list');

    searchInput?.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        panelList?.querySelectorAll('.apm-panel__row').forEach(row => {
            const name = String(row.dataset.profileName ?? '').toLowerCase();
            const model = (row.querySelector('.apm-panel__row-model')?.textContent ?? '').toLowerCase();
            row.style.display = (!q || name.includes(q) || model.includes(q)) ? '' : 'none';
        });
        panelList?.querySelectorAll('.apm-panel__group-label').forEach(lbl => {
            let next = lbl.nextElementSibling;
            let anyVisible = false;
            while (next && !next.classList.contains('apm-panel__group-label')) {
                if (next.style.display !== 'none') anyVisible = true;
                next = next.nextElementSibling;
            }
            lbl.style.display = anyVisible ? '' : 'none';
        });
    });

    // Row click → switch
    panelList?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.apm-panel__row:not([disabled])');
        if (!btn) return;
        const profileName = btn.dataset.profileName;
        if (!profileName) return;
        popup.complete();
        await switchProfile(profileName);
    });

    await popup.show();
}

// ── Data loading ──────────────────────────────────────────────────────
async function loadProfiles() {
    try {
        state.rawProfiles = await getConnectionProfiles();
        state.groups = groupProfiles(state.rawProfiles);
        state.currentProfileName = await getCurrentProfileName();
    } catch (err) {
        console.error(`${MODULE_NAME}: failed to load profiles`, err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────
function getMountTarget() {
    return document.querySelector('#extensions_settings, #extension_settings, [data-tab="extensions"]')
        ?? document.querySelector('.extension_settings')
        ?? null;
}

jQuery(async () => {
    const target = getMountTarget();
    if (!target) {
        console.warn(`${MODULE_NAME}: mount target not found`);
        return;
    }

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings', {});
    target.insertAdjacentHTML('afterbegin', html);

    const root = document.getElementById('api_profile_manager_root');
    if (!(root instanceof HTMLElement)) {
        console.warn(`${MODULE_NAME}: root not found`);
        return;
    }

    // Build skeleton
    const launcherWrap = document.createElement('div');
    launcherWrap.id = 'apm-launcher-wrap';
    root.appendChild(launcherWrap);

    const quickRow = document.createElement('div');
    quickRow.id = 'apm-quick-row';
    root.appendChild(quickRow);

    buildLauncher(launcherWrap);

    // Load ST profiles then build interactive elements
    await loadProfiles();
    buildLauncher(launcherWrap);
    buildQuickRow(quickRow);

    // Keep in sync when ST's own connection profile changes externally
    const ctx = getStContext();
    if (ctx?.eventSource) {
        ctx.eventSource.on('CONNECTION_PROFILE_LOADED', async () => {
            state.currentProfileName = await getCurrentProfileName();
            refreshLauncherLabel();
            rebuildQuickRow();
        });
    }
});
