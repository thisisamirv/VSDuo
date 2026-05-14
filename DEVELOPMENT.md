# Development

```powershell
npm install
npm run build
npm test
```

Press `F5` in VS Code from the repository root to launch an Extension Development Host.

GitHub Actions runs the same validation on every push and pull request by building the extension, running the automated tests, and packaging a VSIX artifact.

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

1. Use `VSDuo: Connect Current Window to SSH Host`, or click a host in the `HOSTS` view.
2. If `vsduo.remoteHelperAutoStart` is `background` or `backgroundAndOpen`, VSDuo starts the helper on the local side before handing off to Remote SSH.
3. When the helper is started by that connect flow, VSDuo opens the helper page in your browser first so it is ready for the Duo prompt.
4. If `vsduo.remoteHelperAutoStart` is `backgroundAndOpen`, VSDuo also reopens the helper page on later VSDuo connect actions even if the helper is already running.
5. Keep the helper page available while VS Code reconnects.
6. Approve or deny the Duo prompt from that page if the editor window is temporarily unavailable.
7. Run `VSDuo: Stop Remote SSH Helper` when you are done.

The helper listens only on `127.0.0.1`. VSDuo also restarts it automatically after device changes so the helper stays in sync with added, renamed, removed, imported, or cleared devices.

VSDuo now also activates when the main Remote SSH connect commands run, so the helper auto-start path is available during a Remote SSH launch instead of only after ordinary startup.

## Installation

After packaging, install the generated VSIX into VS Code:

```powershell
code.cmd --install-extension .\vsduo-auth-<version>.vsix --force
```

Then run `Developer: Reload Window` in VS Code so the updated extension is loaded.
