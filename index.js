import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { callGenericPopup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
import { writeSecret } from '../../../secrets.js';

const MODULE_DIRECTORY = (() => {
    const url = new URL(import.meta.url);
    const parts = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-2) ?? 'st-api-profile-manager');
})();

const MODULE_NAME = `third-party/${MODULE_DIRECTORY}`;

const DEFAULT_SETTINGS = {
    version: 1,
    activeProfileId: '',
    profiles: [],
    preferences: {
        maskKeysByDefault: true,
    },
};

const PROVIDER_OPTIONS = {
    'chat-completions': [
        { value: 'custom', label: 'Custom / Compatible' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'azure_openai', label: 'Azure OpenAI' },
    ],
    'text-generation': [
        { value: 'generic', label: 'Generic' },
        { value: 'ooba', label: 'ooba / text-generation-webui' },
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
let draftProfileId = '';
let revealKey = false;

function clone(value) {
    return structuredClone(value);
}

function defaultProfile() {
    const timestamp = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        mode: 'chat-completions',
        provider: 'custom',
        name: '',
        baseUrl: '',
        apiKey: '',
        headerName: 'Authorization',
        headerValue: '',
        notes: '',
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function getSettings() {
    if (!extension_settings.apiProfileManager) {
        extension_settings.apiProfileManager = clone(DEFAULT_SETTINGS);
    }

    const settings = extension_settings.apiProfileManager;
    settings.version ??= DEFAULT_SETTINGS.version;
    settings.activeProfileId ??= DEFAULT_SETTINGS.activeProfileId;
    settings.profiles ??= [];
    settings.preferences ??= clone(DEFAULT_SETTINGS.preferences);
    settings.preferences.maskKeysByDefault ??= true;
    return settings;
}

function getProfiles() {
    return getSettings().profiles;
}

function getSelectedProfile() {
    return getProfiles().find(profile => profile.id === draftProfileId) ?? null;
}

function setStatus(message, type = 'success') {
    if (dom.status) {
        dom.status.textContent = message;
    }

    if (dom.validation) {
        dom.validation.textContent = message;
        dom.validation.classList.remove('api-profile-manager__validation--error', 'api-profile-manager__validation--success');
        dom.validation.classList.add(type === 'error' ? 'api-profile-manager__validation--error' : 'api-profile-manager__validation--success');
    }
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function readDraftFromForm() {
    const selected = getSelectedProfile();
    const base = selected ? clone(selected) : defaultProfile();
    base.mode = String(dom.mode.value);
    base.provider = String(dom.provider.value);
    base.name = normalizeText(dom.name.value);
    base.baseUrl = normalizeText(dom.baseUrl.value).replace(/\/+$/u, '');
    base.apiKey = String(dom.apiKey.value ?? '');
    base.headerName = normalizeText(dom.headerName.value);
    base.headerValue = String(dom.headerValue.value ?? '');
    base.notes = String(dom.notes.value ?? '').trim();
    base.updatedAt = new Date().toISOString();
    return base;
}

function validateProfile(profile) {
    if (!profile.mode || !PROVIDER_OPTIONS[profile.mode]) {
        return 'Connection mode is required.';
    }

    if (!profile.provider) {
        return 'Provider is required.';
    }

    if (!profile.name) {
        return 'Profile name is required.';
    }

    const duplicate = getProfiles().find(item => item.id !== profile.id && item.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase());
    if (duplicate) {
        return 'Profile name must be unique.';
    }

    if (!profile.baseUrl) {
        return 'Base URL is required.';
    }

    try {
        const url = new URL(profile.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return 'Base URL must use http or https.';
        }
    } catch {
        return 'Base URL is not valid.';
    }

    return '';
}

function fillForm(profile) {
    const target = profile ?? defaultProfile();
    dom.mode.value = target.mode;
    populateProviderOptions(target.mode, target.provider);
    dom.name.value = target.name;
    dom.baseUrl.value = target.baseUrl;
    dom.apiKey.value = target.apiKey;
    dom.headerName.value = target.headerName;
    dom.headerValue.value = target.headerValue;
    dom.notes.value = target.notes;
    updateSecretVisibility();
}

function updateProfileSelect() {
    const settings = getSettings();
    dom.select.innerHTML = '';

    for (const profile of settings.profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || '(unnamed profile)';
        if (profile.id === draftProfileId) {
            option.selected = true;
        }
        dom.select.append(option);
    }

    if (!settings.profiles.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No saved profiles yet';
        option.selected = true;
        dom.select.append(option);
    }
}

function populateProviderOptions(mode, selectedValue = '') {
    const options = PROVIDER_OPTIONS[mode] ?? PROVIDER_OPTIONS['chat-completions'];
    dom.provider.innerHTML = '';

    for (const optionData of options) {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.label;
        if (selectedValue ? selectedValue === optionData.value : options[0]?.value === optionData.value) {
            option.selected = true;
        }
        dom.provider.append(option);
    }
}

function selectProfile(profileId) {
    const settings = getSettings();
    draftProfileId = profileId || settings.activeProfileId || settings.profiles[0]?.id || '';
    const profile = getSelectedProfile();
    fillForm(profile);
    updateProfileSelect();
}

function persist() {
    saveSettingsDebounced();
    updateProfileSelect();
}

async function saveProfile() {
    const settings = getSettings();
    const profile = readDraftFromForm();
    const validationError = validateProfile(profile);

    if (validationError) {
        setStatus(validationError, 'error');
        return;
    }

    const index = settings.profiles.findIndex(item => item.id === profile.id);
    if (index === -1) {
        settings.profiles.push(profile);
    } else {
        settings.profiles[index] = profile;
    }

    if (!settings.activeProfileId) {
        settings.activeProfileId = profile.id;
    }

    draftProfileId = profile.id;
    persist();
    setStatus('Profile saved.');
}

async function deleteProfile() {
    const profile = getSelectedProfile();
    if (!profile) {
        setStatus('Nothing to delete.', 'error');
        return;
    }

    const confirmed = await callGenericPopup(`Delete profile \"${profile.name || 'Unnamed'}\"?`, POPUP_TYPE.CONFIRM, '');
    if (confirmed !== POPUP_RESULT.AFFIRMATIVE && confirmed !== true) {
        return;
    }

    const settings = getSettings();
    settings.profiles = settings.profiles.filter(item => item.id !== profile.id);
    if (settings.activeProfileId === profile.id) {
        settings.activeProfileId = settings.profiles[0]?.id ?? '';
    }

    extension_settings.apiProfileManager.profiles = settings.profiles;
    extension_settings.apiProfileManager.activeProfileId = settings.activeProfileId;
    draftProfileId = settings.activeProfileId;
    persist();
    selectProfile(draftProfileId);
    setStatus('Profile deleted.');
}

function duplicateProfile() {
    const profile = getSelectedProfile();
    const copy = profile ? clone(profile) : defaultProfile();
    copy.id = crypto.randomUUID();
    copy.name = profile?.name ? `${profile.name} Copy` : 'New Profile';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    draftProfileId = copy.id;
    fillForm(copy);
    setStatus('Duplicated into draft. Save to keep it.');
}

function resetDraft() {
    fillForm(getSelectedProfile());
    setStatus('Draft reset.');
}

function updateSecretVisibility() {
    const shouldReveal = revealKey;
    dom.apiKey.type = shouldReveal ? 'text' : 'password';
    dom.toggleKey.textContent = shouldReveal ? 'Hide' : 'Show';
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

async function exportPlain() {
    const confirmed = await callGenericPopup('Plain export contains raw keys. Continue?', POPUP_TYPE.CONFIRM, '');
    if (confirmed !== POPUP_RESULT.AFFIRMATIVE && confirmed !== true) {
        return;
    }
    downloadText('st-api-profiles.json', JSON.stringify(exportPayload(), null, 2));
    setStatus('Plain JSON export downloaded.');
}

async function exportEncrypted() {
    if (!window.crypto?.subtle) {
        setStatus('Encrypted export is not supported in this client.', 'error');
        return;
    }

    const password = await callGenericPopup('Enter a password for encrypted export', POPUP_TYPE.INPUT, '');
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
    setStatus('Encrypted export downloaded.');
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
        const password = await callGenericPopup('Enter the password for this backup', POPUP_TYPE.INPUT, '');
        if (!password || typeof password !== 'string') {
            return;
        }
        payload = await decryptPayload(imported, password);
    }

    if (!Array.isArray(payload.profiles)) {
        throw new Error('Import file does not contain profiles.');
    }

    const settings = getSettings();
    settings.profiles = payload.profiles.map(profile => ({ ...defaultProfile(), ...profile, id: profile.id || crypto.randomUUID() }));
    settings.activeProfileId = payload.activeProfileId && settings.profiles.some(profile => profile.id === payload.activeProfileId)
        ? payload.activeProfileId
        : settings.profiles[0]?.id ?? '';
    settings.preferences = { ...settings.preferences, ...(payload.preferences ?? {}) };
    extension_settings.apiProfileManager = settings;
    persist();
    selectProfile(settings.activeProfileId);
    setStatus(`Imported ${settings.profiles.length} profiles.`);
}

function guessApplyTargets() {
    return [
        '#api_url_text',
        '#openai_api_url',
        '#custom_api_url',
        'input[name="api_url"]',
    ];
}

function guessKeyTargets() {
    return [
        '#api_key_openai',
        '#openai_api_key',
        '#api_key',
        'input[name="api_key"]',
    ];
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

function getProviderConfig(profile) {
    return profile.mode === 'text-generation'
        ? TEXT_PROVIDER_CONFIG[profile.provider] ?? null
        : CHAT_PROVIDER_CONFIG[profile.provider] ?? null;
}

async function applyCurrentProfile() {
    const profile = getSelectedProfile() ?? readDraftFromForm();
    const validationError = validateProfile(profile);
    if (validationError) {
        setStatus(validationError, 'error');
        return;
    }

    const settings = getSettings();
    settings.activeProfileId = profile.id;
    persist();

    const config = getProviderConfig(profile);
    if (!config) {
        setStatus('This provider is not wired yet.', 'error');
        return;
    }

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
        setStatus('Profile applied to SillyTavern connection settings.');
    } else {
        setStatus('Profile marked active, but no matching SillyTavern settings fields were found in the current UI.', 'error');
    }
}

function wireEvents() {
    dom.select.addEventListener('change', () => selectProfile(dom.select.value));
    dom.mode.addEventListener('change', () => populateProviderOptions(dom.mode.value));
    dom.newButton.addEventListener('click', () => {
        const profile = defaultProfile();
        draftProfileId = profile.id;
        fillForm(profile);
        setStatus('New draft created. Save to keep it.');
    });
    dom.duplicateButton.addEventListener('click', duplicateProfile);
    dom.deleteButton.addEventListener('click', deleteProfile);
    dom.saveButton.addEventListener('click', saveProfile);
    dom.resetButton.addEventListener('click', resetDraft);
    dom.applyButton.addEventListener('click', applyCurrentProfile);
    dom.exportButton.addEventListener('click', exportPlain);
    dom.exportEncryptedButton.addEventListener('click', exportEncrypted);
    dom.importButton.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        try {
            await importPayloadFromFile(file);
        } catch (error) {
            console.error(`${MODULE_NAME}: import failed`, error);
            setStatus(error instanceof Error ? error.message : 'Import failed.', 'error');
        } finally {
            dom.importFile.value = '';
        }
    });
    dom.toggleKey.addEventListener('click', () => {
        revealKey = !revealKey;
        updateSecretVisibility();
    });
    dom.maskDefault.addEventListener('input', () => {
        getSettings().preferences.maskKeysByDefault = !!dom.maskDefault.checked;
        if (dom.maskDefault.checked) {
            revealKey = false;
        }
        updateSecretVisibility();
        persist();
    });
}

function bindDom() {
    dom.select = document.getElementById('api_profile_manager_profile_select');
    dom.mode = document.getElementById('api_profile_manager_mode');
    dom.provider = document.getElementById('api_profile_manager_provider');
    dom.name = document.getElementById('api_profile_manager_name');
    dom.baseUrl = document.getElementById('api_profile_manager_base_url');
    dom.apiKey = document.getElementById('api_profile_manager_api_key');
    dom.headerName = document.getElementById('api_profile_manager_header_name');
    dom.headerValue = document.getElementById('api_profile_manager_header_value');
    dom.notes = document.getElementById('api_profile_manager_notes');
    dom.status = document.getElementById('api_profile_manager_status');
    dom.validation = document.getElementById('api_profile_manager_validation');
    dom.newButton = document.getElementById('api_profile_manager_new');
    dom.duplicateButton = document.getElementById('api_profile_manager_duplicate');
    dom.deleteButton = document.getElementById('api_profile_manager_delete');
    dom.applyButton = document.getElementById('api_profile_manager_apply');
    dom.saveButton = document.getElementById('api_profile_manager_save');
    dom.resetButton = document.getElementById('api_profile_manager_reset');
    dom.exportButton = document.getElementById('api_profile_manager_export');
    dom.exportEncryptedButton = document.getElementById('api_profile_manager_export_encrypted');
    dom.importButton = document.getElementById('api_profile_manager_import');
    dom.importFile = document.getElementById('api_profile_manager_import_file');
    dom.toggleKey = document.getElementById('api_profile_manager_toggle_key');
    dom.maskDefault = document.getElementById('api_profile_manager_mask_default');
}

function initializeRevealPreference() {
    revealKey = !getSettings().preferences.maskKeysByDefault;
    updateSecretVisibility();
}

jQuery(async () => {
    const settings = getSettings();
    const target = document.getElementById('rm_api_block') || document.getElementById('extensions_settings2');
    if (!target) {
        console.warn(`${MODULE_NAME}: settings container not found`);
        return;
    }

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings', {});
    target.insertAdjacentHTML('beforeend', html);
    bindDom();
    dom.maskDefault.checked = !!settings.preferences.maskKeysByDefault;
    initializeRevealPreference();
    wireEvents();
    selectProfile(settings.activeProfileId);
    setStatus('Ready');
});
