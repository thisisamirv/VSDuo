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
- Show SSH hosts from the same SSH config used by Remote SSH and connect the current window directly from the VSDuo view.
- Import and export the existing Auto 2FA data format for compatibility.

## Add a Device

When you run `VSDuo: Add Device`, the extension expects a Duo activation code rather than a QR scan. Use the same flow documented in the in-product prompt:

1. Go to your organization website and manage Duo devices.
2. Add a new device.
3. Choose Duo Mobile.
4. Choose `I have a tablet`.
5. Select `Next`.
6. Choose `Get an activation link instead`.
7. Enter your email address and send the email.
8. Open the link in the email.
9. Copy the activation code from that webpage and paste it into VSDuo.

After that, VSDuo asks you to give the device a name such as `Work iPhone` and stores it in VS Code secret storage.

## Remote SSH Integration

VSDuo integrates with Remote - SSH by reading the same SSH config file that Remote - SSH uses and listing those entries in the `HOSTS` view. The intended flow is to start the SSH connection from VSDuo itself so the helper can be prepared before the window hands off to Remote - SSH.

Use the `HOSTS` view as the entry point for SSH connections:

1. Select or confirm the active Duo device in `DEVICES`.
2. Check pending requests in `PENDING TRANSACTIONS` if needed.
3. Click the target machine in `HOSTS` to connect the current window.
4. Let VSDuo start the helper page before Remote - SSH begins the window transition.

The main VSDuo view shows devices, pending transactions, and SSH hosts together. SSH hosts should be connected from this view so VSDuo can prepare the Duo helper before the Remote - SSH reconnect flow begins.

![VSDuo activity bar with devices, transactions, and hosts](https://raw.githubusercontent.com/thisisamirv/VSDuo/refs/heads/master/media/window1.png)

When a VSDuo-initiated SSH connection starts, the extension opens the localhost helper page in your browser. Keep that page open during the reconnect so you can approve or deny the Duo prompt even while the VS Code window is reloading.

![VSDuo helper page in the browser](https://raw.githubusercontent.com/thisisamirv/VSDuo/refs/heads/master/media/window2.png)
