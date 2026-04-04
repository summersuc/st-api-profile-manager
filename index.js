import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { callGenericPopup, POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { writeSecret } from '../../../secrets.js';

console.log('[APM] local plugin loaded');

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
    groupMetadata: {},
    preferences: {
        maskKeysByDefault: true,
    },
};

const ST_PROVIDER_MAP = {
    custom: { mode: 'chat-completions', provider: 'custom' },
    openai: { mode: 'chat-completions', provider: 'openai' },
    azure_openai: { mode: 'chat-completions', provider: 'azure_openai' },
    generic: { mode: 'text-generation', provider: 'generic' },
    ooba: { mode: 'text-generation', provider: 'ooba' },
    vllm: { mode: 'text-generation', provider: 'vllm' },
    aphrodite: { mode: 'text-generation', provider: 'aphrodite' },
    tabby: { mode: 'text-generation', provider: 'tabby' },
    koboldcpp: { mode: 'text-generation', provider: 'koboldcpp' },
    llamacpp: { mode: 'text-generation', provider: 'llamacpp' },
    ollama: { mode: 'text-generation', provider: 'ollama' },
    huggingface: { mode: 'text-generation', provider: 'huggingface' },
};

const MODE_OPTIONS = [
    { value: 'chat-completions', label: '聊天补全' },
    { value: 'text-generation', label: '文本生成' },
];

const PROVIDER_OPTIONS = {
    'chat-completions': [
        { value: 'openai', label: 'OpenAI' },
        { value: 'custom', label: '自定义（兼容 OpenAI）' },
        { value: 'ai21', label: 'AI21' },
        { value: 'claude', label: 'Claude' },
        { value: 'openrouter', label: 'OpenRouter' },
        { value: 'makersuite', label: 'Google AI Studio' },
        { value: 'vertexai', label: 'Vertex AI' },
        { value: 'mistralai', label: 'Mistral AI' },
        { value: 'cohere', label: 'Cohere' },
        { value: 'perplexity', label: 'Perplexity' },
        { value: 'groq', label: 'Groq' },
        { value: 'azure_openai', label: 'Azure OpenAI' },
        { value: 'electronhub', label: 'ElectronHub' },
        { value: 'chutes', label: 'Chutes' },
        { value: 'nanogpt', label: 'nanoGPT' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'aimlapi', label: 'AIML API' },
        { value: 'xai', label: 'xAI / Grok' },
        { value: 'pollinations', label: 'Pollinations' },
        { value: 'moonshot', label: 'Moonshot' },
        { value: 'fireworks', label: 'Fireworks' },
        { value: 'cometapi', label: 'CometAPI' },
        { value: 'zai', label: 'Z.AI' },
        { value: 'siliconflow', label: 'SiliconFlow' },
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
        modelSelector: ['#custom_model_id', '#model_custom_select'],
        connectButton: '#api_button_openai',
    },
    openai: {
        secretKey: 'api_key_openai',
        sourceSelector: '#chat_completion_source',
        sourceValue: 'openai',
        modelSelector: '#model_openai_select',
        connectButton: '#api_button_openai',
    },
    azure_openai: {
        secretKey: 'api_key_azure_openai',
        sourceSelector: '#chat_completion_source',
        sourceValue: 'azure_openai',
        urlSelector: '#azure_base_url',
        modelSelector: '#model_azure_openai_select',
        connectButton: '#api_button_openai',
    },
};

const TEXT_PROVIDER_CONFIG = {
    generic: { secretKey: 'api_key_generic', typeSelector: '#textgen_type', typeValue: 'generic', urlSelector: '#generic_api_url_text', modelSelector: '#generic_model', connectButton: '#api_button_textgenerationwebui' },
    ooba: { secretKey: 'api_key_ooba', typeSelector: '#textgen_type', typeValue: 'ooba', urlSelector: '#textgenerationwebui_api_url_text', connectButton: '#api_button_textgenerationwebui' },
    vllm: { secretKey: 'api_key_vllm', typeSelector: '#textgen_type', typeValue: 'vllm', urlSelector: '#vllm_api_url_text', modelSelector: '#vllm_model', connectButton: '#api_button_textgenerationwebui' },
    aphrodite: { secretKey: 'api_key_aphrodite', typeSelector: '#textgen_type', typeValue: 'aphrodite', urlSelector: '#aphrodite_api_url_text', modelSelector: '#aphrodite_model', connectButton: '#api_button_textgenerationwebui' },
    tabby: { secretKey: 'api_key_tabby', typeSelector: '#textgen_type', typeValue: 'tabby', urlSelector: '#tabby_api_url_text', modelSelector: '#tabby_model', connectButton: '#api_button_textgenerationwebui' },
    koboldcpp: { secretKey: 'api_key_koboldcpp', typeSelector: '#textgen_type', typeValue: 'koboldcpp', connectButton: '#api_button_textgenerationwebui' },
    llamacpp: { secretKey: 'api_key_llamacpp', typeSelector: '#textgen_type', typeValue: 'llamacpp', urlSelector: '#llamacpp_api_url_text', modelSelector: '#llamacpp_model', connectButton: '#api_button_textgenerationwebui' },
    ollama: { typeSelector: '#textgen_type', typeValue: 'ollama', urlSelector: '#ollama_api_url_text', modelSelector: '#ollama_model', connectButton: '#api_button_textgenerationwebui' },
    huggingface: { secretKey: 'api_key_huggingface', typeSelector: '#textgen_type', typeValue: 'huggingface', connectButton: '#api_button_textgenerationwebui' },
};

const dom = {};

const uiState = {
    isOpen: false,
    view: 'home',
    activeGroupKey: '',
    expandedModelRows: {},
    editingProfileId: '',
    editorDraft: null,
    fetchedModels: [],
    modelPickerQuery: '',
    isModelPickerOpen: false,
    selectedModelQuery: '',
    isSelectedModelPanelOpen: false,
    pickerPanelScrollTop: 0,
    status: '就绪',
    statusType: 'success',
    revealKey: false,
    isLightMode: false,
};

let lastLauncherTouchAt = 0;
let managerPopup = null;

async function fetchJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            ...getRequestHeaders(),
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
    settings.groupMetadata ??= {};
    settings.preferences ??= clone(DEFAULT_SETTINGS.preferences);
    settings.preferences.maskKeysByDefault ??= true;
    settings.profiles = settings.profiles.map(profile => ({ ...defaultProfile(), ...profile, id: profile.id || crypto.randomUUID() }));
    return settings;
}

function getStContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

async function getConnectionProfilesFromHost() {
    const context = getStContext();
    const directProfiles = context?.extensionSettings?.connectionManager?.profiles;
    if (Array.isArray(directProfiles)) {
        return directProfiles;
    }

    const executeSlashCommandsWithOptions = context?.executeSlashCommandsWithOptions;
    if (typeof executeSlashCommandsWithOptions !== 'function') {
        return [];
    }

    const listResult = await executeSlashCommandsWithOptions('/profile-list');
    const profileNames = JSON.parse(String(listResult?.pipe ?? '[]'));
    if (!Array.isArray(profileNames) || !profileNames.length) {
        return [];
    }

    const details = [];
    for (const name of profileNames) {
        const result = await executeSlashCommandsWithOptions(`/profile-get ${JSON.stringify(String(name))}`);
        const parsed = JSON.parse(String(result?.pipe ?? '{}'));
        if (parsed && typeof parsed === 'object') {
            details.push(parsed);
        }
    }
    return details;
}

function parseStConnectionProfileContext(rawProfile) {
    const source = normalizeText(rawProfile?.api || rawProfile?.source || rawProfile?.api_source || rawProfile?.api_type || rawProfile?.type);
    const mode = rawProfile?.mode === 'tc' ? 'text-generation' : 'chat-completions';
    const mapped = ST_PROVIDER_MAP[source] ?? { mode, provider: mode === 'text-generation' ? 'generic' : 'custom' };
    return {
        name: normalizeText(rawProfile?.name) || '未命名连接配置',
        source,
        mode,
        mapped,
    };
}

function mapStConnectionProfileToPluginProfileFromLiveValues(rawProfile, liveValues) {
    const { name, mapped } = parseStConnectionProfileContext(rawProfile);
    const model = normalizeText(liveValues.model || rawProfile?.model);
    const baseUrl = normalizeText(liveValues.baseUrl);
    const apiKey = String(liveValues.apiKey ?? '');

    if (!baseUrl && !apiKey && !model) {
        return null;
    }

    const timestamp = new Date().toISOString();
    return {
        ...defaultProfile(),
        id: crypto.randomUUID(),
        groupName: name,
        mode: mapped.mode,
        provider: mapped.provider,
        name: model || name,
        model,
        selectedModels: model ? [model] : [],
        baseUrl,
        apiKey,
        createdAt: timestamp,
        updatedAt: timestamp,
        notes: '从 SillyTavern Connection Profiles 导入',
    };
}

function getHostControlsForProfile(rawProfile) {
    const { mapped } = parseStConnectionProfileContext(rawProfile);
    const config = getProviderConfig({ mode: mapped.mode, provider: mapped.provider });
    return {
        mapped,
        config,
        keySelector: config?.secretKey ? `#${config.secretKey}` : '',
    };
}

function readLiveHostValuesForProfile(rawProfile) {
    const { config, keySelector } = getHostControlsForProfile(rawProfile);
    return {
        baseUrl: config?.urlSelector ? readControlValue(config.urlSelector) || '' : '',
        apiKey: keySelector ? readControlValue(keySelector) || '' : '',
        model: config?.modelSelector ? readControlValue(asSelectorList(config.modelSelector)[0]) || '' : '',
    };
}

function buildImportedProfiles(profilesWithValues) {
    return profilesWithValues
        .map(({ rawProfile, liveValues }) => mapStConnectionProfileToPluginProfileFromLiveValues(rawProfile, liveValues))
        .filter(Boolean);
}

async function switchToConnectionProfile(profileName) {
    const context = getStContext();
    const executeSlashCommandsWithOptions = context?.executeSlashCommandsWithOptions;
    if (typeof executeSlashCommandsWithOptions !== 'function') {
        throw new Error('当前 SillyTavern 环境不支持程序化切换 Connection Profile');
    }

    await executeSlashCommandsWithOptions(`/profile ${JSON.stringify(String(profileName))}`);
    await sleep(320);
}

async function getCurrentConnectionProfileName() {
    const context = getStContext();
    const executeSlashCommandsWithOptions = context?.executeSlashCommandsWithOptions;
    if (typeof executeSlashCommandsWithOptions !== 'function') {
        return '';
    }

    const result = await executeSlashCommandsWithOptions('/profile');
    return normalizeText(result?.pipe);
}

function resetPanelTransientState() {
    uiState.fetchedModels = [];
    uiState.modelPickerQuery = '';
    uiState.isModelPickerOpen = false;
    uiState.selectedModelQuery = '';
    uiState.isSelectedModelPanelOpen = false;
    uiState.pickerPanelScrollTop = 0;
}

async function collectImportedProfilesFromHostProfiles(hostProfiles) {
    const originalProfileName = await getCurrentConnectionProfileName();
    const collectedValues = [];

    try {
        for (const rawProfile of hostProfiles) {
            const profileName = normalizeText(rawProfile?.name);
            if (!profileName) {
                continue;
            }

            await switchToConnectionProfile(profileName);
            collectedValues.push({
                rawProfile,
                liveValues: readLiveHostValuesForProfile(rawProfile),
            });
        }
    } finally {
        if (originalProfileName) {
            try {
                await switchToConnectionProfile(originalProfileName);
            } catch (error) {
                console.warn(`${MODULE_NAME}: failed to restore original connection profile`, error);
            }
        }
    }

    return buildImportedProfiles(collectedValues);
}

async function importStConnectionProfiles() {
    try {
        setStatus('正在读取 SillyTavern Connection Profiles…');
        const hostProfiles = await getConnectionProfilesFromHost();
        if (!hostProfiles.length) {
            setStatus('没有读取到 SillyTavern Connection Profiles', 'error');
            return;
        }

        setStatus('正在逐个读取连接配置的 URL / 密钥 / 模型…');
        const importedProfiles = await collectImportedProfilesFromHostProfiles(hostProfiles);
        if (!importedProfiles.length) {
            setStatus('读取到了 Connection Profiles，但没有可导入的 URL / 密钥 / 模型配置', 'error');
            return;
        }

        for (const profile of importedProfiles) {
            upsertProfile(profile);
        }

        ensureGroupMetadata();
        persist();
        goHome();
        const missingKeyCount = importedProfiles.filter(profile => !normalizeText(profile.apiKey)).length;
        setStatus(missingKeyCount
            ? `已导入 ${importedProfiles.length} 条连接配置，其中 ${missingKeyCount} 条需要手动补充 API Key`
            : `已从 SillyTavern 导入 ${importedProfiles.length} 条连接配置`);
    } catch (error) {
        console.error(`${MODULE_NAME}: import ST connection profiles failed`, error);
        const message = error instanceof Error ? error.message : '导入 ST 连接配置失败';
        setStatus(`导入失败：${message}`, 'error');
    }
}

function getGroupMetadata(groupKey) {
    const settings = getSettings();
    settings.groupMetadata ??= {};
    settings.groupMetadata[groupKey] ??= { pinned: false, order: Number.MAX_SAFE_INTEGER };
    return settings.groupMetadata[groupKey];
}

function ensureGroupMetadata() {
    const settings = getSettings();
    const groups = Array.from(new Set(getProfiles().map(profile => getGroupKey(profile))));
    let nextOrder = 0;
    for (const groupKey of groups) {
        const metadata = getGroupMetadata(groupKey);
        if (!Number.isFinite(metadata.order) || metadata.order === Number.MAX_SAFE_INTEGER) {
            metadata.order = nextOrder;
        }
        nextOrder = Math.max(nextOrder, metadata.order + 1);
    }

    for (const existingKey of Object.keys(settings.groupMetadata)) {
        if (!groups.includes(existingKey)) {
            delete settings.groupMetadata[existingKey];
        }
    }
}

function moveGroup(groupKey, direction) {
    ensureGroupMetadata();
    const groups = buildGroups();
    const currentIndex = groups.findIndex(group => group.key === groupKey);
    if (currentIndex === -1) {
        return;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= groups.length) {
        return;
    }

    const settings = getSettings();
    const currentMetadata = getGroupMetadata(groups[currentIndex].key);
    const targetMetadata = getGroupMetadata(groups[targetIndex].key);
    const currentOrder = currentMetadata.order;
    currentMetadata.order = targetMetadata.order;
    targetMetadata.order = currentOrder;
    settings.groupMetadata[groups[currentIndex].key] = currentMetadata;
    settings.groupMetadata[groups[targetIndex].key] = targetMetadata;
    persist();
    render();
}

function toggleGroupPinned(groupKey) {
    const metadata = getGroupMetadata(groupKey);
    metadata.pinned = !metadata.pinned;
    persist();
    render();
}

async function renameGroup(groupKey) {
    const group = findGroup(groupKey);
    if (!group) {
        setStatus('没有找到要修改的分组', 'error');
        return;
    }

    const nextName = await callGenericPopup('请输入新的分组名称', POPUP_TYPE.INPUT, group.title);
    const normalizedName = normalizeText(nextName);
    if (!normalizedName || normalizedName === group.title) {
        return;
    }

    const settings = getSettings();
    settings.profiles = settings.profiles.map(profile => getGroupKey(profile) === group.key
        ? { ...profile, groupName: normalizedName, updatedAt: new Date().toISOString() }
        : profile);

    if (settings.groupMetadata?.[group.key]) {
        const metadata = settings.groupMetadata[group.key];
        delete settings.groupMetadata[group.key];
        settings.groupMetadata[getGroupKey({ groupName: normalizedName, baseUrl: group.baseUrl })] = metadata;
    }

    persist();
    render();
    setStatus(`已将分组改名为「${normalizedName}」`);
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
    ensureGroupMetadata();
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
            metadata: getGroupMetadata(group.key),
            profiles: group.profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        }))
        .sort((a, b) => {
            if (Boolean(a.metadata?.pinned) !== Boolean(b.metadata?.pinned)) {
                return a.metadata?.pinned ? -1 : 1;
            }

            const orderDiff = (a.metadata?.order ?? Number.MAX_SAFE_INTEGER) - (b.metadata?.order ?? Number.MAX_SAFE_INTEGER);
            if (orderDiff !== 0) {
                return orderDiff;
            }

            return a.title.localeCompare(b.title, 'zh-CN');
        });
}

function getActiveProfile() {
    return getProfileById(getSettings().activeProfileId);
}

function getCurrentGroup() {
    return buildGroups().find(group => group.key === uiState.activeGroupKey) ?? null;
}

function findGroup(groupKey) {
    return buildGroups().find(group => group.key === normalizeText(groupKey)) ?? null;
}

function getSuggestedModels(profile) {
    const currentProfile = profile ?? getEditingProfile() ?? defaultProfile();
    if (!normalizeText(currentProfile.baseUrl)) {
        return Array.from(new Set([...(currentProfile.selectedModels ?? []), normalizeText(currentProfile.model)].map(normalizeText).filter(Boolean)));
    }

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
        chat_completion_source: profile.provider,
    };

    const proxyBackedSources = new Set(['openai', 'mistralai', 'makersuite', 'vertexai', 'deepseek', 'xai', 'moonshot']);

    if (proxyBackedSources.has(profile.provider) && normalizeText(profile.baseUrl)) {
        payload.reverse_proxy = profile.baseUrl;
        if (String(profile.apiKey ?? '')) {
            payload.proxy_password = String(profile.apiKey ?? '');
        }
    }

    if (profile.provider === 'custom') {
        payload.custom_url = profile.baseUrl;
    }

    if (profile.provider === 'azure_openai') {
        payload.azure_base_url = profile.baseUrl;
        payload.azure_deployment_name = '';
        payload.azure_api_version = '2024-02-15-preview';
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
        uiState.fetchedModels = [];
        setStatus('请先填写 API URL', 'error');
        return;
    }

    const providerConfig = getProviderConfig(profile);
    if (!providerConfig) {
        uiState.editorDraft = profile;
        uiState.fetchedModels = [];
        setStatus('当前数据来源暂未接入一键拉取模型，请先手动填写模型 ID', 'error');
        return;
    }

    const { url, payload } = getFetchModelsPayload(profile);
    setStatus('正在拉取模型列表…');

    try {
        const responseData = await fetchJson(url, payload);
        const models = normalizeFetchedModels(responseData);

        if (!models.length) {
            uiState.fetchedModels = [];
            setStatus('没有获取到模型列表，请检查当前来源、密钥和接口地址', 'error');
            return;
        }

        uiState.fetchedModels = models;
        uiState.editorDraft = {
            ...profile,
            selectedModels: Array.from(new Set([...(profile.selectedModels ?? [])])),
        };
        uiState.modelPickerQuery = '';
        uiState.isModelPickerOpen = true;
        setStatus(`已拉取 ${models.length} 个模型`);
        render();
    } catch (error) {
        uiState.fetchedModels = [];
        console.error(`${MODULE_NAME}: fetch models failed`, error);
        const message = error instanceof Error ? error.message : '拉取模型失败';
        const friendlyMessage = /Forbidden/i.test(message)
            ? '拉取失败：SillyTavern 拒绝了这次请求，请先确认当前页面已登录且本地接口允许状态检查'
            : `拉取失败：${message}`;
        setStatus(friendlyMessage, 'error');
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
        uiState.expandedModelRows = {};
        uiState.editorDraft = null;
        resetPanelTransientState();
        uiState.revealKey = false;
    }
    render();
}

function goHome() {
    syncEditorDraftFromForm();
    uiState.view = 'home';
    uiState.activeGroupKey = '';
    uiState.editingProfileId = '';
    uiState.expandedModelRows = {};
    uiState.editorDraft = null;
    resetPanelTransientState();
    uiState.revealKey = !getSettings().preferences.maskKeysByDefault;
    render();
}

function openGroup(groupKey) {
    uiState.activeGroupKey = groupKey;
    uiState.view = 'home';
    render();
}

function openEditor(profileId = '', preset = {}) {
    const existing = profileId ? getProfileById(profileId) : null;
    const next = { ...defaultProfile(), ...preset, ...(existing ?? {}) };
    uiState.editingProfileId = next.id;
    uiState.editorDraft = next;
    uiState.view = 'editor';
    resetPanelTransientState();
    uiState.revealKey = !getSettings().preferences.maskKeysByDefault;

    render();
}

function getProviderConfig(profile) {
    return profile.mode === 'text-generation'
        ? TEXT_PROVIDER_CONFIG[profile.provider] ?? null
        : CHAT_PROVIDER_CONFIG[profile.provider] ?? null;
}

function asSelectorList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function sleep(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function waitForCondition(checker, { timeout = 1200, interval = 50 } = {}) {
    const deadline = Date.now() + timeout;

    while (Date.now() <= deadline) {
        if (checker()) {
            return true;
        }
        await sleep(interval);
    }

    return checker();
}

function getWritableControl(selector) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return element;
    }
    return null;
}

function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
        return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
        return false;
    }

    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true' || element.disabled) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function getFirstWritableControl(selectors) {
    for (const selector of asSelectorList(selectors)) {
        const element = getWritableControl(selector);
        if (element && isElementVisible(element)) {
            return { selector, element };
        }
    }

    for (const selector of asSelectorList(selectors)) {
        const element = getWritableControl(selector);
        if (element) {
            return { selector, element };
        }
    }

    return { selector: '', element: null };
}

function describeControl(selectors) {
    const selectorList = asSelectorList(selectors);
    const { selector, element } = getFirstWritableControl(selectorList);
    return {
        selectors: selectorList,
        matchedSelector: selector || null,
        tagName: element?.tagName ?? null,
        visible: element ? isElementVisible(element) : false,
        value: element ? String(element.value ?? '') : null,
    };
}

function setNativeValue(element, value) {
    const nextValue = String(value ?? '');

    if (element instanceof HTMLInputElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor?.set?.call(element, nextValue);
        return;
    }

    if (element instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        descriptor?.set?.call(element, nextValue);
        return;
    }

    if (element instanceof HTMLSelectElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        descriptor?.set?.call(element, nextValue);
    }
}

function readControlValue(selector) {
    const element = getWritableControl(selector);
    return element ? String(element.value ?? '') : null;
}

async function waitForControlValue(selector, expectedValue, options) {
    return await waitForCondition(() => readControlValue(selector) === String(expectedValue ?? ''), options);
}

async function waitForControl(selector, options) {
    return await waitForCondition(() => getWritableControl(selector) !== null, options);
}

async function waitForAnyControl(selectors, options) {
    const selectorList = asSelectorList(selectors);
    if (!selectorList.length) {
        return false;
    }

    return await waitForCondition(() => selectorList.some(selector => {
        const element = getWritableControl(selector);
        return element !== null && isElementVisible(element);
    }), options);
}

async function waitForSelectControl(selector, options) {
    return await waitForCondition(() => {
        const element = document.querySelector(selector);
        return element instanceof HTMLSelectElement && isElementVisible(element);
    }, options);
}

async function setInputValue(selectors, value) {
    const nextValue = String(value ?? '');

    const { selector, element } = getFirstWritableControl(selectors);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return false;
    }

    element.focus();
    setNativeValue(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));

    return await waitForControlValue(selector, nextValue, { timeout: 2400 });
}

async function setSelectValue(selector, value) {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLSelectElement)) {
        return false;
    }

    const nextValue = String(value ?? '');
    const hasOption = Array.from(element.options).some(option => option.value === nextValue);
    if (!hasOption) {
        return false;
    }

    element.focus();
    setNativeValue(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));

    return await waitForControlValue(selector, nextValue);
}

function clickElement(selector) {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
        return false;
    }
    element.click();
    return true;
}

async function applyModelToControl(selector, model) {
    const selectors = asSelectorList(selector);
    if (!selectors.length || !normalizeText(model)) {
        return false;
    }

    const { selector: matchedSelector, element } = getFirstWritableControl(selectors);
    if (element instanceof HTMLSelectElement) {
        const hasOption = Array.from(element.options).some(option => option.value === model);
        if (!hasOption) {
            return false;
        }

        element.focus();
        setNativeValue(element, model);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return await waitForControlValue(matchedSelector, model, { timeout: 2400 });
    }

    if (element instanceof HTMLInputElement) {
        element.focus();
        setNativeValue(element, model);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return await waitForControlValue(matchedSelector, model, { timeout: 2400 });
    }

    return false;
}

async function verifyModelApplied(selector, model) {
    const selectors = asSelectorList(selector);
    if (!selectors.length || !normalizeText(model)) {
        return false;
    }

    return await waitForCondition(() => {
        const { element } = getFirstWritableControl(selectors);
        return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
            ? String(element.value ?? '') === String(model)
            : false;
    }, { timeout: 2400, interval: 80 });
}

function getApplyTarget(profile, config) {
    return {
        mainApiValue: profile.mode === 'text-generation' ? 'textgenerationwebui' : 'openai',
        stageOneSelector: config.sourceSelector || config.typeSelector || '',
        stageOneValue: config.sourceValue || config.typeValue || '',
    };
}

function logApplyContext(logPrefix, profile, config, applyTarget) {
    console.groupCollapsed(`${logPrefix} start ${profile.name || profile.model || profile.id}`);
    console.log(`${logPrefix} profile`, {
        id: profile.id,
        name: profile.name,
        mode: profile.mode,
        provider: profile.provider,
        model: profile.model,
        baseUrl: profile.baseUrl,
    });
    console.log(`${logPrefix} config`, {
        mainApiValue: applyTarget.mainApiValue,
        stageOneSelector: applyTarget.stageOneSelector,
        stageOneValue: applyTarget.stageOneValue,
        urlSelector: config.urlSelector ?? null,
        modelSelector: asSelectorList(config.modelSelector),
        secretSelector: config.secretKey ? `#${config.secretKey}` : null,
        connectButton: config.connectButton ?? null,
    });
}

function abortApply(logPrefix, detail) {
    console.warn(`${logPrefix} abort: ${detail}`);
    console.groupEnd();
}

async function applyMainApi(logPrefix, applyTarget) {
    const mainApiApplied = await setSelectValue('#main_api', applyTarget.mainApiValue);
    console.log(`${logPrefix} main api`, {
        applied: mainApiApplied,
        currentValue: readControlValue('#main_api'),
    });
    return mainApiApplied;
}

async function applyStageOne(logPrefix, applyTarget) {
    const stageOneReady = applyTarget.stageOneSelector
        ? await waitForSelectControl(applyTarget.stageOneSelector, { timeout: 2400, interval: 80 })
        : false;
    console.log(`${logPrefix} stage-one ready`, {
        ready: stageOneReady,
        selector: applyTarget.stageOneSelector,
        control: describeControl(applyTarget.stageOneSelector),
    });

    if (!stageOneReady) {
        return { ready: false, applied: false, stable: false };
    }

    await sleep(120);
    const sourceApplied = applyTarget.stageOneSelector && applyTarget.stageOneValue
        ? await setSelectValue(applyTarget.stageOneSelector, applyTarget.stageOneValue)
        : false;
    console.log(`${logPrefix} stage-one apply`, {
        applied: sourceApplied,
        selector: applyTarget.stageOneSelector,
        expectedValue: applyTarget.stageOneValue,
        currentValue: readControlValue(applyTarget.stageOneSelector),
    });

    if (!sourceApplied) {
        return { ready: true, applied: false, stable: false };
    }

    const stageOneStable = await waitForCondition(() => readControlValue(applyTarget.stageOneSelector) === String(applyTarget.stageOneValue), {
        timeout: 2400,
        interval: 80,
    });
    console.log(`${logPrefix} stage-one stable`, {
        stable: stageOneStable,
        selector: applyTarget.stageOneSelector,
        currentValue: readControlValue(applyTarget.stageOneSelector),
    });

    return { ready: true, applied: true, stable: stageOneStable };
}

async function waitForApplyControls(config, logPrefix) {
    await sleep(220);
    const controlsToWaitFor = [
        config.urlSelector,
        config.modelSelector,
        config.secretKey ? `#${config.secretKey}` : '',
    ].filter(Boolean);

    const readiness = await Promise.all(controlsToWaitFor.map(selector => waitForAnyControl(selector, { timeout: 2400, interval: 80 })));
    console.log(`${logPrefix} dependent controls`, controlsToWaitFor.map((selector, index) => ({
        target: selector,
        ready: readiness[index],
        control: describeControl(selector),
    })));

    return readiness.every(Boolean);
}

async function writeApplyFields(profile, config, logPrefix) {
    const urlApplied = config.urlSelector ? await setInputValue([config.urlSelector], profile.baseUrl) : true;
    const visibleKeyApplied = config.secretKey ? await setInputValue([`#${config.secretKey}`], profile.apiKey) : true;
    let modelApplied = config.modelSelector ? await applyModelToControl(config.modelSelector, profile.model) : true;
    console.log(`${logPrefix} field writes`, {
        urlApplied,
        urlControl: config.urlSelector ? describeControl(config.urlSelector) : null,
        keyApplied: visibleKeyApplied,
        keyControl: config.secretKey ? describeControl([`#${config.secretKey}`]) : null,
        modelApplied,
        modelControl: config.modelSelector ? describeControl(config.modelSelector) : null,
    });

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
    console.log(`${logPrefix} connect`, {
        triggered: connectTriggered,
        button: config.connectButton ?? null,
    });

    if (!modelApplied && config.modelSelector && connectTriggered) {
        await sleep(300);
        modelApplied = await applyModelToControl(config.modelSelector, profile.model);
        console.log(`${logPrefix} model retry after connect`, {
            modelApplied,
            modelControl: describeControl(config.modelSelector),
        });
    }

    if (modelApplied && config.modelSelector) {
        modelApplied = await verifyModelApplied(config.modelSelector, profile.model);
        console.log(`${logPrefix} model verify`, {
            modelApplied,
            modelControl: describeControl(config.modelSelector),
        });
    }

    return { urlApplied, visibleKeyApplied, secretApplied, modelApplied, connectTriggered };
}

function finalizeApply(profile, result) {
    const settings = getSettings();
    settings.activeProfileId = profile.id;
    persist();

    const parts = [
        result.mainApiApplied ? '连接方式' : null,
        result.sourceApplied ? '来源' : null,
        result.urlApplied ? '地址' : null,
        result.secretApplied || result.visibleKeyApplied ? '密钥' : null,
        result.modelApplied ? '模型' : null,
        result.connectTriggered ? '连接' : null,
    ].filter(Boolean);
    const detail = parts.length ? `（已写入：${parts.join('、')}）` : '';
    setStatus(`已启用「${profile.name}」${detail}`);
    if (typeof toastr !== 'undefined' && typeof toastr.success === 'function') {
        toastr.success(`已启用「${profile.name}」`, 'API 管家');
    }
    render();
}

function validateProfile(profile) {
    if (!profile.mode || !PROVIDER_OPTIONS[profile.mode]) {
        return '请选择连接方式';
    }

    if (!normalizeText(profile.groupName)) {
        return '请填写分组名称';
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
    base.model = normalizeText(formData.get('model'));
    base.selectedModels = formData.getAll('selectedModels').map(value => normalizeText(value)).filter(Boolean);
    base.baseUrl = normalizeText(formData.get('baseUrl')).replace(/\/+$/u, '');
    base.apiKey = String(formData.get('apiKey') ?? '');
    base.headerName = 'Authorization';
    base.headerValue = '';
    base.notes = '';
    base.name = base.model || base.name || base.baseUrl;
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
        const resolvedName = modelName;
        const nextProfile = {
            ...clone(profile),
            id: primaryProfile ? crypto.randomUUID() : profile.id,
            name: resolvedName,
            model: modelName,
            selectedModels: modelsToSave,
            groupName: profile.groupName,
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
    setStatus(applyAfterSave
        ? `已保存并准备启用「${primaryProfile?.model || primaryProfile?.name || profile.model || profile.name}」`
        : `已保存 ${modelsToSave.length} 个模型配置`);

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

    const confirmed = await callGenericPopup(`删除配置「${profile.model || profile.name}」后无法恢复，是否继续？`, POPUP_TYPE.CONFIRM, '');
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
        name: `${profile.model || profile.name} 副本`,
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

    const logPrefix = '[APM][apply]';
    const applyTarget = getApplyTarget(profile, config);
    logApplyContext(logPrefix, profile, config, applyTarget);

    const mainApiApplied = await applyMainApi(logPrefix, applyTarget);
    if (!mainApiApplied) {
        abortApply(logPrefix, 'main api switch failed');
        setStatus('应用未完成：无法切换 SillyTavern 当前 API 连接方式', 'error');
        return;
    }

    const stageOneResult = await applyStageOne(logPrefix, applyTarget);
    if (!stageOneResult.ready) {
        abortApply(logPrefix, 'stage-one control not ready');
        setStatus('应用未完成：切换连接方式后，SillyTavern 的来源 / 类型控件还没有准备好', 'error');
        return;
    }

    if (!stageOneResult.applied) {
        abortApply(logPrefix, 'stage-one apply failed');
        setStatus('应用未完成：无法切换 SillyTavern 当前来源 / 类型', 'error');
        return;
    }

    if (!stageOneResult.stable) {
        abortApply(logPrefix, 'stage-one not stable');
        setStatus('应用未完成：SillyTavern 当前来源 / 类型还没有稳定切换完成', 'error');
        return;
    }

    const allControlsReady = await waitForApplyControls(config, logPrefix);
    if (!allControlsReady) {
        abortApply(logPrefix, 'dependent controls not ready');
        setStatus('应用未完成：切换来源后，SillyTavern 的目标控件还没有准备好', 'error');
        return;
    }

    const fieldResult = await writeApplyFields(profile, config, logPrefix);
    const requiredApplied = mainApiApplied
        && stageOneResult.applied
        && fieldResult.urlApplied
        && fieldResult.modelApplied;
    console.log(`${logPrefix} final`, {
        requiredApplied,
        mainApiApplied,
        sourceApplied: stageOneResult.applied,
        urlApplied: fieldResult.urlApplied,
        keyApplied: fieldResult.visibleKeyApplied || fieldResult.secretApplied,
        modelApplied: fieldResult.modelApplied,
        activeProfileWillUpdate: requiredApplied,
    });

    if (requiredApplied) {
        finalizeApply(profile, {
            mainApiApplied,
            sourceApplied: stageOneResult.applied,
            ...fieldResult,
        });
        console.groupEnd();
    } else {
        abortApply(logPrefix, 'required fields not fully applied');
        setStatus('应用未完成：当前 SillyTavern 页面没有成功写入关键字段（连接方式 / 来源 / 地址 / 模型）', 'error');
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

function formatDateLabel(value) {
    if (!value) {
        return '刚刚更新';
    }

    try {
        return new Date(value).toLocaleDateString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
        });
    } catch {
        return String(value).slice(0, 10);
    }
}

function getUniqueSelectedModels(profile) {
    return Array.from(new Set((profile?.selectedModels ?? []).map(normalizeText).filter(Boolean)));
}

function getFilteredSuggestedModels(profile) {
    const suggestedModels = getSuggestedModels(profile);
    const query = normalizeText(uiState.modelPickerQuery).toLowerCase();
    if (!query) {
        return suggestedModels;
    }

    return suggestedModels.filter(modelName => modelName.toLowerCase().includes(query));
}

function getFilteredSelectedModels(profile) {
    const selectedModels = getUniqueSelectedModels(profile);
    const query = normalizeText(uiState.selectedModelQuery).toLowerCase();
    if (!query) {
        return selectedModels;
    }

    return selectedModels.filter(modelName => modelName.toLowerCase().includes(query));
}

function setEditorDraftProfile(nextProfile) {
    uiState.editorDraft = {
        ...clone(nextProfile),
        selectedModels: getUniqueSelectedModels(nextProfile),
    };
}

function toggleEditorSelectedModel(modelName) {
    const normalizedModel = normalizeText(modelName);
    if (!normalizedModel) {
        return;
    }

    syncEditorDraftFromForm();
    const profile = getEditingProfile() ?? defaultProfile();
    const selectedModels = new Set(getUniqueSelectedModels(profile));

    if (selectedModels.has(normalizedModel)) {
        selectedModels.delete(normalizedModel);
        if (normalizeText(profile.model) === normalizedModel) {
            profile.model = Array.from(selectedModels)[0] ?? '';
        }
    } else {
        selectedModels.add(normalizedModel);
        if (!normalizeText(profile.model)) {
            profile.model = normalizedModel;
        }
    }

    profile.selectedModels = Array.from(selectedModels);
    const pickerPanel = managerPopup?.dlg?.querySelector('.api-profile-manager__model-option-list--panel')
        || dom.root?.querySelector?.('.api-profile-manager__model-option-list--panel');
    uiState.pickerPanelScrollTop = pickerPanel instanceof HTMLElement ? pickerPanel.scrollTop : uiState.pickerPanelScrollTop;
    setEditorDraftProfile(profile);
    render();
}

function removeEditorSelectedModel(modelName) {
    const normalizedModel = normalizeText(modelName);
    if (!normalizedModel) {
        return;
    }

    syncEditorDraftFromForm();
    const profile = getEditingProfile() ?? defaultProfile();
    const selectedModels = getUniqueSelectedModels(profile).filter(item => item !== normalizedModel);
    if (normalizeText(profile.model) === normalizedModel) {
        profile.model = selectedModels[0] ?? '';
    }

    profile.selectedModels = selectedModels;
    setEditorDraftProfile(profile);
    render();
}

function setPrimaryModel(modelName) {
    const normalizedModel = normalizeText(modelName);
    if (!normalizedModel) {
        return;
    }

    syncEditorDraftFromForm();
    const profile = getEditingProfile() ?? defaultProfile();
    const selectedModels = new Set(getUniqueSelectedModels(profile));
    selectedModels.add(normalizedModel);
    profile.model = normalizedModel;
    profile.selectedModels = Array.from(selectedModels);
    setEditorDraftProfile(profile);
    render();
}

function clearEditorSelectedModels() {
    syncEditorDraftFromForm();
    const profile = getEditingProfile() ?? defaultProfile();
    profile.selectedModels = [];
    if (getUniqueSelectedModels(profile).length === 0) {
        profile.model = '';
    }
    setEditorDraftProfile(profile);
    render();
}

function toggleFilteredModelsSelection() {
    syncEditorDraftFromForm();
    const profile = getEditingProfile() ?? defaultProfile();
    const filteredModels = getFilteredSuggestedModels(profile);
    if (!filteredModels.length) {
        return;
    }

    const selectedModels = new Set(getUniqueSelectedModels(profile));
    const allSelected = filteredModels.every(modelName => selectedModels.has(modelName));
    if (allSelected) {
        filteredModels.forEach(modelName => selectedModels.delete(modelName));
    } else {
        filteredModels.forEach(modelName => selectedModels.add(modelName));
    }

    profile.selectedModels = Array.from(selectedModels);
    if (!selectedModels.has(normalizeText(profile.model))) {
        profile.model = profile.selectedModels[0] ?? '';
    }
    setEditorDraftProfile(profile);
    render();
}

function updateModelPickerQuery(value) {
    uiState.modelPickerQuery = String(value ?? '');

    const popupContent = managerPopup?.dlg?.querySelector('.api-profile-manager__content');
    const previousPopupScrollTop = popupContent instanceof HTMLElement ? popupContent.scrollTop : null;

    render();

    const queryInput = managerPopup?.dlg?.querySelector('input[name="modelPickerQuery"]')
        || dom.root?.querySelector?.('input[name="modelPickerQuery"]');
    if (queryInput instanceof HTMLInputElement) {
        queryInput.focus();
        const cursor = queryInput.value.length;
        queryInput.setSelectionRange(cursor, cursor);
    }

    const nextPopupContent = managerPopup?.dlg?.querySelector('.api-profile-manager__content');
    if (typeof previousPopupScrollTop === 'number' && nextPopupContent instanceof HTMLElement) {
        nextPopupContent.scrollTop = previousPopupScrollTop;
    }
}

function updateSelectedModelQuery(value) {
    uiState.selectedModelQuery = String(value ?? '');

    const popupContent = managerPopup?.dlg?.querySelector('.api-profile-manager__content');
    const previousPopupScrollTop = popupContent instanceof HTMLElement ? popupContent.scrollTop : null;

    render();

    const queryInput = managerPopup?.dlg?.querySelector('input[name="selectedModelQuery"]')
        || dom.root?.querySelector?.('input[name="selectedModelQuery"]');
    if (queryInput instanceof HTMLInputElement) {
        queryInput.focus();
        const cursor = queryInput.value.length;
        queryInput.setSelectionRange(cursor, cursor);
    }

    const nextPopupContent = managerPopup?.dlg?.querySelector('.api-profile-manager__content');
    if (typeof previousPopupScrollTop === 'number' && nextPopupContent instanceof HTMLElement) {
        nextPopupContent.scrollTop = previousPopupScrollTop;
    }
}

function toggleModelPicker() {
    uiState.isModelPickerOpen = !uiState.isModelPickerOpen;
    render();
}

function toggleSelectedModelPanel() {
    uiState.isSelectedModelPanelOpen = !uiState.isSelectedModelPanelOpen;
    render();
}

function toggleExpandedModelRow(profileId) {
    if (!profileId) {
        return;
    }

    uiState.expandedModelRows = {
        ...uiState.expandedModelRows,
        [profileId]: !uiState.expandedModelRows[profileId],
    };
    render();
}

async function deleteGroup(groupKey) {
    const normalizedGroupKey = normalizeText(groupKey);
    const group = findGroup(normalizedGroupKey);
    if (!group) {
        setStatus('没有找到要删除的分组', 'error');
        return;
    }

    const confirmed = await callGenericPopup(`删除分组「${group.title}」后会一起删除该分组下的 ${group.profiles.length} 个配置，且无法恢复，是否继续？`, POPUP_TYPE.CONFIRM, '');
    if (confirmed !== POPUP_RESULT.AFFIRMATIVE && confirmed !== true) {
        return;
    }

    const profileIds = new Set(group.profiles.map(profile => profile.id));
    const settings = getSettings();
    settings.profiles = settings.profiles.filter(profile => !profileIds.has(profile.id));
    delete settings.groupMetadata?.[normalizedGroupKey];
    if (profileIds.has(settings.activeProfileId)) {
        settings.activeProfileId = settings.profiles[0]?.id ?? '';
    }

    if (uiState.activeGroupKey === normalizedGroupKey) {
        uiState.activeGroupKey = '';
    }
    if (uiState.editingProfileId && profileIds.has(uiState.editingProfileId)) {
        uiState.editingProfileId = '';
        uiState.editorDraft = null;
        uiState.view = 'home';
    }

    persist();
    render();
    setStatus(`已删除分组「${group.title}」`);
}

function renderSelectedModelInputs(selectedModels) {
    return selectedModels.map(modelName => `<input type="hidden" name="selectedModels" value="${escapeHtml(modelName)}">`).join('');
}

function renderSelectedModelChips(profile) {
    const selectedModels = getUniqueSelectedModels(profile);
    const filteredSelectedModels = getFilteredSelectedModels(profile);
    if (!selectedModels.length) {
        return '<p class="api-profile-manager__picker-empty">还没有选中模型。拉取列表后点一下即可加入。</p>';
    }

    return `
        <div class="api-profile-manager__selected-model-summary">
            <div class="api-profile-manager__picker-toolbar">
                <p class="api-profile-manager__picker-note">当前已选 ${selectedModels.length} 个模型。${profile.model ? `主模型是 ${escapeHtml(profile.model)}。` : '还没有指定主模型。'}</p>
                <div class="api-profile-manager__picker-toolbar-actions">
                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" type="button" data-action="toggle-selected-model-panel">${uiState.isSelectedModelPanelOpen ? '收起已选列表' : '展开已选列表'}</button>
                </div>
            </div>
            <div class="api-profile-manager__model-picker-shell ${uiState.isSelectedModelPanelOpen ? 'is-open' : ''}">
                ${uiState.isSelectedModelPanelOpen ? `
                    <div class="api-profile-manager__model-picker-controls">
                        <input class="api-profile-manager__input" name="selectedModelQuery" value="${escapeHtml(uiState.selectedModelQuery)}" placeholder="搜索已选模型" autocomplete="off">
                    </div>
                    <div class="api-profile-manager__selected-model-list">
                        ${filteredSelectedModels.length ? filteredSelectedModels.map(modelName => `
                            <div class="api-profile-manager__selected-model-row ${normalizeText(profile.model) === modelName ? 'is-primary' : ''}">
                                <button class="api-profile-manager__selected-model-name" type="button" data-action="set-primary-model" data-model-name="${escapeHtml(modelName)}">
                                    ${escapeHtml(modelName)}
                                    ${normalizeText(profile.model) === modelName ? '<span class="api-profile-manager__model-chip-badge">主模型</span>' : ''}
                                </button>
                                <button class="api-profile-manager__model-chip-remove" type="button" data-action="remove-selected-model" data-model-name="${escapeHtml(modelName)}" aria-label="移除模型">×</button>
                            </div>
                        `).join('') : '<p class="api-profile-manager__picker-empty api-profile-manager__picker-empty--panel">没有匹配到已选模型。</p>'}
                    </div>
                ` : '<p class="api-profile-manager__picker-empty api-profile-manager__picker-empty--panel">已选模型已收起。点击“展开已选列表”后可搜索、删除和设置主模型。</p>'}
            </div>
        </div>
    `;
}

function renderSuggestedModelPicker(profile, suggestedModels) {
    const selectedModels = new Set(getUniqueSelectedModels(profile));
    const filteredModels = getFilteredSuggestedModels(profile);
    const allFilteredSelected = filteredModels.length > 0 && filteredModels.every(modelName => selectedModels.has(modelName));
    const canShowFetchedSummary = Boolean(normalizeText(profile.baseUrl)) && suggestedModels.length > 0;
    return `
        <div class="api-profile-manager__model-picker">
            <div class="api-profile-manager__picker-toolbar">
                <p class="api-profile-manager__picker-note">${canShowFetchedSummary ? `已拉取 / 识别到 ${suggestedModels.length} 个模型。打开选择框后可搜索、多选和全选，再从上面的已选标签里设置主模型。` : '请先填写 API URL 并点击“获取列表”，再从这里搜索和多选模型。'}</p>
                <div class="api-profile-manager__picker-toolbar-actions">
                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" type="button" data-action="toggle-model-picker">${uiState.isModelPickerOpen ? '收起选择框' : '打开选择框'}</button>
                    ${selectedModels.size ? '<button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" type="button" data-action="clear-selected-models">清空已选</button>' : ''}
                </div>
            </div>
            ${canShowFetchedSummary ? `
                <div class="api-profile-manager__model-picker-shell ${uiState.isModelPickerOpen ? 'is-open' : ''}">
                    ${uiState.isModelPickerOpen ? `
                        <div class="api-profile-manager__model-picker-controls">
                            <input class="api-profile-manager__input" name="modelPickerQuery" value="${escapeHtml(uiState.modelPickerQuery)}" placeholder="搜索模型名称" autocomplete="off">
                            <div class="api-profile-manager__picker-inline-actions">
                                <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" type="button" data-action="toggle-select-all-models">${allFilteredSelected ? '取消全选当前结果' : '全选当前结果'}</button>
                            </div>
                        </div>
                        <div class="api-profile-manager__model-option-list api-profile-manager__model-option-list--panel">
                            ${filteredModels.length ? filteredModels.map(modelName => `
                                <button
                                    class="api-profile-manager__model-option ${selectedModels.has(modelName) ? 'is-selected' : ''} ${normalizeText(profile.model) === modelName ? 'is-primary' : ''}"
                                    type="button"
                                    data-action="toggle-suggested-model"
                                    data-model-name="${escapeHtml(modelName)}"
                                >
                                    <span class="api-profile-manager__model-option-name">${escapeHtml(modelName)}</span>
                                    <span class="api-profile-manager__model-option-state">${normalizeText(profile.model) === modelName ? '主模型' : selectedModels.has(modelName) ? '已选中' : '点选添加'}</span>
                                </button>
                            `).join('') : '<p class="api-profile-manager__picker-empty api-profile-manager__picker-empty--panel">没有匹配到模型，换个关键词试试。</p>'}
                        </div>
                    ` : '<p class="api-profile-manager__picker-empty api-profile-manager__picker-empty--panel">选择框已收起。点击“打开选择框”后可搜索、多选和全选。</p>'}
                </div>
            ` : '<p class="api-profile-manager__picker-empty">先点击“获取列表”，这里会出现可点选的模型。</p>'}
        </div>
    `;
}

function renderHomeView() {
    const groups = buildGroups();
    if (!groups.length) {
        return `
            <section class="api-profile-manager__empty-state">
                <div class="api-profile-manager__editor-block">
                    <h3 class="api-profile-manager__section-title">还没添加接口配置</h3>
                    <p class="api-profile-manager__empty" style="color: var(--apm-text-muted); font-size: 13px; margin: 12px 0;">新建个配置吧，同地址的多个模型会自动放在一个分组里。</p>
                    <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="new-profile">新建配置</button>
                </div>
            </section>
        `;
    }

    const activeProfile = getActiveProfile();
    return `
        <section class="api-profile-manager__home">
            <div class="api-profile-manager__section-head">
                <h3 class="api-profile-manager__section-title">所有配置</h3>
                <div style="display: flex; gap: 8px;">
                    <button class="api-profile-manager__button api-profile-manager__button--ghost" data-action="open-tools">备份与设置</button>
                    <button class="api-profile-manager__button api-profile-manager__button--primary" style="min-height: 32px; padding: 0 14px; font-size: 12px;" data-action="new-profile">+ 新建配置</button>
                </div>
            </div>
            <div class="api-profile-manager__group-list">
                ${groups.map(group => {
                    const isExpanded = uiState.activeGroupKey === group.key;
                    const hasActiveProfile = group.profiles.some(profile => profile.id === activeProfile?.id);
                    const isPinned = Boolean(group.metadata?.pinned);
                    const hasMissingKey = group.profiles.some(profile => !normalizeText(profile.apiKey));
                    return `
                        <article class="api-profile-manager__group-card api-profile-manager__glass-card ${isExpanded ? 'is-expanded' : ''} ${hasActiveProfile ? 'is-active' : ''}" data-group-key="${escapeHtml(group.key)}">
                            <div class="api-profile-manager__group-top" data-action="toggle-group" data-group-key="${escapeHtml(group.key)}">
                                <div class="api-profile-manager__group-main">
                                    <div class="api-profile-manager__group-title-wrap">
                                        <span class="api-profile-manager__group-arrow ${isExpanded ? 'is-expanded' : ''}" aria-hidden="true"></span>
                                        <h3 class="api-profile-manager__group-name">${escapeHtml(group.title)}</h3>
                                    </div>
                                    ${hasMissingKey ? '<span class="api-profile-manager__group-state api-profile-manager__group-state--warning">缺少密钥</span>' : ''}
                                </div>
                                <div class="api-profile-manager__group-side">
                                    <span class="api-profile-manager__group-state ${hasActiveProfile ? 'is-active' : ''}">${hasActiveProfile ? '已启用' : '未启用'}</span>
                                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" data-action="rename-group" data-group-key="${escapeHtml(group.key)}">修改分组</button>
                                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" data-action="toggle-group-pinned" data-group-key="${escapeHtml(group.key)}">${isPinned ? '取消置顶' : '置顶'}</button>
                                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" data-action="move-group-up" data-group-key="${escapeHtml(group.key)}">上移</button>
                                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" data-action="move-group-down" data-group-key="${escapeHtml(group.key)}">下移</button>
                                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--compact" data-action="new-profile-in-group" data-group-key="${escapeHtml(group.key)}">新增模型</button>
                                    <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--danger api-profile-manager__button--compact" data-action="delete-group" data-group-key="${escapeHtml(group.key)}">删除分组</button>
                                </div>
                            </div>
                            ${isExpanded ? `
                                <div class="api-profile-manager__drawer-list api-profile-manager__group-model-list">
                                    <div class="api-profile-manager__group-model-summary">
                                        <span class="api-profile-manager__group-model-count">模型列表（${group.profiles.length}）</span>
                                    </div>
                                    ${group.profiles.map(profile => {
                                        const isActive = profile.id === activeProfile?.id;
                                        const isNameExpanded = Boolean(uiState.expandedModelRows[profile.id]);
                                        return `
                                        <article class="api-profile-manager__drawer-item api-profile-manager__drawer-item--row ${isActive ? 'is-active' : ''}">
                                            <div class="api-profile-manager__drawer-main">
                                                <button class="api-profile-manager__drawer-title api-profile-manager__drawer-title-button ${isNameExpanded ? 'is-expanded' : ''}" data-action="toggle-model-row" data-profile-id="${profile.id}" title="${escapeHtml(profile.name || profile.model || '未命名')}">
                                                    ${escapeHtml(profile.name || profile.model || '未命名')}
                                                </button>
                                                ${!normalizeText(profile.apiKey) ? '<p class="api-profile-manager__drawer-status api-profile-manager__drawer-status--warning">缺少密钥</p>' : ''}
                                            </div>
                                            <div class="api-profile-manager__drawer-actions">
                                                <button class="api-profile-manager__profile-action ${isActive ? 'api-profile-manager__profile-action--status' : 'api-profile-manager__profile-action--primary'}" data-action="${isActive ? 'noop' : 'apply-profile'}" data-profile-id="${profile.id}">${isActive ? '已启用' : '应用'}</button>
                                                <button class="api-profile-manager__profile-action" data-action="edit-profile" data-profile-id="${profile.id}">编辑</button>
                                                <button class="api-profile-manager__profile-action api-profile-manager__profile-action--danger" data-action="delete-profile" data-profile-id="${profile.id}">删除</button>
                                            </div>
                                        </article>
                                    `;
                                    }).join('')}
                                </div>
                            ` : ''}
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
                <div style="display: flex; gap: 8px;">
                    <button class="api-profile-manager__button api-profile-manager__button--ghost" data-action="back-home">返回首页</button>
                    <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="new-profile-in-group" data-group-key="${escapeHtml(group.key)}">新增模型</button>
                </div>
            </div>
            <div class="api-profile-manager__profile-list">
                ${group.profiles.map(profile => `
                    <article class="api-profile-manager__profile-card ${profile.id === activeProfile?.id ? 'is-active' : ''}">
                        <div class="api-profile-manager__profile-top">
                            <div>
                                <span class="api-profile-manager__profile-label">${profile.id === activeProfile?.id ? '当前模型' : '已保存模型'}</span>
                                <h3 class="api-profile-manager__profile-name">${escapeHtml(profile.model || profile.name || '未命名模型')}</h3>
                                <p class="api-profile-manager__meta">${escapeHtml(getModeLabel(profile.mode))} · ${escapeHtml(getProviderLabel(profile.mode, profile.provider))}</p>
                            </div>
                            <span class="api-profile-manager__pill">${escapeHtml(formatDateLabel(profile.updatedAt))}</span>
                        </div>
                        <div class="api-profile-manager__profile-badges">
                            <span class="api-profile-manager__pill">地址：${escapeHtml(profile.baseUrl)}</span>
                            ${profile.id === activeProfile?.id ? '<span class="api-profile-manager__pill api-profile-manager__pill--success">正在使用</span>' : ''}
                        </div>
                        <div class="api-profile-manager__profile-actions">
                            <button class="api-profile-manager__profile-action api-profile-manager__profile-action--primary" data-action="apply-profile" data-profile-id="${profile.id}">启用</button>
                            <button class="api-profile-manager__profile-action" data-action="edit-profile" data-profile-id="${profile.id}">编辑</button>
                            <button class="api-profile-manager__profile-action api-profile-manager__profile-action--danger" data-action="delete-profile" data-profile-id="${profile.id}">删除</button>
                        </div>
                    </article>
                `).join('')}
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
    const selectedModels = getUniqueSelectedModels(profile);
    const isMissingKey = !normalizeText(profile.apiKey);
    return `
        <section class="api-profile-manager__editor">
            <div class="api-profile-manager__section-head">
                <div>
                    <h3 class="api-profile-manager__section-title">参数设置</h3>
                    ${isMissingKey ? '<p class="api-profile-manager__section-subtitle api-profile-manager__section-subtitle--warning">当前配置缺少 API Key，保存后仍需补充才能正常启用。</p>' : ''}
                </div>
                <button class="api-profile-manager__button api-profile-manager__button--ghost" data-action="back-from-editor" style="padding: 0;">‹ 返回</button>
            </div>

            <form data-role="editor-form">
                <div class="api-profile-manager__editor-block">
                    <div class="api-profile-manager__field-grid">
                        <label class="api-profile-manager__field api-profile-manager__field--full">
                            <span class="api-profile-manager__label">所属分组（必填）</span>
                            <input class="api-profile-manager__input" name="groupName" value="${escapeHtml(profile.groupName)}" placeholder="例如：OpenRouter / 主力接口 / 本地推理">
                        </label>
                    </div>
                </div>

                <div class="api-profile-manager__editor-block">
                    <div class="api-profile-manager__field-grid">
                        <label class="api-profile-manager__field">
                            <span class="api-profile-manager__label">连接方式</span>
                            <select class="api-profile-manager__select" name="mode">${renderModeOptions(profile.mode)}</select>
                        </label>
                        <label class="api-profile-manager__field">
                            <span class="api-profile-manager__label">数据来源</span>
                            <select class="api-profile-manager__select" name="provider">${renderProviderOptions(profile.mode, profile.provider)}</select>
                        </label>
                        <label class="api-profile-manager__field api-profile-manager__field--full">
                            <span class="api-profile-manager__label">API URL (接口地址)</span>
                            <input class="api-profile-manager__input" name="baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="https://example.com/v1">
                        </label>
                        <label class="api-profile-manager__field api-profile-manager__field--full">
                            <span class="api-profile-manager__label">API Key (密钥)</span>
                            <div class="api-profile-manager__secret">
                                <input class="api-profile-manager__input" name="apiKey" type="${uiState.revealKey ? 'text' : 'password'}" value="${escapeHtml(profile.apiKey)}" placeholder="sk-..." autocomplete="off">
                                <button class="api-profile-manager__button" type="button" data-action="toggle-key" style="background: var(--apm-surface-strong); border-color: transparent;">${uiState.revealKey ? '隐藏' : '显示'}</button>
                            </div>
                        </label>
                    </div>
                </div>

                <div class="api-profile-manager__editor-block">
                    <div class="api-profile-manager__field-grid">
                        <label class="api-profile-manager__field api-profile-manager__field--full">
                            <span class="api-profile-manager__label">模型 ID (真实调用的模型名)</span>
                            <input class="api-profile-manager__input" name="model" value="${escapeHtml(profile.model)}" placeholder="例如：claude-3-7-sonnet">
                        </label>
                        <div class="api-profile-manager__field api-profile-manager__field--full">
                            <span class="api-profile-manager__label">拉取模型后点选保存</span>
                            <div class="api-profile-manager__model-picker-block">
                                <div class="api-profile-manager__picker-head">
                                    <button class="api-profile-manager__button" type="button" data-action="fetch-models-placeholder" style="background: var(--apm-surface-strong);">获取列表</button>
                                    <p class="api-profile-manager__picker-note">当前已选 ${selectedModels.length} 个模型。主模型会在保存并启用时优先应用。</p>
                                </div>
                                ${renderSelectedModelInputs(selectedModels)}
                                ${renderSelectedModelChips(profile)}
                                ${renderSuggestedModelPicker(profile, suggestedModels)}
                            </div>
                        </div>
                    </div>
                </div>
            </form>

            <div class="api-profile-manager__editor-actions">
                <div class="api-profile-manager__editor-actions-main">
                    <button class="api-profile-manager__button" data-action="save-profile" style="background: var(--apm-surface-strong);">仅保存</button>
                    <button class="api-profile-manager__button api-profile-manager__button--primary" data-action="save-and-apply">保存并启用</button>
                </div>
                ${profile.id ? `
                    <div class="api-profile-manager__editor-danger-zone">
                        <button class="api-profile-manager__button api-profile-manager__button--ghost api-profile-manager__button--danger" data-action="delete-profile" data-profile-id="${profile.id}">删除配置</button>
                    </div>
                ` : ''}
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
                    <button class="api-profile-manager__button" data-action="import-st-connection-profiles">导入 ST 连接配置</button>
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
            <header class="api-profile-manager__hero">
                <h2 class="api-profile-manager__title">${uiState.view === 'home' ? '接口列表' : uiState.view === 'group' ? '分组详情' : uiState.view === 'tools' ? '工具与备份' : '配置编辑'}</h2>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button class="api-profile-manager__button api-profile-manager__button--ghost" data-action="toggle-theme" style="padding: 0 10px;" title="切换日夜模式">
                        <span style="font-size: 16px;">${uiState.isLightMode ? '🌙' : '☀️'}</span>
                    </button>
                    <button class="api-profile-manager__sheet-close" data-action="close-panel" aria-label="关闭面板">×</button>
                </div>
            </header>
            <div class="api-profile-manager__content">${renderContent()}</div>
        </section>
    `;
}

function renderLauncher() {
    return `
        <div class="api-profile-manager__launcher-bar" data-action="open-panel" aria-label="API管家入口" role="button" tabindex="0">
            <div style="display: flex; align-items: center; gap: 12px;">
                <span class="api-profile-manager__fab-icon">⚡</span>
                <span class="api-profile-manager__launcher-title">API 管家</span>
            </div>
            <span class="api-profile-manager__launcher-arrow">›</span>
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
    surface.addEventListener('scroll', handleScroll, true);
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

    const existingPopupContent = managerPopup?.dlg?.querySelector('.api-profile-manager__content');
    const previousPopupScrollTop = existingPopupContent instanceof HTMLElement ? existingPopupContent.scrollTop : null;
    const existingPickerPanel = managerPopup?.dlg?.querySelector('.api-profile-manager__model-option-list--panel');
    const previousPickerPanelScrollTop = existingPickerPanel instanceof HTMLElement ? existingPickerPanel.scrollTop : uiState.pickerPanelScrollTop;

    root.classList.toggle('light-theme', uiState.isLightMode);
    root.classList.toggle('apm-light-theme', uiState.isLightMode);
    root.closest('.api-profile-manager')?.classList.toggle('light-theme', uiState.isLightMode);
    root.closest('.api-profile-manager')?.classList.toggle('apm-light-theme', uiState.isLightMode);
    root.innerHTML = renderLauncher();
    root.classList.remove('is-open');

    bindSurfaceEvents(root);

    if (managerPopup?.dlg?.isConnected) {
        managerPopup.dlg.classList.toggle('light-theme', uiState.isLightMode);
        managerPopup.dlg.classList.toggle('apm-light-theme', uiState.isLightMode);
        const content = managerPopup.dlg.querySelector('.api-profile-manager__popup-content');
        if (content instanceof HTMLElement) {
            content.classList.toggle('light-theme', uiState.isLightMode);
            content.classList.toggle('apm-light-theme', uiState.isLightMode);
            content.innerHTML = renderSheet();
            if (typeof previousPopupScrollTop === 'number') {
                const nextPopupContent = managerPopup.dlg.querySelector('.api-profile-manager__content');
                if (nextPopupContent instanceof HTMLElement) {
                    nextPopupContent.scrollTop = previousPopupScrollTop;
                }
            }
            const nextPickerPanel = managerPopup.dlg.querySelector('.api-profile-manager__model-option-list--panel');
            if (nextPickerPanel instanceof HTMLElement) {
                nextPickerPanel.scrollTop = previousPickerPanelScrollTop;
                uiState.pickerPanelScrollTop = previousPickerPanelScrollTop;
            }
        }
        bindSurfaceEvents(managerPopup.dlg);
    }
}

async function openManagerPopup() {
    setOpen(true);

    const wrapper = document.createElement('div');
    wrapper.className = `api-profile-manager api-profile-manager__popup-content${uiState.isLightMode ? ' light-theme apm-light-theme' : ''}`;
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

    if (await handleGroupAction(action, groupKey, event)) {
        return;
    }

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
        case 'toggle-theme':
            syncEditorDraftFromForm();
            uiState.isLightMode = !uiState.isLightMode;
            render();
            break;
        case 'fetch-models-placeholder':
            await fetchModelsForEditor();
            break;
        case 'back-home':
            goHome();
            break;
        case 'toggle-model-row':
            toggleExpandedModelRow(profileId);
            break;
        case 'noop':
            break;
        case 'new-profile':
            openEditor('', {});
            break;
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
                uiState.view = 'home';
                render();
            } else {
                goHome();
            }
            break;
        case 'toggle-suggested-model':
            toggleEditorSelectedModel(button.dataset.modelName || '');
            break;
        case 'remove-selected-model':
            removeEditorSelectedModel(button.dataset.modelName || '');
            break;
        case 'set-primary-model':
            setPrimaryModel(button.dataset.modelName || '');
            break;
        case 'clear-selected-models':
            clearEditorSelectedModels();
            break;
        case 'toggle-select-all-models':
            toggleFilteredModelsSelection();
            break;
        case 'toggle-model-picker':
            toggleModelPicker();
            break;
        case 'toggle-selected-model-panel':
            toggleSelectedModelPanel();
            break;
        case 'toggle-key':
            syncEditorDraftFromForm();
            uiState.revealKey = !uiState.revealKey;
            render();
            break;
        case 'import':
            dom.importFile.click();
            break;
        case 'import-st-connection-profiles':
            await importStConnectionProfiles();
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
        if (target.name === 'modelPickerQuery') {
            updateModelPickerQuery(target.value);
            return;
        }
        if (target.name === 'selectedModelQuery') {
            updateSelectedModelQuery(target.value);
            return;
        }
        uiState.editorDraft = readEditorProfile();
    }
}

function handleScroll(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    if (target.classList.contains('api-profile-manager__model-option-list--panel')) {
        uiState.pickerPanelScrollTop = target.scrollTop;
    }
}

async function handleGroupAction(action, groupKey, event) {
    switch (action) {
        case 'open-group':
            openGroup(groupKey);
            return true;
        case 'toggle-group':
            uiState.activeGroupKey = uiState.activeGroupKey === groupKey ? '' : groupKey;
            render();
            return true;
        case 'toggle-group-pinned':
            event.stopPropagation();
            toggleGroupPinned(groupKey);
            return true;
        case 'rename-group':
            event.stopPropagation();
            await renameGroup(groupKey);
            return true;
        case 'move-group-up':
            event.stopPropagation();
            moveGroup(groupKey, -1);
            return true;
        case 'move-group-down':
            event.stopPropagation();
            moveGroup(groupKey, 1);
            return true;
        case 'delete-group':
            await deleteGroup(groupKey);
            return true;
        case 'new-profile-in-group': {
            const group = findGroup(groupKey);
            openEditor('', {
                groupName: group?.profiles[0]?.groupName || group?.title || '',
                baseUrl: group?.baseUrl || '',
                mode: group?.profiles[0]?.mode || 'chat-completions',
                provider: group?.profiles[0]?.provider || 'custom',
                headerName: group?.profiles[0]?.headerName || 'Authorization',
            });
            return true;
        }
        default:
            return false;
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
