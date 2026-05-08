# VSDuo

VSDuo is a VS Code extension for managing Duo devices from the editor. It polls pending Duo transactions and lets you approve, deny, or copy TOTP codes without any browser-extension code in this repo.

## Attribution

This project is inspired by [Auto-2FA](https://github.com/FreshSupaSulley/Auto-2FA/).

Parts of the implementation and supporting ideas were adapted from that project and used here as part of this VS Code extension.

## Features

- Add a Duo device from an activation code.
- Store Duo device material in VS Code secret storage.
- View devices and pending transactions in the activity bar.
- Approve or deny pending Duo transactions.
- Handle Duo Verified prompts by entering the requested digits.
- Copy live TOTP codes for devices that expose `hotp_secret`.
- Start a detached localhost helper page that stays available during Remote SSH window reloads.
- Import and export the existing Auto 2FA data format for compatibility.

## Not Included

- Browser tab integration.
- QR-code scraping from web pages.
- Any Chrome, Firefox, or WXT browser-extension build.

## Development

```powershell
npm install
npm run build
```

Press `F5` in VS Code from the repository root to launch an Extension Development Host.

## Packaging

```powershell
npm run package
```

This builds the extension and creates a `.vsix` package.

To build a VSIX for the Visual Studio Code Marketplace packaging flow, use:

```powershell
npm run package:marketplace
```

## Remote SSH Workaround

Remote SSH reloads and recomposes the VS Code window during connection, so activity bar views can disappear for a short time even when the extension is correctly marked as a local UI extension.

VSDuo includes a workaround for that flow:

1. Run `VSDuo: Start Remote SSH Helper` before you begin the SSH connection.
2. Keep the opened browser page available while VS Code reconnects.
3. Approve or deny the Duo prompt from that page if the editor window is temporarily unavailable.
4. Run `VSDuo: Stop Remote SSH Helper` when you are done.

The helper listens only on `127.0.0.1` and keeps the current Duo device material in the helper process memory for that session.

## Installation

After packaging, install the generated VSIX into VS Code:

```powershell
code.cmd --install-extension .\vsduo-auth-0.1.3.vsix --force
```

Then run `Developer: Reload Window` in VS Code so the updated extension is loaded.
