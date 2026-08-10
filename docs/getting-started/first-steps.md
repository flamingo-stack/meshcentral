# First Steps

After your MeshCentral server is up and running, here are the first five things to do to get the most out of the platform.

---

## 1. Secure Your Server Configuration

Before adding devices, lock down the server settings:

**Disable open account registration** (production):

```json
{
  "domains": {
    "": {
      "newAccounts": false
    }
  }
}
```

**Set a strong session key** to protect session cookies:

```json
{
  "settings": {
    "sessionKey": "a-long-random-string-change-this"
  }
}
```

**Enable HTTPS** by configuring your domain and TLS:

```json
{
  "settings": {
    "cert": "mesh.yourdomain.com",
    "port": 443,
    "redirPort": 80
  }
}
```

Restart MeshCentral after any `config.json` changes:

```bash
node meshcentral.js
```

> Configuration file reference: [`sample-config.json`](https://github.com/flamingo-stack/meshcentral/blob/main/sample-config.json) and `sample-config-advanced.json` are included in the repository with annotated examples.

---

## 2. Enable Multi-Factor Authentication

MeshCentral supports both TOTP (authenticator apps) and FIDO2/WebAuthn hardware keys.

To enable MFA for your admin account:

1. Log in to the web UI
2. Click your account name (top-right) → **My Account**
3. Under **Two-Factor Authentication**, click **Add Authenticator**
4. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
5. Enter the verification code to confirm

For FIDO2/WebAuthn (hardware security keys):

1. In **My Account** → **Two-Factor Authentication**, click **Add Security Key**
2. Follow the browser prompt to register your hardware key (YubiKey, passkeys, etc.)

> The WebAuthn module supports `none`, `fido-u2f`, and `packed` attestation formats. See [`webauthn.js`](https://github.com/flamingo-stack/meshcentral/blob/main/webauthn.js) for implementation details.

---

## 3. Create Your First Device Group and Install an Agent

A **Device Group** (Mesh) is the organizational unit for managed devices.

**Create a device group:**

1. Navigate to **My Devices**
2. Click **Add Device Group**
3. Choose a type: **Managed using a software agent** (most common)
4. Name your group and click **OK**

**Install a MeshAgent on a device:**

1. Click the device group you created
2. Click **Add Agent**
3. Select the target operating system
4. Download the installer and run it on the managed device

The device will appear in your group within seconds of the agent connecting.

**Alternatively, use meshctrl** to add a local device:

```bash
node meshctrl.js addlocaldevice \
  --url wss://mesh.yourdomain.com \
  --loginuser admin \
  --loginpass yourpassword \
  --meshname "My Servers" \
  --hostname "mydevice.local"
```

---

## 4. Try Remote Desktop, Terminal, and File Access

Once a device is connected, click on it to open the device panel:

| Feature | How to Access |
|---|---|
| **Remote Desktop** | Click **Desktop** — launches browser-based VNC/KVM session |
| **Terminal** | Click **Terminal** — opens Xterm.js SSH/shell session |
| **Files** | Click **Files** — browser-based file manager |
| **Send Message** | Click **Msg** — push a toast notification to the device |
| **Power Control** | Click **Power** — wake, sleep, restart, shutdown |

> Remote Desktop uses the full noVNC RFB implementation supporting Raw, Tight, ZRLE, and Hextile encodings. The terminal supports SIXEL and OSC 1337 image rendering via the Xterm Addon Image.

---

## 5. Explore the meshctrl Command-Line Tool

`meshctrl.js` is a powerful CLI tool that connects to MeshCentral via WebSocket and provides 50+ administrative commands. It's useful for scripting and automation.

```bash
# List all connected devices
node meshctrl.js listdevices \
  --url wss://mesh.yourdomain.com \
  --loginuser admin \
  --loginpass yourpassword

# Upload a file to a remote device
node meshctrl.js upload \
  --url wss://mesh.yourdomain.com \
  --loginuser admin \
  --loginpass yourpassword \
  --id '//domain/device/nodeid' \
  --localfile ./script.sh \
  --remotefile /tmp/script.sh

# Monitor live events
node meshctrl.js showevents \
  --url wss://mesh.yourdomain.com \
  --loginuser admin \
  --loginpass yourpassword
```

Available command categories:

| Category | Commands |
|---|---|
| User Management | `adduser`, `edituser`, `removeuser`, `listusers` |
| Device Management | `listdevices`, `deviceinfo`, `editdevice`, `removedevice` |
| Remote Operations | `shell`, `runcommand`, `upload`, `download` |
| Notifications | `devicetoast`, `broadcast` |
| Reporting | `report`, `listevents`, `showevents` |

---

## Where to Get Help

- **Community:** Join the [OpenMSP Slack](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA) for questions, support, and discussion
- **Platform:** Learn about the full [OpenFrame](https://openframe.ai) MSP platform at [https://flamingo.run](https://flamingo.run)
- **Source Code:** Browse the repository at [https://github.com/flamingo-stack/meshcentral](https://github.com/flamingo-stack/meshcentral)
- **Sample Config:** See [`sample-config-advanced.json`](https://github.com/flamingo-stack/meshcentral/blob/main/sample-config-advanced.json) for a fully annotated configuration reference
