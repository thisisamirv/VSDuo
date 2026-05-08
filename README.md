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

## Installation

After packaging, install the generated VSIX into VS Code:

```powershell
code.cmd --install-extension .\vsduo-0.1.2.vsix --force
```

Then run `Developer: Reload Window` in VS Code so the updated extension is loaded.

## Publishing

The extension manifest is configured for the `thisisamirv` publisher and GitHub repository.

Before publishing to the Visual Studio Code Marketplace, make sure the `thisisamirv` publisher exists in the Marketplace and that you are authenticated for `vsce publish`.
