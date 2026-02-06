# Token Tracker API - Integration Guide

## Quick Setup

1. **Create Supabase Project** → Run `supabase/schema.sql` in SQL Editor
2. **Configure** → Copy `.env.example` to `.env`, fill in Supabase keys
3. **Install** → `npm install`
4. **Run** → `npm start`

---

## Base URL
```
https://your-server.com/api
```

---

## Token Costs
| Model | Tokens/Prompt |
|-------|---------------|
| `claude-opus-4.5` | **3** |
| All other models | **1** |

---

## Device Endpoints

### Register Device
```
POST /devices/register
Body: { "device_name": "My Laptop", "hardware_fingerprint": "unique-id" }
Returns: { device_id, device_token, allocation }
```
- Store `device_token` securely - used for all authenticated requests

### Check Balance
```
GET /devices/{id}/tokens
Header: Authorization: Bearer {device_token}
Returns: { allocated, used, remaining, can_use_tokens }
```

### Log Usage
```
POST /devices/{id}/usage
Header: Authorization: Bearer {device_token}
Body: { "model_type": "claude-opus-4.5", "prompt_count": 1 }
Returns: { tokens_used, remaining }
```
- Returns `403` if insufficient tokens

### Pre-check Before Use
```
POST /devices/check-can-use
Header: Authorization: Bearer {device_token}
Body: { "model_type": "claude-opus-4.5" }
Returns: { can_use: true/false, tokens_needed, remaining }
```

---

## Admin Endpoints

### Login
```
POST /admin/login
Body: { "username": "admin", "password": "your-pass" }
Returns: { token }
```

### Dashboard
```
GET /admin/dashboard
Header: Authorization: Bearer {admin_token}
Returns: { budget, devices: { list: [...] } }
```

### Allocate Tokens
```
POST /admin/allocate
Header: Authorization: Bearer {admin_token}
Body: { "device_id": "...", "tokens": 20 }
```

### Transfer Tokens
```
POST /admin/allocate
Body: { "device_id": "target", "tokens": 10, "from_device_id": "source" }
```

### Block Device
```
POST /admin/block-device
Body: { "device_id": "...", "blocked": true }
```

### Reset Monthly
```
POST /admin/reset-monthly
Body: { "default_tokens": 50 }
```

---

## VS Code Extension Integration

```typescript
// 1. On extension activation - register device
const fingerprint = crypto.createHash('sha256')
  .update(os.hostname() + os.platform() + os.arch())
  .digest('hex');

const res = await fetch(`${API_URL}/devices/register`, {
  method: 'POST',
  body: JSON.stringify({ 
    device_name: os.hostname(), 
    hardware_fingerprint: fingerprint 
  })
});
const { device_token } = await res.json();
// Store device_token in SecretStorage

// 2. Before each AI prompt - check & log
const check = await fetch(`${API_URL}/devices/check-can-use`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${device_token}` },
  body: JSON.stringify({ model_type: 'claude-opus-4.5' })
});
const { can_use } = await check.json();

if (!can_use) {
  vscode.window.showErrorMessage('Token limit reached!');
  return;
}

// 3. After successful prompt - log usage
await fetch(`${API_URL}/usage/log`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${device_token}` },
  body: JSON.stringify({ model_type: 'claude-opus-4.5' })
});
```

---

## Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (missing params) |
| 401 | Invalid/missing token |
| 403 | Blocked or insufficient tokens |
| 404 | Not found |
| 500 | Server error |

---

## Error Responses

```json
{
  "error": "Insufficient tokens",
  "code": "INSUFFICIENT_TOKENS",
  "requested": 3,
  "remaining": 2
}
```

---

## Deploy to DigitalOcean

```bash
# 1. Create droplet (Ubuntu 22.04, $6/mo)
# 2. SSH in and install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Clone repo & install
git clone <your-repo>
cd centralized_token_split
npm install

# 4. Create .env with your Supabase keys

# 5. Install PM2 & run
sudo npm install -g pm2
pm2 start src/server.js --name token-tracker
pm2 save
pm2 startup

# 6. Optional: nginx + SSL
sudo apt install nginx certbot python3-certbot-nginx
# Configure nginx reverse proxy to port 3000
```
