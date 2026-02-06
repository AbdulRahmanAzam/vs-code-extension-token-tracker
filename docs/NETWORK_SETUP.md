# 🌐 Network Setup Guide - Multi-Device Token Tracking

## ✅ What's Been Configured

Your PC IP: **192.168.100.6**  
Server Port: **3000**  
Extension updated to use: `http://192.168.100.6:3000`

---

## 📋 Setup Instructions for All 6 Devices

### **On YOUR PC (Server Host - 192.168.100.6)**

#### 1. Start the API Server
```powershell
cd "C:\Users\azama\VS Code\PROJECTS\05 AI Competitions\centralized_token_split"
node src/server.js
```

**Keep this running!** The server must stay active for other devices to connect.

#### 2. Allow Firewall Access (One-time setup)
```powershell
# Run PowerShell as Administrator
New-NetFirewallRule -DisplayName "Token Tracker API" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

Or manually:
- Open **Windows Defender Firewall**
- Click **Advanced settings**
- **Inbound Rules** → **New Rule**
- Port → TCP → Specific local ports: **3000** → Allow the connection

#### 3. Install Extension on Your PC
```powershell
cd "C:\Users\azama\VS Code\PROJECTS\05 AI Competitions\centralized_token_split\extension"
code --install-extension token-tracker-extension-1.0.0.vsix
```

---

### **On OTHER LAPTOPS (5 devices)**

#### 1. Copy the Extension File
Copy `token-tracker-extension-1.0.0.vsix` from your PC to each laptop via:
- USB drive
- Shared network folder
- Cloud storage (Google Drive, OneDrive, etc.)

#### 2. Install the Extension
```bash
# Navigate to where you saved the .vsix file
code --install-extension token-tracker-extension-1.0.0.vsix
```

Or install via VS Code:
- Open VS Code
- **Extensions** (Ctrl+Shift+X)
- Click **"..."** (top-right) → **Install from VSIX**
- Select `token-tracker-extension-1.0.0.vsix`

#### 3. ✅ **Extension Auto-Configured!**
The extension is already configured to use `http://192.168.100.6:3000` — **no manual setup needed!**

#### 4. Verify Connection
In VS Code on each laptop:
- Press **Ctrl+Shift+P**
- Run: `Token Tracker: Show Balance`
- You should see your token balance

---

## 🔍 Testing the Setup

### From Any Laptop (including yours)
```powershell
# Test if the server is reachable
curl http://192.168.100.6:3000/api/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-06T..."
}
```

---

## 🚨 Troubleshooting

### ❌ "Cannot connect to server"
**Check:**
1. Is the server running on your PC? (Check terminal output)
2. Are both devices on the **same WiFi network**?
3. Is Windows Firewall blocking port 3000? (See step 2 above)
4. Try pinging: `ping 192.168.100.6`

### ❌ "Extension not working"
**Run on the laptop:**
- **Ctrl+Shift+P** → `Token Tracker: Configure Server URL`
- Enter: `http://192.168.100.6:3000`
- Restart VS Code

### ❌ Your IP changed (after WiFi reconnect)
1. Check new IP: `ipconfig | Select-String "IPv4"`
2. Update extension on all devices: **Ctrl+Shift+P** → `Token Tracker: Configure Server URL`
3. Enter the new IP

---

## 📊 Access Admin Dashboard

From **any device** on the network, open in browser:
```
http://192.168.100.6:5173
```

Login:
- **Username:** `admin`
- **Password:** `admin123`

---

## ⚠️ Important Notes

### **While Testing on Same Network:**
- ✅ Your PC must stay ON and connected to WiFi
- ✅ All 6 devices must be on the **same network**
- ✅ Server must be running on your PC
- ✅ Your IP can change if you reconnect to WiFi

### **For Production (Deploy to Cloud):**
When ready, deploy to DigitalOcean VPS so:
- ✅ Server runs 24/7 independently
- ✅ Devices can connect from anywhere
- ✅ Fixed IP/domain name (no changes)

---

## 📦 File Locations

- **Extension VSIX:** `extension/token-tracker-extension-1.0.0.vsix`
- **Server:** Start from project root: `node src/server.js`
- **Dashboard:** `cd dashboard && npm run dev`

---

## 🎯 Quick Start Checklist

**On Your PC:**
- [ ] Start API server: `node src/server.js`
- [ ] Allow firewall port 3000
- [ ] Start dashboard: `cd dashboard && npm run dev`
- [ ] Install extension: `code --install-extension token-tracker-extension-1.0.0.vsix`

**On Other 5 Laptops:**
- [ ] Copy `token-tracker-extension-1.0.0.vsix` to laptop
- [ ] Install: `code --install-extension token-tracker-extension-1.0.0.vsix`
- [ ] Test: Run `Token Tracker: Show Balance`

Done! All 6 devices now share 300 tokens (50 each) tracked centrally from your PC.
