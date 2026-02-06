# 🚀 Deployment Guide — Token Tracker

This guide covers deploying the **backend** (DigitalOcean), **dashboard** (Vercel), and how the **VS Code extension** works for end users.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Backend — DigitalOcean Deployment](#backend--digitalocean-deployment)
3. [Dashboard — Vercel Deployment](#dashboard--vercel-deployment)
4. [Extension — VS Code Marketplace](#extension--vs-code-marketplace)
5. [HTTPS & Custom Domain](#https--custom-domain)
6. [FAQ](#faq)

---

## Architecture Overview

```
┌────────────────────┐      HTTPS       ┌─────────────────────┐
│  VS Code Extension │ ───────────────► │  Backend API         │
│  (any device)      │                  │  (DigitalOcean)      │
└────────────────────┘                  │  api.yourdomain.com  │
                                        │  Node.js + Express   │
┌────────────────────┐      HTTPS       │                      │
│  Admin Dashboard   │ ───────────────► │                      │
│  (Vercel)          │                  └──────────┬───────────┘
│  dashboard.domain  │                             │
└────────────────────┘                             ▼
                                        ┌─────────────────────┐
                                        │  Supabase (Postgres) │
                                        │  Cloud-hosted DB     │
                                        └─────────────────────┘
```

- **Backend API** — Node.js/Express, handles device registration, token tracking, usage logging
- **Dashboard** — React SPA, admin panel for managing devices and budgets
- **Extension** — installed from VS Code Marketplace, tracks Copilot usage per device
- **Database** — Supabase (PostgreSQL), managed cloud database

---

## Backend — DigitalOcean Deployment

### 1. Create a Droplet

1. Log in to [DigitalOcean](https://cloud.digitalocean.com)
2. Create Droplet → **Ubuntu 22.04**, **Basic plan** ($6/mo is plenty)
3. Choose a datacenter close to you
4. Add your SSH key
5. Create the Droplet and note its **IP address**

### 2. Initial Server Setup

```bash
# SSH into your droplet
ssh root@YOUR_DROPLET_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 (process manager)
npm install -g pm2

# Install Nginx (reverse proxy + SSL termination)
apt install -y nginx

# Install Certbot (free SSL certificates)
apt install -y certbot python3-certbot-nginx
```

### 3. Deploy the Backend

```bash
# Create app directory
mkdir -p /var/www/token-tracker
cd /var/www/token-tracker

# Clone repo
git clone https://github.com/AbdulRahmanAzam/vs-code-extension-token-tracker.git .

# Go to backend
cd backend

# Install dependencies
npm install --production

# Create environment file
cp .env.example .env
nano .env  # Edit with your real values
```

Fill in your `.env`:
```env
SUPABASE_URL=https://ezsxjsobmzydrughvijl.supabase.co
SUPABASE_ANON_KEY=your-actual-key
SUPABASE_SERVICE_KEY=your-actual-service-key
JWT_SECRET=a-long-random-secret-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://your-dashboard.vercel.app
```

### 4. Start with PM2

```bash
# Start the app
pm2 start server.js --name token-tracker

# Make it survive reboots
pm2 startup
pm2 save

# Check logs
pm2 logs token-tracker
```

### 5. Configure Nginx Reverse Proxy

```bash
nano /etc/nginx/sites-available/token-tracker
```

Paste this config:
```nginx
server {
    listen 80;
    server_name api.abdulrahmanazam.me;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:
```bash
ln -s /etc/nginx/sites-available/token-tracker /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 6. Point Your Domain

In your domain registrar (where you bought `abdulrahmanazam.me`):

| Type | Name | Value              |
|------|------|--------------------|
| A    | api  | YOUR_DROPLET_IP    |

Wait 5-10 minutes for DNS propagation.

### 7. Enable HTTPS with Let's Encrypt

```bash
certbot --nginx -d api.abdulrahmanazam.me
```

Follow the prompts. Certbot will:
- Get a free SSL certificate
- Auto-configure Nginx for HTTPS
- Set up auto-renewal

Test: `https://api.abdulrahmanazam.me/health` should return `{ "status": "ok" }`

---

## Dashboard — Vercel Deployment

### 1. Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"**
3. Import `vs-code-extension-token-tracker` repository
4. Configure:
   - **Root Directory**: `dashboard`
   - **Framework**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 2. Set Environment Variables

In Vercel project → **Settings → Environment Variables**, add:

| Name            | Value                              |
|-----------------|-------------------------------------|
| `VITE_API_URL`  | `https://api.abdulrahmanazam.me`   |

> **Important**: NO trailing slash! The app appends `/api` automatically.

### 3. Deploy

Click **Deploy**. Vercel will build and publish. Your dashboard is now live at:
- `https://your-project.vercel.app`

### 4. (Optional) Custom Domain

In Vercel → **Settings → Domains**, add `dashboard.abdulrahmanazam.me` and follow the DNS instructions.

---

## Extension — VS Code Marketplace

### Does the extension need to be deployed?

**No!** The extension is already published on the VS Code Marketplace. Anyone can install it:

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for **"Token Tracker"** by Abdul Rahman Azam
4. Click Install
5. Press `Ctrl+Shift+P` → **"Token Tracker: Configure Server URL"**
6. Enter your backend URL: `https://api.abdulrahmanazam.me`

The extension automatically:
- Generates a unique hardware fingerprint (no GitHub account needed!)
- Registers the device with your backend
- Tracks Copilot token usage in real-time
- Syncs data to the backend periodically

---

## HTTPS & Custom Domain

### Do I need HTTPS?

**Yes, strongly recommended.** Here's why:
- VS Code may block HTTP requests from extensions in future versions
- Device tokens are sent in headers — they should be encrypted in transit
- Vercel dashboard is HTTPS by default, so API calls to HTTP would be blocked as "mixed content"
- Let's Encrypt provides **free** SSL certificates

### Domain Setup Summary

| Subdomain                    | Points To            | Purpose          |
|------------------------------|----------------------|------------------|
| `api.abdulrahmanazam.me`     | DigitalOcean Droplet | Backend API      |
| `dashboard.abdulrahmanazam.me` | Vercel (CNAME)     | Admin Dashboard  |

---

## FAQ

### Do other devices need the same GitHub account?

**No!** Devices are identified by a unique hardware fingerprint (SHA-256 hash of MAC address + hostname + platform + architecture + CPU model). No GitHub account or login is needed on client devices. Each device just needs:
1. VS Code with the Token Tracker extension installed
2. The server URL configured (one time)

### How does a friend set up their own instance?

Your friend needs to:

1. **Create their own Supabase project** (free tier: [supabase.com](https://supabase.com))
   - Run the `schema.sql` file in the SQL Editor to create tables

2. **Deploy their own backend**
   - Clone the repo: `git clone https://github.com/AbdulRahmanAzam/vs-code-extension-token-tracker.git`
   - Deploy to any server (DigitalOcean, Railway, Render, Fly.io, etc.)
   - Set up `.env` with their own Supabase credentials

3. **Deploy their own dashboard**
   - Import the same repo to Vercel
   - Set `VITE_API_URL` to their backend URL

4. **Install the extension** from the marketplace
   - Configure server URL to point to their backend

> One friend = one backend + one Supabase project + one dashboard. The extension from the marketplace is shared!

### Can anyone use my server?

By default, any device that installs the extension and enters your server URL can register (up to `max_devices` limit). To control access:
- Set `max_devices` in the admin dashboard
- Monitor devices from the dashboard and remove unauthorized ones
- The 6-device limit in `admin_settings` prevents unlimited registrations

### How do I update the backend after pushing changes?

```bash
ssh root@YOUR_DROPLET_IP
cd /var/www/token-tracker
git pull origin main
cd backend
npm install --production
pm2 restart token-tracker
```

### How do I update the dashboard?

Just push to GitHub! Vercel auto-deploys on every push to the `main` branch.

### What are the costs?

| Service       | Cost     |
|---------------|----------|
| DigitalOcean  | $6/month |
| Supabase      | Free tier (500MB DB, 50k monthly requests) |
| Vercel        | Free tier (100GB bandwidth) |
| Domain        | ~$10/year |
| SSL (Let's Encrypt) | Free |
| **Total**     | **~$6/month + domain** |

---

## Quick Reference

```
Backend URL:    https://api.abdulrahmanazam.me
Dashboard:      https://dashboard.abdulrahmanazam.me (or Vercel URL)
Extension:      VS Code Marketplace → "Token Tracker"
Admin login:    admin / (your password)
```
