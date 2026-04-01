# API Profile Manager for SillyTavern

Manage multiple API URL and key profiles in SillyTavern, then switch between them quickly.

## Features

- Save multiple API profiles
- Choose connection mode and provider per profile
- Apply a saved profile to SillyTavern connection fields and reconnect
- Export backups as plain JSON
- Export backups with password-based encryption
- Import plain or encrypted backups
- Mask keys by default in the UI

## Important limitation

This is a **client-side UI extension**, not a secure vault. API keys remain stored in SillyTavern client settings. The encrypted export option only protects the exported backup file.

## Installation

1. Push this folder to a GitHub repository.
2. Update `manifest.json` → `homePage` to your repository URL.
3. In SillyTavern, open **Extensions**.
4. Paste the repository URL into **Install extension**.
5. Install and enable **API Profile Manager**.

## Notes

## Supported apply targets

- Chat Completions: `custom`, `openai`, `azure_openai`
- Text Generation: `generic`, `ooba`, `vllm`, `aphrodite`, `tabby`, `koboldcpp`, `llamacpp`, `ollama`, `huggingface`

The current `Apply` action uses SillyTavern's existing selectors and connect buttons for those providers. If your setup uses a different provider, extend the provider maps in `index.js`.
