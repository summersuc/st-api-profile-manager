import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { callGenericPopup, POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { writeSecret } from '../../../secrets.js';

const MODULE_DIRECTORY = (() => {
    const url = new URL(import.meta.url);
    const parts = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-2) ?? 'st-api-profile-manager');
})();

const MODULE_NAME = `third-party/${MODULE_DIRECTORY}`;

const DEFAULT_SETTINGS = {
    version: 2,
    activeProfileId: '',
    profiles: [],
    preferences: {
        maskKeysByDefault: true,
    },
};

const MODE_OPTIONS = [
    { value: 'chat-completions', label: '聊天补全' },
    { value: 'text-generation', label: '文本生成' },
];

const PROVIDER_OPTIONS = {
    'chat-completions': [
        { value: 'custom', label: '兼容接口 / 自定义' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'azure_openai', label: 'Azure OpenAI' },
    ],
    'text-generation': [
        { value: 'generic', label: '通用接口' },
        { value: 'ooba', label: 'text-generation-webui' },
        { value: 'vllm', label: 'vLLM' },
        { value: 'aphrodite', label: 'Aphrodite' },
        { value: 'tabby', label: 'TabbyAPI' },
        { value: 'koboldcpp', label: 'KoboldCpp' },
        { value: 'llamacpp', label: 'llama.cpp' },
        { value: 'ollama', label: 'Ollama' },
        { value: 'huggingface', label: 'HuggingFace' },
    ],
};

const CHAT_PROVIDER_CONFIG = {
    custom: {
        secretKey: 'api_key_custom',
        sourceSelector: '#chat_completion_source',
        sourceValue: 'custom',
        urlSelector: '#custom_api_url_text',
        connectButton: '#api_button_openai',
    },
    openai: {
        secretKey: 'api_key_openai',
        sourceSelector: '#chat_completion_source',
        sourceValue: 'openai',
        connectButton: '#api_button_openai',
    },
    azure_openai: {
        secretKey: 'api_key_azure_openai',
        sourceSelector: '#chat_completion_source',
        sourceValue: 'azure_openai',
        urlSelector: '#azure_base_url',
        connectButton: '#api_button_openai',
    },
};

const TEXT_PROVIDER_CONFIG = {
    generic: { secretKey: 'api_key_generic', typeSelector: '#textgen_type', typeValue: 'generic', urlSelector: '#generic_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    ooba: { secretKey: 'api_key_ooba', typeSelector: '#textgen_type', typeValue: 'ooba', urlSelector: '#textgenerationwebui_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    vllm: { secretKey: 'api_key_vllm', typeSelector: '#textgen_type', typeValue: 'vllm', urlSelector: '#vllm_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    aphrodite: { secretKey: 'api_key_aphrodite', typeSelector: '#textgen_type', typeValue: 'aphrodite', urlSelector: '#aphrodite_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    tabby: { secretKey: 'api_key_tabby', typeSelector: '#textgen_type', typeValue: 'tabby', urlSelector: '#tabby_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    koboldcpp: { secretKey: 'api_key_koboldcpp', typeSelector: '#textgen_type', typeValue: 'koboldcpp', urlSelector: '#koboldcpp_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    llamacpp: { secretKey: 'api_key_llamacpp', typeSelector: '#textgen_type', typeValue: 'llamacpp', urlSelector: '#llamacpp_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    ollama: { typeSelector: '#textgen_type', typeValue: 'ollama', urlSelector: '#ollama_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    huggingface: { secretKey: 'api_key_huggingface', typeSelector: '#textgen_type', typeValue: 'huggingface', urlSelector: '#huggingface_api_url_text', connectButton: '#api_button_textgenerationwebui' },
};

const dom = {};

const uiState = {
    isOpen: false,
    view: 'home',
    activeGroupKey: '',
    editingProfileId: '',
    editorDraft: null,
    fetchedModels: [],
    status: '就绪',
    statusType: 'success',
    revealKey: false,
};

let lastLauncherTouchAt = 0;
let managerPopup = null;

async function fetchJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `请求失败：${response.status}`);
    }

    return await response.json();
}

function clone(value) {
    return structuredClone(value);
}

function defaultProfile() {
    const timestamp = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        groupName: '',
        mode: 'chat-completions',
        provider: 'custom',
        name: '',
        model: '',
        selectedModels: [],
        baseUrl: '',
        apiKey: '',
        headerName: 'Authorization',
        headerValue: '',
        notes: '',
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getSettings() {
    if (!extension_settings.apiProfileManager) {
        extension_settings.apiProfileManager = clone(DEFAULT_SETTINGS);
    }

    const settings = extension_settings.apiProfileManager;
    settings.version ??= DEFAULT_SETTINGS.version;
    settings.activeProfileId ??= '';
    settings.profiles ??= [];
    settings.preferences ??= clone(DEFAULT_SETTINGS.preferences);
    settings.preferences.maskKeysByDefault ??= true;
    settings.profiles = settings.profiles.map(profile => ({ ...defaultProfile(), ...profile, id: profile.id || crypto.randomUUID() }));
    return settings;
}

function persist() {
    saveSettingsDebounced();
}

function getProfiles() {
    return getSettings().profiles;
}

function getProfileById(profileId) {
    return getProfiles().find(profile => profile.id === profileId) ?? null;
}

function getEditingProfile() {
    return uiState.editorDraft ? clone(uiState.editorDraft) : getProfileById(uiState.editingProfileId) ?? null;
}

function getProviderOptions(mode) {
    return PROVIDER_OPTIONS[mode] ?? PROVIDER_OPTIONS['chat-completions'];
}

function getProviderLabel(mode, provider) {
    return getProviderOptions(mode).find(option => option.value === provider)?.label ?? provider;
}

function getModeLabel(mode) {
    return MODE_OPTIONS.find(option => option.value === mode)?.label ?? mode;
}

function getGroupKey(profile) {
    return normalizeText(profile.groupName) || normalizeText(profile.baseUrl) || '未命名分组';
}

function getGroupTitle(profile) {
    return normalizeText(profile.groupName) || normalizeText(profile.baseUrl) || '未命名分组';
}

function buildGroups() {
    const groups = new Map();

    for (const profile of getProfiles()) {
        const key = getGroupKey(profile);
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                title: getGroupTitle(profile),
                baseUrl: profile.baseUrl,
                profiles: [],
            });
        }
        groups.get(key).profiles.push(profile);
    }

    return Array.from(groups.values())
        .map(group => ({
            ...group,
            profiles: group.profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        }))
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}

function getActiveProfile() {
    return getProfileById(getSettings().activeProfileId);
}

function getCurrentGroup() {
    return buildGroups().find(group => group.key === uiState.activeGroupKey) ?? null;
}

function getSuggestedModels(profile) {
    const currentProfile = profile ?? getEditingProfile() ?? defaultProfile();
    const fetchedModels = uiState.fetchedModels.map(normalizeText).filter(Boolean);
    const existingModels = getProfiles()
        .filter(item => normalizeText(item.baseUrl) === normalizeText(currentProfile.baseUrl)
            && normalizeText(item.provider) === normalizeText(currentProfile.provider)
            && normalizeText(item.mode) === normalizeText(currentProfile.mode))
        .map(item => normalizeText(item.model))
        .filter(Boolean);

    return Array.from(new Set([...fetchedModels, ...existingModels, normalizeText(currentProfile.model)].filter(Boolean)));
}

function getFetchModelsPayload(profile) {
    if (profile.mode === 'text-generation') {
        return {
            url: '/api/backends/text-completions/status',
            payload: {
                api_server: profile.baseUrl,
                api_type: profile.provider,
            },
        };
    }

    const payload = {
        reverse_proxy: '',
        proxy_password: '',
        chat_completion_source: profile.provider,
    };

    if (profile.provider === 'custom') {
        payload.custom_url = profile.baseUrl;
        payload.custom_include_headers = false;
    }

    if (profile.provider === 'azure_openai') {
        payload.azure_base_url = profile.baseUrl;
        payload.azure_deployment_name = '';
        payload.azure_api_version = '2024-02-01';
    }

    return {
        url: '/api/backends/chat-completions/status',
        payload,
    };
}

function normalizeFetchedModels(responseData) {
    const candidates = Array.isArray(responseData?.data) ? responseData.data : [];
    return candidates
        .map(item => normalizeText(typeof item === 'string' ? item : item?.id || item?.name))
        .filter(Boolean);
}

async function fetchModelsForEditor() {
    const profile = readEditorProfile();
    if (!normalizeText(profile.baseUrl)) {
        uiState.editorDraft = profile;
        setStatus('请先填写 API URL', 'error');
        return;
    }

    const { url, payload } = getFetchModelsPayload(profile);
    setStatus('正在拉取模型列表…');

    try {
        const responseData = await fetchJson(url, payload);
        const models = normalizeFetchedModels(responseData);

        if (!models.length) {
            setStatus('没有获取到模型列表，请检查当前来源、密钥和接口地址', 'error');
            return;
        }

        uiState.fetchedModels = models;
        uiState.editorDraft = {
            ...profile,
            selectedModels: Array.from(new Set([...(profile.selectedModels ?? []), ...models.slice(0, 1)])),
        };
        setStatus(`已拉取 ${models.length} 个模型`);
        render();
    } catch (error) {
        console.error(`${MODULE_NAME}: fetch models failed`, error);
        setStatus(error instanceof Error ? `拉取失败：${error.message}` : '拉取模型失败', 'error');
    }
}

function getEditorForm() {
    const popupForm = managerPopup?.dlg?.querySelector?.('[data-role="editor-form"]');
    if (popupForm instanceof HTMLFormElement) {
        return popupForm;
    }

    const rootForm = dom.root?.querySelector?.('[data-role="editor-form"]');
    return rootForm instanceof HTMLFormElement ? rootForm : null;
}

function setStatus(message, type = 'success') {
    uiState.status = message;
    uiState.statusType = type;
    render();

    if (managerPopup?.dlg?.isConnected) {
        const statusBar = managerPopup.dlg.querySelector('.api-profile-manager__status-bar');
        if (statusBar instanceof HTMLElement) {
            statusBar.textContent = message;
            statusBar.classList.remove('is-error', 'is-success');
            statusBar.classList.add(type === 'error' ? 'is-error' : 'is-success');
        }
    }
}

function getMountTarget() {
    return document.getElementById('rm_api_block') || document.getElementById('extensions_settings2');
}

function setOpen(value) {
    uiState.isOpen = value;
    if (!value) {
        uiState.view = 'home';
        uiState.editingProfileId = '';
        uiState.activeGroupKey = '';
        uiState.editorDraft = null;
        uiState.revealKey = false;
    }
    render();
}

function goHome() {
    syncEditorDraftFromForm();
    uiState.view = 'home';
    uiState.activeGroupKey = '';
    uiState.editingProfileId = '';
    uiState.editorDraft = null;
    uiState.revealKey = !getSettings().preferences.maskKeysByDefault;
    render();
}

function openGroup(groupKey) {
    uiState.activeGroupKey = groupKey;
    uiState.view = 'group';
    render();
}

function openEditor(profileId = '', preset = {}) {
    const existing = profileId ? getProfileById(profileId) : null;
    const next = { ...defaultProfile(), ...preset, ...(existing ?? {}) };
    uiState.editingProfileId = next.id;
    uiState.editorDraft = next;
    uiState.view = 'editor';
    uiState.revealKey = !getSettings().preferences.maskKeysByDefault;

    render();
}

function getProviderConfig(profile) {
    return profile.mode === 'text-generation'
        ? TEXT_PROVIDER_CONFIG[profile.provider] ?? null
        : CHAT_PROVIDER_CONFIG[profile.provider] ?? null;
}

function setInputValue(selectors, value) {
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
            continue;
        }
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    return false;
}

function setSelectValue(selector, value) {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLSelectElement)) {
        return false;
    }
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function clickElement(selector) {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
        return false;
    }
    element.click();
    return true;
}

function validateProfile(profile) {
    if (!profile.mode || !PROVIDER_OPTIONS[profile.mode]) {
        return '请选择连接方式';
    }

    if (!profile.provider) {
        return '请选择聊天补全来源';
    }

    const selectedModels = Array.from(new Set([normalizeText(profile.model), ...(profile.selectedModels ?? []).map(normalizeText)].filter(Boolean)));
    if (!selectedModels.length) {
        return '请填写至少一个模型名称';
    }

    if (!normalizeText(profile.baseUrl)) {
        return '请填写接口地址';
    }

    try {
        const url = new URL(profile.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return '接口地址必须以 http 或 https 开头';
        }
    } catch {
        return '接口地址格式不正确';
    }

    return '';
}

function readEditorProfile() {
    const form = getEditorForm();
    const base = getEditingProfile() ? clone(getEditingProfile()) : defaultProfile();
    if (!(form instanceof HTMLFormElement)) {
        return base;
    }

    const formData = new FormData(form);
    base.groupName = normalizeText(formData.get('groupName'));
    base.mode = String(formData.get('mode') || 'chat-completions');
    base.provider = String(formData.get('provider') || getProviderOptions(base.mode)[0]?.value || 'custom');
    base.name = normalizeText(formData.get('name'));
    base.model = normalizeText(formData.get('model'));
    base.selectedModels = formData.getAll('selectedModels').map(value => normalizeText(value)).filter(Boolean);
    base.baseUrl = normalizeText(formData.get('baseUrl')).replace(/\/+$/u, '');
    base.apiKey = String(formData.get('apiKey') ?? '');
    base.headerName = 'Authorization';
    base.headerValue = '';
    base.notes = '';
    base.name = base.model || base.name || base.baseUrl;
    base.groupName = base.groupName || base.baseUrl;
    base.updatedAt = new Date().toISOString();
    return base;
}

function syncEditorDraftFromForm() {
    if (uiState.view !== 'editor') {
        return;
    }

    const form = getEditorForm();
    if (!(form instanceof HTMLFormElement)) {
        return;
    }

    uiState.editorDraft = readEditorProfile();
}

function upsertProfile(profile) {
    const settings = getSettings();
    const index = settings.profiles.findIndex(item => item.id === profile.id);
    if (index === -1) {
        settings.profiles.push(profile);
    } else {
        settings.profiles[index] = profile;
    }
}

async function saveCurrentEditorProfile({ applyAfterSave = false } = {}) {
    const profile = readEditorProfile();
    const validationError = validateProfile(profile);
    if (validationError) {
        uiState.editorDraft = profile;
        setStatus(validationError, 'error');
        return false;
    }

    const selectedModels = Array.from(new Set([profile.model, ...(profile.selectedModels ?? [])].map(normalizeText).filter(Boolean)));
    const modelsToSave = selectedModels.length ? selectedModels : [normalizeText(profile.model)];
    let primaryProfile = null;
    const settings = getSettings();

    settings.profiles = settings.profiles.filter(item => {
        const sameOrigin = normalizeText(item.baseUrl) === normalizeText(profile.baseUrl)
            && normalizeText(item.provider) === normalizeText(profile.provider)
            && normalizeText(item.mode) === normalizeText(profile.mode)
            && String(item.apiKey ?? '') === String(profile.apiKey ?? '');
        return !(sameOrigin && modelsToSave.includes(normalizeText(item.model)) && item.id !== profile.id);
    });

    for (const modelName of modelsToSave) {
        const nextProfile = {
            ...clone(profile),
            id: primaryProfile ? crypto.randomUUID() : profile.id,
            name: modelName,
            model: modelName,
            selectedModels: modelsToSave,
            groupName: profile.groupName || profile.baseUrl,
            updatedAt: new Date().toISOString(),
        };
        upsertProfile(nextProfile);
        if (!primaryProfile) {
            primaryProfile = nextProfile;
        }
    }

    uiState.editingProfileId = primaryProfile?.id || profile.id;
    uiState.editorDraft = clone(primaryProfile || profile);
    persist();
    setStatus(applyAfterSave ? `已保存并准备启用「${primaryProfile?.name || profile.name}」` : `已保存 ${modelsToSave.length} 个模型配置`);

    if (applyAfterSave) {
        await applyProfile(primaryProfile?.id || profile.id);
    } else {
        openGroup(getGroupKey(primaryProfile || profile));
    }
    return true;
}

async function deleteProfile(profileId) {
    const profile = getProfileById(profileId);
    if (!profile) {
        setStatus('没有找到要删除的配置', 'error');
        return;
    }

    const confirmed = await callGenericPopup(`删除配置「${profile.name}」后无法恢复，是否继续？`, POPUP_TYPE.CONFIRM, '');
    if (confirmed !== POPUP_RESULT.AFFIRMATIVE && confirmed !== true) {
        return;
    }

    const settings = getSettings();
    settings.profiles = settings.profiles.filter(item => item.id !== profileId);
    if (settings.activeProfileId === profileId) {
        settings.activeProfileId = settings.profiles[0]?.id ?? '';
    }
    persist();

    if (uiState.view === 'editor') {
        uiState.editorDraft = null;
        goHome();
    } else if (uiState.view === 'group') {
        const stillExists = getCurrentGroup();
        if (!stillExists) {
            goHome();
        } else {
            render();
        }
    } else {
        render();
    }

    setStatus('配置已删除');
}

function duplicateProfile(profileId) {
    const profile = getProfileById(profileId);
    if (!profile) {
        return;
    }

    const copy = {
        ...clone(profile),
        id: crypto.randomUUID(),
        name: `${profile.name} 副本`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    upsertProfile(copy);
    persist();
    openEditor(copy.id);
    setStatus('已复制配置');
}

async function applyProfile(profileId) {
    const profile = getProfileById(profileId);
    if (!profile) {
        setStatus('没有找到要启用的配置', 'error');
        return;
    }

    const validationError = validateProfile(profile);
    if (validationError) {
        setStatus(validationError, 'error');
        return;
    }

    const config = getProviderConfig(profile);
    if (!config) {
        setStatus('当前接口类型暂未接入自动切换', 'error');
        return;
    }

    const settings = getSettings();
    settings.activeProfileId = profile.id;
    persist();

    const mainApiApplied = setSelectValue('#main_api', profile.mode === 'text-generation' ? 'textgenerationwebui' : 'openai');
    const sourceApplied = config.sourceSelector && config.sourceValue
        ? setSelectValue(config.sourceSelector, config.sourceValue)
        : config.typeSelector && config.typeValue
            ? setSelectValue(config.typeSelector, config.typeValue)
            : false;
    const urlApplied = config.urlSelector ? setInputValue([config.urlSelector], profile.baseUrl) : false;
    const visibleKeyApplied = config.secretKey ? setInputValue([`#${config.secretKey}`], profile.apiKey) : false;
    let secretApplied = false;

    if (config.secretKey) {
        try {
            await writeSecret(config.secretKey, profile.apiKey, profile.name || profile.provider, { allowEmpty: true });
            secretApplied = true;
        } catch (error) {
            console.warn(`${MODULE_NAME}: writeSecret failed`, error);
        }
    }

    const connectTriggered = config.connectButton ? clickElement(config.connectButton) : false;

    if (mainApiApplied || sourceApplied || urlApplied || visibleKeyApplied || secretApplied || connectTriggered) {
        setStatus(`已启用「${profile.name}」`);
        render();
    } else {
        setStatus('已设为当前配置，但没有找到可自动填写的 SillyTavern 字段', 'error');
    }
}

function exportPayload() {
    const settings = getSettings();
    return {
        format: 'st-api-profile-manager',
        version: settings.version,
        activeProfileId: settings.activeProfileId,
        preferences: settings.preferences,
        profiles: settings.profiles,
        exportedAt: new Date().toISOString(),
    };
}

function encodeBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPlain() {
    const confirmed = await callGenericPopup('明文导出会包含原始 API 密钥，是否继续？', POPUP_TYPE.CONFIRM, '');
    if (confirmed !== POPUP_RESULT.AFFIRMATIVE && confirmed !== true) {
        return;
    }
    downloadText('st-api-profiles.json', JSON.stringify(exportPayload(), null, 2));
    setStatus('已导出 JSON 备份');
}

async function exportEncrypted() {
    if (!window.crypto?.subtle) {
        setStatus('当前环境不支持加密导出', 'error');
        return;
    }

    const password = await callGenericPopup('请输入导出密码', POPUP_TYPE.INPUT, '');
    if (!password || typeof password !== 'string') {
        return;
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const text = new TextEncoder().encode(JSON.stringify(exportPayload()));
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, text);

    downloadText('st-api-profiles.encrypted.json', JSON.stringify({
        format: 'st-api-profile-manager',
        version: 1,
        encrypted: true,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: encodeBase64(salt) },
        cipher: { name: 'AES-GCM', iv: encodeBase64(iv) },
        payload: encodeBase64(new Uint8Array(encrypted)),
    }, null, 2));
    setStatus('已导出加密备份');
}

async function decryptPayload(imported, password) {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt: decodeBase64(imported.kdf.salt),
        iterations: imported.kdf.iterations,
        hash: imported.kdf.hash,
    }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(imported.cipher.iv) }, key, decodeBase64(imported.payload));
    return JSON.parse(new TextDecoder().decode(decrypted));
}

async function importPayloadFromFile(file) {
    const text = await file.text();
    const imported = JSON.parse(text);
    let payload = imported;

    if (imported.encrypted) {
        const password = await callGenericPopup('请输入备份密码', POPUP_TYPE.INPUT, '');
        if (!password || typeof password !== 'string') {
            return;
        }
        payload = await decryptPayload(imported, password);
    }

    if (!Array.isArray(payload.profiles)) {
        throw new Error('导入文件中没有配置数据');
    }

    const settings = getSettings();
    settings.profiles = payload.profiles.map(profile => ({ ...defaultProfile(), ...profile, id: profile.id || crypto.randomUUID() }));
    settings.activeProfileId = payload.activeProfileId && settings.profiles.some(profile => profile.id === payload.activeProfileId)
        ? payload.activeProfileId
        : settings.profiles[0]?.id ?? '';
    settings.preferences = { ...settings.preferences, ...(payload.preferences ?? {}) };
    persist();
    setStatus(`已导入 ${settings.profiles.length} 条配置`);
    goHome();
}

function getHomeStats() {
    const groups = buildGroups();
    const activeProfile = getActiveProfile();
    return {
        groupCount: groups.length,
        profileCount: getProfiles().length,
        activeLabel: activeProfile?.name || '未启用',
    };
}

function renderStats() {
    const stats = getHomeStats();
    return `
        <div class="api-profile-manager__stats">
            <article class="api-profile-manager__stat-card">
                <span class="api-profile-manager__stat-label">分组数</span>
                <span class="api-profile-manager__stat-value">${stats.groupCount}</span>
            </article>
            <article class="api-profile-manager__stat-card">
                <span class="api-profile-manager__stat-label">配置数</span>
                <span class="api-profile-manager__stat-value">${stats.profileCount}</span>
            </article>
            <article class="api-profile-manager__stat-card">
                <span class="api-profile-manager__stat-label">当前启用</span>
                <span class="api-profile-manager__stat-value">${escapeHtml(stats.activeLabel)}</span>
            </article>
        </div>
    `;
}

function renderHomeView() {
    const groups = buildGroups();
    if (!groups.length) {
        return `
            <section class="api-profile-manager__empty-state">
                <div class="api-profile-manager__editor-card">
                    <h3 class="api-profile-manager__editor-title">还没有接口分组</h3>
                    <p class="api-profile-manager__empty">先新建一个分组。后面同一个接口地址和密钥下的多个模型，会自动放在同一个分组里。</p>
                    <button class="api-profile-manager__button api-profile-manager__button--primary api-profile-manager__button--full" data-action="new-profile">新建第一个分组</button>
                </div>
            </section>
        `;
    }

    const activeProfile = getActiveProfile();
    return `
        <section class="api-profile-manager__home">
            <div class="api-profile-manager__section-head">
                <div>
                    <h3 class="api-profile-manager__section-title">接口分组</h3>
                </div>
                <button class="api-profile-manager__button" data-action="open-tools">工具</button>
            </div>
            <div class="api-profile-manager__group-list">
                ${groups.map(group => {
                    const current = group.profiles.find(profile => profile.id === activeProfile?.id);
                    const latest = group.profiles[0];
                    return `
                        <article class="api-profile-manager__group-card">
                            <div class="api-profile-manager__group-top">
                                <div>
                                    <span class="api-profile-manager__group-label">接口分组</span>
                                    <h3 class="api-profile-manager__group-name">${escapeHtml(group.title)}</h3>
                                    <p class="api-profile-manager__meta">${escapeHtml(group.baseUrl || '未设置接口地址')}</p>
                                </div>
                                <span class="api-profile-manager__pill">${group.profiles.length} 个模型</span>
                            </div>
                            <div class="api-profile-manager__group-badges">
                                <span class="api-profile-manager__pill">最新模型：${escapeHtml(latest?.model || latest?.name || '未命名')}</span>
                                <span class="api-profile-manager__pill">当前模型：${escapeHtml(current?.model || current?.name || '无')}</span>
                            </div>
                            <div class="api-profile-manager__inline-actions">
                                <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="open-group" data-group-key="${escapeHtml(group.key)}">进入分组</button>
                                <button class="api-profile-manager__button" data-action="new-profile-in-group" data-group-key="${escapeHtml(group.key)}">新增模型</button>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function renderGroupView() {
    const group = getCurrentGroup();
    if (!group) {
        return renderHomeView();
    }

    const activeProfile = getActiveProfile();
    return `
        <section class="api-profile-manager__home">
            <div class="api-profile-manager__section-head">
                <div>
                    <h3 class="api-profile-manager__section-title">${escapeHtml(group.title)}</h3>
                    <p class="api-profile-manager__section-subtitle">${escapeHtml(group.baseUrl || '未设置接口地址')} · 共 ${group.profiles.length} 个模型</p>
                </div>
                <button class="api-profile-manager__button" data-action="back-home">返回首页</button>
            </div>
            <div class="api-profile-manager__profile-list">
                ${group.profiles.map(profile => `
                    <article class="api-profile-manager__profile-card">
                        <div class="api-profile-manager__profile-top">
                            <div>
                                <span class="api-profile-manager__profile-label">${profile.id === activeProfile?.id ? '当前模型' : '已保存模型'}</span>
                                <h3 class="api-profile-manager__profile-name">${escapeHtml(profile.model || profile.name || '未命名模型')}</h3>
                                <p class="api-profile-manager__meta">${escapeHtml(getModeLabel(profile.mode))} · ${escapeHtml(getProviderLabel(profile.mode, profile.provider))}</p>
                            </div>
                            <span class="api-profile-manager__pill">${escapeHtml(profile.updatedAt.slice(0, 10))}</span>
                        </div>
                        <div class="api-profile-manager__profile-badges">
                            <span class="api-profile-manager__pill">地址：${escapeHtml(profile.baseUrl)}</span>
                        </div>
                        <div class="api-profile-manager__profile-actions">
                            <button class="api-profile-manager__profile-action api-profile-manager__profile-action--primary" data-action="apply-profile" data-profile-id="${profile.id}">启用</button>
                            <button class="api-profile-manager__profile-action" data-action="edit-profile" data-profile-id="${profile.id}">编辑</button>
                            <button class="api-profile-manager__profile-action api-profile-manager__profile-action--danger" data-action="delete-profile" data-profile-id="${profile.id}">删除</button>
                        </div>
                    </article>
                `).join('')}
            </div>
            <div class="api-profile-manager__secondary-actions">
                <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="new-profile-in-group" data-group-key="${escapeHtml(group.key)}">在此分组新增模型</button>
            </div>
        </section>
    `;
}

function renderModeOptions(selectedMode) {
    return MODE_OPTIONS.map(option => `<option value="${option.value}" ${option.value === selectedMode ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

function renderProviderOptions(selectedMode, selectedProvider) {
    return getProviderOptions(selectedMode).map(option => `<option value="${option.value}" ${option.value === selectedProvider ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

function renderEditorView() {
    const profile = getEditingProfile() ?? defaultProfile();
    const suggestedModels = getSuggestedModels(profile);
    return `
        <section class="api-profile-manager__editor">
            <div class="api-profile-manager__section-head">
                <div>
                    <h3 class="api-profile-manager__section-title">${profile.model ? '编辑模型配置' : '新建模型配置'}</h3>
                </div>
                <button class="api-profile-manager__button" data-action="back-from-editor">返回</button>
            </div>
            <form class="api-profile-manager__editor-card" data-role="editor-form">
                <div class="api-profile-manager__field-grid">
                    <label class="api-profile-manager__field">
                        <span class="api-profile-manager__label">连接方式</span>
                        <select class="api-profile-manager__select" name="mode">${renderModeOptions(profile.mode)}</select>
                    </label>
                    <label class="api-profile-manager__field">
                        <span class="api-profile-manager__label">聊天补全来源</span>
                        <select class="api-profile-manager__select" name="provider">${renderProviderOptions(profile.mode, profile.provider)}</select>
                    </label>
                    <label class="api-profile-manager__field api-profile-manager__field--full">
                        <span class="api-profile-manager__label">API URL</span>
                        <input class="api-profile-manager__input" name="baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="https://example.com/v1">
                    </label>
                    <label class="api-profile-manager__field api-profile-manager__field--full">
                        <span class="api-profile-manager__label">API 密钥</span>
                        <div class="api-profile-manager__secret">
                            <input class="api-profile-manager__input" name="apiKey" type="${uiState.revealKey ? 'text' : 'password'}" value="${escapeHtml(profile.apiKey)}" placeholder="sk-..." autocomplete="off">
                            <button class="api-profile-manager__button" type="button" data-action="toggle-key">${uiState.revealKey ? '隐藏' : '显示'}</button>
                        </div>
                    </label>
                    <label class="api-profile-manager__field api-profile-manager__field--full">
                        <span class="api-profile-manager__label">输入模型名称</span>
                        <input class="api-profile-manager__input" name="model" value="${escapeHtml(profile.model)}" placeholder="例如：claude-3-7-sonnet">
                    </label>
                    <div class="api-profile-manager__field api-profile-manager__field--full">
                        <span class="api-profile-manager__label">模型拉取与多选</span>
                        <div class="api-profile-manager__secondary-grid">
                            <button class="api-profile-manager__button" type="button" data-action="fetch-models-placeholder">拉取模型</button>
                            <select class="api-profile-manager__select api-profile-manager__select--multiple" name="selectedModels" multiple>
                                ${suggestedModels.length
                                    ? suggestedModels.map(modelName => `<option value="${escapeHtml(modelName)}" ${(profile.selectedModels ?? []).includes(modelName) ? 'selected' : ''}>${escapeHtml(modelName)}</option>`).join('')
                                    : '<option disabled>这里会显示可多选模型</option>'}
                            </select>
                        </div>
                        <span class="api-profile-manager__field-note">如果你已经多选了模型，保存时会直接生成同组下的多个模型配置。</span>
                    </label>
                </div>
            </form>
            <div class="api-profile-manager__secondary-actions">
                <button class="api-profile-manager__button" data-action="save-profile">保存</button>
                <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="save-and-apply">保存并启用</button>
                ${profile.name || profile.groupName || profile.baseUrl ? `<button class="api-profile-manager__button api-profile-manager__button--danger" data-action="delete-profile" data-profile-id="${profile.id}">删除配置</button>` : ''}
            </div>
        </section>
    `;
}

function renderToolsView() {
    const settings = getSettings();
    return `
        <section class="api-profile-manager__tools">
            <div class="api-profile-manager__section-head">
                <div>
                    <h3 class="api-profile-manager__section-title">工具与备份</h3>
                    <p class="api-profile-manager__section-subtitle">低频功能放在这里，首页只保留常用操作。</p>
                </div>
                <button class="api-profile-manager__button" data-action="back-home">返回首页</button>
            </div>
            <div class="api-profile-manager__tools-card">
                <h4 class="api-profile-manager__tools-title">数据操作</h4>
                <p class="api-profile-manager__tools-note">支持导入、明文导出和加密导出。加密导出只保护备份文件，不会把 SillyTavern 当前存储变成真正保险箱。</p>
                <div class="api-profile-manager__tool-actions">
                    <button class="api-profile-manager__button" data-action="import">导入备份</button>
                    <button class="api-profile-manager__button" data-action="export-plain">导出 JSON</button>
                    <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="export-encrypted">加密导出</button>
                </div>
            </div>
            <div class="api-profile-manager__tools-card">
                <h4 class="api-profile-manager__tools-title">显示偏好</h4>
                <label class="api-profile-manager__checkbox">
                    <input type="checkbox" data-action="toggle-mask-default" ${settings.preferences.maskKeysByDefault ? 'checked' : ''}>
                    <span>默认隐藏密钥</span>
                </label>
            </div>
        </section>
    `;
}

function renderContent() {
    switch (uiState.view) {
        case 'group':
            return renderGroupView();
        case 'editor':
            return renderEditorView();
        case 'tools':
            return renderToolsView();
        default:
            return renderHomeView();
    }
}

function renderSheet() {
    return `
        <section class="api-profile-manager__sheet api-profile-manager__sheet--popup" aria-label="API管家面板">
            <div class="api-profile-manager__grabber"></div>
            <header class="api-profile-manager__hero">
                <div>
                    <p class="api-profile-manager__eyebrow">API管家</p>
                    <h2 class="api-profile-manager__title">${uiState.view === 'home' ? '接口配置首页' : uiState.view === 'group' ? '分组详情' : uiState.view === 'tools' ? '工具与备份' : '配置编辑'}</h2>
                    <p class="api-profile-manager__subtitle">方便保存多个 API 配置、分组整理同地址多模型，并快速切换到你想用的方案。</p>
                    <div class="api-profile-manager__status-bar ${uiState.statusType === 'error' ? 'is-error' : 'is-success'}">${escapeHtml(uiState.status)}</div>
                </div>
                <div class="api-profile-manager__hero-actions">
                    <span class="api-profile-manager__pill">${escapeHtml(getActiveProfile()?.name || '未启用')}</span>
                    <button class="api-profile-manager__sheet-close" data-action="close-panel" aria-label="关闭面板">×</button>
                </div>
            </header>
            <div class="api-profile-manager__content">${renderContent()}</div>
            <footer class="api-profile-manager__footer">
                <div class="api-profile-manager__inline-actions">
                    <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="new-profile">新建配置</button>
                    <button class="api-profile-manager__button" data-action="open-tools">工具</button>
                    <button class="api-profile-manager__button api-profile-manager__button--ghost" data-action="close-panel">关闭</button>
                </div>
            </footer>
        </section>
    `;
}

function renderLauncher() {
    return `
        <div class="api-profile-manager__launcher-bar" aria-label="API管家入口">
            <span class="api-profile-manager__launcher-title">API管家</span>
            <button class="api-profile-manager__launcher-button" data-action="open-panel" type="button" aria-label="打开 API管家">
                <span class="api-profile-manager__fab-icon">API</span>
                <span>打开</span>
            </button>
        </div>
    `;
}

function ensureInlineRoot() {
    if (dom.root instanceof HTMLElement && dom.root.isConnected) {
        return dom.root;
    }

    const existing = document.getElementById('api_profile_manager_root');
    if (existing instanceof HTMLElement) {
        dom.root = existing;
        return existing;
    }

    const target = getMountTarget();
    if (!(target instanceof HTMLElement)) {
        return null;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'api_profile_manager';
    wrapper.className = 'api-profile-manager api-profile-manager--hidden';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.innerHTML = `
        <div id="api_profile_manager_root" class="api-profile-manager__root"></div>
        <input id="api_profile_manager_import_file" type="file" accept="application/json,.json" hidden />
    `;
    target.prepend(wrapper);

    dom.root = wrapper.querySelector('#api_profile_manager_root');
    if (!(dom.importFile instanceof HTMLInputElement) || !dom.importFile.isConnected) {
        dom.importFile = wrapper.querySelector('#api_profile_manager_import_file');
        if (dom.importFile instanceof HTMLInputElement) {
            bindImportInput(dom.importFile);
        }
    }

    return dom.root instanceof HTMLElement ? dom.root : null;
}

function bindSurfaceEvents(surface) {
    if (!(surface instanceof HTMLElement) || surface.dataset.apmBound === 'true') {
        return;
    }

    const handleLauncherTouch = event => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const launcherButton = target.closest('[data-action="open-panel"]');
        if (!(launcherButton instanceof HTMLElement)) {
            return;
        }

        lastLauncherTouchAt = Date.now();
        event.preventDefault();
        event.stopPropagation();
        handleClick(event).catch(error => {
            console.error(`${MODULE_NAME}: touch action failed`, error);
            setStatus(error instanceof Error ? error.message : '操作失败', 'error');
        });
    };

    surface.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            handleLauncherTouch(event);
        }
    });
    surface.addEventListener('touchstart', handleLauncherTouch, { passive: false });
    surface.addEventListener('click', event => {
        const target = event.target;
        if (target instanceof Element && target.closest('[data-action="open-panel"]') && Date.now() - lastLauncherTouchAt < 800) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        handleClick(event).catch(error => {
            console.error(`${MODULE_NAME}: click action failed`, error);
            setStatus(error instanceof Error ? error.message : '操作失败', 'error');
        });
    });
    surface.addEventListener('change', handleChange);
    surface.addEventListener('input', handleInput);
    surface.dataset.apmBound = 'true';
}

function bindImportInput(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.apmBound === 'true') {
        return;
    }

    input.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        try {
            await importPayloadFromFile(file);
        } catch (error) {
            console.error(`${MODULE_NAME}: import failed`, error);
            setStatus(error instanceof Error ? error.message : '导入失败', 'error');
        } finally {
            input.value = '';
            render();
        }
    });
    input.dataset.apmBound = 'true';
}

function render() {
    const root = ensureInlineRoot();

    if (!(root instanceof HTMLElement)) {
        return;
    }

    root.innerHTML = renderLauncher();
    root.classList.remove('is-open');

    bindSurfaceEvents(root);

    if (managerPopup?.dlg?.isConnected) {
        const content = managerPopup.dlg.querySelector('.api-profile-manager__popup-content');
        if (content instanceof HTMLElement) {
            content.innerHTML = renderSheet();
        }
        bindSurfaceEvents(managerPopup.dlg);
    }
}

async function openManagerPopup() {
    setOpen(true);

    const wrapper = document.createElement('div');
    wrapper.className = 'api-profile-manager api-profile-manager__popup-content';
    wrapper.innerHTML = renderSheet();

    managerPopup = new Popup(wrapper, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wider: true,
        large: true,
        transparent: true,
        allowVerticalScrolling: true,
        onClose: () => {
            managerPopup = null;
            setOpen(false);
        },
    });

    bindSurfaceEvents(managerPopup.dlg);
    managerPopup.show().catch(error => {
        console.error(`${MODULE_NAME}: popup show failed`, error);
        setStatus('面板打开失败', 'error');
    });
}

async function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    if (Date.now() - lastLauncherTouchAt < 800) {
        if (target.classList.contains('api-profile-manager__overlay') || !target.closest('[data-action="open-panel"]')) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    }

    if (target.closest('.api-profile-manager__launcher-bar') || target.closest('.api-profile-manager__sheet')) {
        event.stopPropagation();
    }

    if (target.classList.contains('api-profile-manager__overlay')) {
        event.stopPropagation();
        setOpen(false);
        return;
    }

    if (target.closest('.api-profile-manager__sheet') && !target.closest('[data-action]')) {
        return;
    }

    const button = target.closest('[data-action]');
    if (!(button instanceof HTMLElement)) {
        return;
    }

    const action = button.dataset.action;
    const profileId = button.dataset.profileId || '';
    const groupKey = button.dataset.groupKey || '';

    switch (action) {
        case 'open-panel':
            await openManagerPopup();
            break;
        case 'close-panel':
            if (managerPopup) {
                await managerPopup.complete(POPUP_RESULT.CANCELLED);
            } else {
                setOpen(false);
            }
            break;
        case 'open-tools':
            uiState.view = 'tools';
            render();
            break;
        case 'fetch-models-placeholder':
            await fetchModelsForEditor();
            break;
        case 'back-home':
            goHome();
            break;
        case 'open-group':
            openGroup(groupKey);
            break;
        case 'new-profile':
            openEditor('', {});
            break;
        case 'new-profile-in-group': {
            const group = buildGroups().find(item => item.key === groupKey);
            openEditor('', {
                groupName: group?.profiles[0]?.groupName || group?.title || '',
                baseUrl: group?.baseUrl || '',
                mode: group?.profiles[0]?.mode || 'chat-completions',
                provider: group?.profiles[0]?.provider || 'custom',
                headerName: group?.profiles[0]?.headerName || 'Authorization',
            });
            break;
        }
        case 'edit-profile':
            openEditor(profileId);
            break;
        case 'duplicate-profile':
            duplicateProfile(profileId);
            break;
        case 'delete-profile':
            await deleteProfile(profileId || uiState.editingProfileId);
            break;
        case 'apply-profile':
            await applyProfile(profileId);
            break;
        case 'save-profile':
            await saveCurrentEditorProfile({ applyAfterSave: false });
            break;
        case 'save-and-apply':
            await saveCurrentEditorProfile({ applyAfterSave: true });
            break;
        case 'back-from-editor':
            syncEditorDraftFromForm();
            if (uiState.activeGroupKey) {
                uiState.editorDraft = null;
                uiState.view = 'group';
                render();
            } else {
                goHome();
            }
            break;
        case 'toggle-key':
            syncEditorDraftFromForm();
            uiState.revealKey = !uiState.revealKey;
            render();
            break;
        case 'import':
            dom.importFile.click();
            break;
        case 'export-plain':
            await exportPlain();
            break;
        case 'export-encrypted':
            await exportEncrypted();
            break;
        case 'toggle-mask-default': {
            const settings = getSettings();
            const checkbox = button instanceof HTMLInputElement
                ? button
                : managerPopup?.dlg?.querySelector?.('[data-action="toggle-mask-default"]') || dom.root.querySelector('[data-action="toggle-mask-default"]');
            settings.preferences.maskKeysByDefault = checkbox instanceof HTMLInputElement ? checkbox.checked : settings.preferences.maskKeysByDefault;
            persist();
            setStatus(settings.preferences.maskKeysByDefault ? '已设为默认隐藏密钥' : '已设为默认显示密钥');
            break;
        }
        default:
            break;
    }
}

function handleChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
    }

    event.stopPropagation();

    if (uiState.view === 'editor') {
        uiState.editorDraft = readEditorProfile();
    }

    if (target.name === 'mode') {
        const providerSelect = getEditorForm()?.querySelector('select[name="provider"]');
        if (providerSelect instanceof HTMLSelectElement) {
            const options = getProviderOptions(target.value);
            providerSelect.innerHTML = options.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
            if (uiState.editorDraft) {
                uiState.editorDraft.provider = options[0]?.value || uiState.editorDraft.provider;
            }
        }
    }
}

function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
    }

    event.stopPropagation();

    if (uiState.view === 'editor') {
        uiState.editorDraft = readEditorProfile();
    }
}

jQuery(async () => {
    const target = getMountTarget();
    if (!target) {
        console.warn(`${MODULE_NAME}: settings container not found`);
        return;
    }

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings', {});
    target.insertAdjacentHTML('afterbegin', html);

    dom.root = document.getElementById('api_profile_manager_root');
    dom.importFile = document.getElementById('api_profile_manager_import_file');

    if (!(dom.root instanceof HTMLElement) || !(dom.importFile instanceof HTMLInputElement)) {
        console.warn(`${MODULE_NAME}: mount root not found`);
        return;
    }

    bindSurfaceEvents(dom.root);
    bindImportInput(dom.importFile);

    getSettings();
    render();
});
