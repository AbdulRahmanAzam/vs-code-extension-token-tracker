<p align="center">
  <img src="https://raw.githubusercontent.com/AbdulRahmanAzam/vs-code-extension-token-tracker/main/extension/media/banner.png" alt="Token Tracker Banner" width="700"/>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Abdul-Rahman-Azam.token-tracker-extension"><img src="https://img.shields.io/visual-studio-marketplace/v/Abdul-Rahman-Azam.token-tracker-extension?style=for-the-badge&logo=visual-studio-code&logoColor=00ff88&label=VERSION&color=00ff88&labelColor=0a0a0a" alt="Version"/></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Abdul-Rahman-Azam.token-tracker-extension"><img src="https://img.shields.io/visual-studio-marketplace/i/Abdul-Rahman-Azam.token-tracker-extension?style=for-the-badge&logo=visual-studio-code&logoColor=22c55e&label=INSTALLS&color=22c55e&labelColor=0a0a0a" alt="Installs"/></a>
  <img src="https://img.shields.io/badge/LICENSE-MIT-blue?style=for-the-badge&logoColor=3b82f6&labelColor=0a0a0a&color=3b82f6" alt="License"/>
  <img src="https://img.shields.io/badge/PUBLISHER-Abdul%20Rahman%20Azam-a855f7?style=for-the-badge&logoColor=a855f7&labelColor=0a0a0a" alt="Publisher"/>
</p>

<p align="center">
  <b>Track, limit & manage GitHub Copilot token usage across all your devices from one central dashboard.</b><br/>
  <sub>Built by <strong>Abdul Rahman Azam</strong> · MIT Licensed</sub>
</p>

---

## ⚡ What is Token Tracker?

A **centralized token management system** that monitors every GitHub Copilot interaction across your VS Code instances, enforces monthly budgets per device, and provides a stunning real-time admin dashboard — all self-hosted.

> **Perfect for:** Teams, labs, or individuals managing Copilot usage across multiple machines.

---

## 🖥️ Live Status Bar

The extension adds a **real-time token counter** to your VS Code status bar — always visible, always synced.

<p align="center">
  <img src="https://raw.githubusercontent.com/AbdulRahmanAzam/vs-code-extension-token-tracker/main/extension/media/statusbar.png" alt="Status Bar Preview" width="700"/>
</p>

---

## 🎯 Key Features

| Feature | Description |
|---------|-------------|
| ⚡ **Real-time Tracking** | Every Copilot chat, inline completion & command is tracked automatically |
| 🔒 **Auto-Blocking** | Copilot gets disabled when a device reaches its monthly limit |
| 📊 **Admin Dashboard** | Beautiful React dashboard with dark & light themes |
| 🔄 **Token Transfers** | Move unused tokens between devices instantly |
| 🏷️ **Model-Aware Pricing** | Claude Opus 4.5 = 3 tokens, standard models = 1 token, free models = 0 |
| 📱 **Multi-Device** | Track unlimited VS Code instances from one server |
| 💾 **Offline Caching** | Usage is cached locally and synced when the server is reachable |
| 🎨 **Dark + Light Themes** | Both modes in a professional green-accented design |

---

## 🌑 Dashboard — Dark Mode

<p align="center">
  <img src="https://raw.githubusercontent.com/AbdulRahmanAzam/vs-code-extension-token-tracker/main/extension/media/dashboard-dark.png" alt="Dashboard Dark Mode" width="800"/>
</p>

---

## 🌕 Dashboard — Light Mode

<p align="center">
  <img src="https://raw.githubusercontent.com/AbdulRahmanAzam/vs-code-extension-token-tracker/main/extension/media/dashboard-light.png" alt="Dashboard Light Mode" width="800"/>
</p>

---

## 🔐 Secure Login

<p align="center">
  <img src="https://raw.githubusercontent.com/AbdulRahmanAzam/vs-code-extension-token-tracker/main/extension/media/login.png" alt="Login Screen" width="400"/>
</p>

---

## 🏗️ Architecture

<p align="center">
  <img src="https://raw.githubusercontent.com/AbdulRahmanAzam/vs-code-extension-token-tracker/main/extension/media/architecture.png" alt="System Architecture" width="800"/>
</p>

---

## 🚀 Quick Start

### 1. Install the Extension
- Search **"Token Tracker"** in VS Code Extensions
- Or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=Abdul-Rahman-Azam.token-tracker-extension)

### 2. Set Up the Server
```bash
# Clone & install
cd backend
npm install

# Configure .env with your Supabase credentials
cp .env.example .env

# Start
node server.js
```

### 3. Configure the Extension
- Open Command Palette → `Token Tracker: Configure Server URL`
- Enter your server URL (default: `http://192.168.100.6:3000`)

### 4. Launch the Dashboard
```bash
cd dashboard
npm install && npm run dev
```
Open `http://localhost:5173` → Login with admin credentials → Manage!

---

## 🔄 Changing Your Token Key

If you need to switch to a different token key (e.g., after regenerating keys on the dashboard):

1. **Open Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run: `Token Tracker: Remove Token Key & Reset`
3. Confirm the deactivation
4. Run: `Token Tracker: Enter Token Key`
5. Paste your new token key from the dashboard

Your extension will be reactivated with the new token and allocation.

---

## ⚙️ Extension Commands

| Command | Description |
|---------|-------------|
| `Token Tracker: Show Balance` | View current token usage & remaining balance |
| `Token Tracker: Sync with Server` | Force sync with the central server |
| `Token Tracker: Show Usage History` | View recent Copilot usage log |
| `Token Tracker: Configure Server URL` | Set the tracking server endpoint |

---

## 🏷️ Token Cost Matrix

| Model | Cost |
|-------|------|
| 🟣 Claude Opus 4.5 | **3 tokens** |
| 🔵 GPT-4 / Claude Sonnet / Others | **1 token** |
| 🟢 GPT-5 Mini / Grok Code Fast | **FREE** |

---

## 🔧 Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `tokenTracker.serverUrl` | `http://192.168.100.6:3000` | Central server URL |
| `tokenTracker.enabled` | `true` | Enable/disable tracking |
| `tokenTracker.showStatusBar` | `true` | Show balance in status bar |
| `tokenTracker.blockOnLimitReached` | `true` | Block Copilot at limit |

---

## 📦 Tech Stack

- **Extension:** TypeScript · VS Code API
- **Server:** Node.js · Express · JWT
- **Database:** Supabase (PostgreSQL)
- **Dashboard:** React 18 · Vite · Tailwind-inspired CSS
- **Themes:** CSS custom properties with dark/light toggle

---

## 👨‍💻 Publisher

**Abdul Rahman Azam**

> Developed as a centralized solution for managing AI coding assistant costs across multiple development workstations.

---

<p align="center">
  <sub>Made with ⚡ by <strong>Abdul Rahman Azam</strong></sub><br/>
  <sub>Token Tracker v2.1.1 · MIT License</sub>
</p>
