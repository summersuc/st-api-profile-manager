# Security Notes

- This extension stores profile data in SillyTavern client-side extension settings.
- Key masking only hides the key in the visible form field.
- Plain JSON export contains raw secrets.
- Encrypted export uses PBKDF2 + AES-GCM through the browser Web Crypto API.
- Encrypted export protects the backup file, not the live settings storage.
- For stronger isolation, a server-side plugin or external secret manager would be required.
