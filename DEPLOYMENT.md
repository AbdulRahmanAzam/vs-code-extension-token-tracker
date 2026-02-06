# Token Tracker — Production Deployment Guide

Complete step-by-step guide for deploying the Token Tracker SaaS system.

---

## 📋 Prerequisites

- DigitalOcean Droplet (Ubuntu 20.04+) — IP: `143.110.242.20`
- Domain: `abdulrahmanazam.me` with Cloudflare DNS
- Supabase project: `https://ezsxjsobmzydrughvijl.supabase.co`
- GitHub repo: `https://github.com/AbdulRahmanAzam/vs-code-extension-token-tracker`

---

## 🌐 PART 1: Cloudflare DNS Setup

### 1.1 Add DNS Records

Go to Cloudflare Dashboard → Your domain → DNS → Records

**For Backend:**
- **Type**: A
- **Name**: `tokentrackerbackend`
- **IPv4**: `143.110.242.20`
- **Proxy**: 🟠 **ON** (orange cloud)
- **TTL**: Auto

**For Dashboard** (if using custom domain on Vercel):
- **Type**: CNAME
- **Name**: `tokentrackerdasboard`
- **Target**: `cname.vercel-dns.com`
- **Proxy**: 🟠 **ON**

### 1.2 Configure Page Rules (Prevent API Caching)

Go to **Rules** → **Page Rules** → **Create Page Rule**:
- **URL**: `tokentrackerbackend.abdulrahmanazam.me/*`
- **Setting**: Cache Level → **Bypass**
- Click **Save and Deploy**

---

## 🖥️ PART 2: Backend Deployment (DigitalOcean)

### 2.1 Initial Server Setup

SSH into your DigitalOcean droplet or use the web console:

```bash
# Update system
apt-get update && apt-get upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verify installation
node --version  # Should show v20.x
npm --version

# Install essential tools
apt-get install -y git nginx certbot python3-certbot-nginx postgresql-client
```

### 2.2 Clone Repository

```bash
# Navigate to token-tracker directory (you already created this)
cd ~/token-tracker

# Clone the repository
git clone https://github.com/AbdulRahmanAzam/vs-code-extension-token-tracker.git .

# If directory isn't empty, use:
# git clone https://github.com/AbdulRahmanAzam/vs-code-extension-token-tracker.git temp
# mv temp/* .
# rm -rf temp

# Navigate to backend folder
cd backend

# Verify files exist
ls -la
# Should see: server.js, package.json, routes/, database/, etc.
```

### 2.3 Install Backend Dependencies

```bash
cd ~/token-tracker/backend
npm install

# Verify installation
npm list --depth=0
```

### 2.4 Create Environment File

```bash
cd ~/token-tracker/backend
nano .env
```

**Paste this configuration** (update the values):

```dotenv
# Supabase Configuration
SUPABASE_URL=https://ezsxjsobmzydrughvijl.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6c3hqc29ibXp5ZHJ1Z2h2aWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5MTY3NjUsImV4cCI6MjA1NDQ5Mjc2NX0.jRAOLqSYl3gT663KUhcQcXkTjQmGy7PrvOxLbKh_vMI
SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE

# JWT Secret (generate a secure random string)
JWT_SECRET=CHANGE_THIS_TO_RANDOM_STRING_RUN_openssl_rand_hex_32

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# Server configuration
PORT=3000
NODE_ENV=production

# Token limits
DEFAULT_MONTHLY_TOKENS=50
TOTAL_MONTHLY_BUDGET=1000
MAX_DEVICES=10

# CORS - Allow dashboard and backend domains
ALLOWED_ORIGINS=https://tokentrackerdasboard.abdulrahmanazam.me,https://tokentrackerbackend.abdulrahmanazam.me
```

**To generate a secure JWT_SECRET:**
```bash
openssl rand -hex 32
# Copy the output and replace JWT_SECRET value
```

**To get your Supabase Service Role Key:**
1. Go to Supabase Dashboard → Settings → API
2. Copy the `service_role` key (NOT the anon key)
3. Replace `YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE`

**Save the file:**
- Press `Ctrl + X`
- Press `Y` (yes to save)
- Press `Enter` (confirm filename)

### 2.5 Apply Database Schema v2

**Option A: Using Supabase Dashboard (RECOMMENDED)**

1. Go to your Supabase project → SQL Editor
2. On your local machine, open `backend/database/schema_v2.sql`
3. Copy the entire contents
4. Paste into Supabase SQL Editor
5. Click **RUN**
6. Verify success (no errors)

**Option B: Using psql command line**

First, get your Supabase connection string:
- Supabase Dashboard → Settings → Database → Connection string → URI

```bash
cd ~/token-tracker/backend

# Replace YOUR_PASSWORD with your actual database password
psql "postgresql://postgres.ezsxjsobmzydrughvijl:YOUR_PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" -f database/schema_v2.sql
```

### 2.6 Test Backend Locally

```bash
cd ~/token-tracker/backend

# Run the server
node server.js

# You should see:
# Token Tracker API running on port 3000
# Environment: production
```

**Test in another terminal/tab:**
```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2026-02-06T...","version":"2.0.0"}
```

**Stop the test server:** Press `Ctrl + C`

---

## 🔄 PART 3: PM2 Process Manager Setup

PM2 keeps your Node.js app running 24/7 and auto-restarts on crashes.

### 3.1 Install PM2

```bash
npm install -g pm2
```

### 3.2 Start the Backend with PM2

```bash
cd ~/token-tracker/backend

# Start the app
pm2 start server.js --name token-tracker-api

# View status
pm2 status

# View logs
pm2 logs token-tracker-api --lines 50
```

### 3.3 Configure Auto-Restart on Server Reboot

```bash
# Generate startup script
pm2 startup

# You'll see a command like:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root
# Copy and run that exact command

# Save current PM2 process list
pm2 save
```

### 3.4 Useful PM2 Commands

```bash
pm2 status                      # View all processes
pm2 logs token-tracker-api      # View real-time logs
pm2 logs token-tracker-api --lines 100  # View last 100 lines
pm2 restart token-tracker-api   # Restart the app
pm2 stop token-tracker-api      # Stop the app
pm2 delete token-tracker-api    # Remove from PM2
pm2 monit                       # Real-time monitoring dashboard
```

---

## 🔀 PART 4: Nginx Reverse Proxy Setup

Nginx routes external traffic (port 80/443) to your Node.js app (port 3000).

### 4.1 Create Nginx Configuration

```bash
nano /etc/nginx/sites-available/token-tracker
```

**Paste this configuration:**

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tokentrackerbackend.abdulrahmanazam.me;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # API endpoints
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        
        # WebSocket support (if needed in future)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # Proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Disable caching for API
        proxy_cache_bypass $http_upgrade;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    # Health check endpoint - allow monitoring without auth
    location /api/health {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        access_log off;  # Don't log health checks
    }
}
```

**Save:** `Ctrl + X` → `Y` → `Enter`

### 4.2 Enable the Site

```bash
# Create symbolic link to enable site
ln -s /etc/nginx/sites-available/token-tracker /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Should see:
# nginx: configuration file /etc/nginx/nginx.conf test is successful

# Reload Nginx
systemctl reload nginx

# Check Nginx status
systemctl status nginx
```

### 4.3 Test HTTP Access

```bash
# From server
curl http://tokentrackerbackend.abdulrahmanazam.me/api/health

# From your local machine (PowerShell)
# curl http://tokentrackerbackend.abdulrahmanazam.me/api/health
```

---

## 🔒 PART 5: SSL Certificate Setup (Let's Encrypt)

### 5.1 Obtain SSL Certificate

```bash
# Get certificate
certbot --nginx -d tokentrackerbackend.abdulrahmanazam.me

# Follow the prompts:
# 1. Enter your email address
# 2. Agree to Terms of Service (Y)
# 3. Share email with EFF? (your choice, N is fine)
# 4. Choose option 2: Redirect all HTTP to HTTPS
```

Certbot will automatically:
- Obtain a certificate from Let's Encrypt
- Update your Nginx config
- Setup auto-renewal

### 5.2 Test SSL Configuration

```bash
# Test auto-renewal
certbot renew --dry-run

# Should see: "Congratulations, all simulated renewals succeeded"
```

### 5.3 Verify HTTPS Works

```bash
# From server
curl https://tokentrackerbackend.abdulrahmanazam.me/api/health

# From local machine (PowerShell)
# curl https://tokentrackerbackend.abdulrahmanazam.me/api/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2026-02-06T...","version":"2.0.0"}
```

---

## 📊 PART 6: Dashboard Deployment (Vercel)

### 6.1 Create Production Environment File (Local)

On your **local machine**, create the production environment file:

```powershell
cd "c:\Users\azama\VS Code\PROJECTS\05 AI Competitions\centralized_token_split\dashboard"
New-Item -ItemType File -Path ".env.production" -Force
```

Edit `.env.production`:
```dotenv
VITE_API_URL=https://tokentrackerbackend.abdulrahmanazam.me
```

### 6.2 Commit and Push

```powershell
cd "c:\Users\azama\VS Code\PROJECTS\05 AI Competitions\centralized_token_split"

git add dashboard/.env.production DEPLOYMENT.md
git commit -m "Add deployment guide and production env"
git push origin main
```

### 6.3 Deploy on Vercel

1. Go to [vercel.com](https://vercel.com/dashboard)
2. Click **Add New** → **Project**
3. Import `AbdulRahmanAzam/vs-code-extension-token-tracker`
4. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `dashboard` ← **IMPORTANT**
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. **Environment Variables**:
   - Key: `VITE_API_URL`
   - Value: `https://tokentrackerbackend.abdulrahmanazam.me`
6. Click **Deploy**
7. Wait for deployment to complete (~2-3 minutes)

### 6.4 Add Custom Domain (Optional)

In Vercel project settings:
1. Go to **Settings** → **Domains**
2. Add: `tokentrackerdasboard.abdulrahmanazam.me`
3. Follow Vercel's DNS instructions (you already set up CNAME in Cloudflare)

---

## ✅ PART 7: Verification & Testing

### 7.1 Backend Health Check

```bash
# From server
curl https://tokentrackerbackend.abdulrahmanazam.me/api/health

# Expected:
# {"status":"healthy","timestamp":"2026-02-06T...","version":"2.0.0"}
```

### 7.2 Admin Login Test

```bash
curl -X POST https://tokentrackerbackend.abdulrahmanazam.me/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Expected:
# {"token":"eyJhbGc...","message":"Login successful"}
```

### 7.3 Dashboard Access

Open in browser:
- **Vercel default URL**: `https://your-project.vercel.app`
- **Custom domain**: `https://tokentrackerdasboard.abdulrahmanazam.me`

Try logging in with:
- Username: `admin`
- Password: `admin123`

### 7.4 Extension Test

1. Open VS Code
2. Install extension: **Token Tracker - Copilot Usage Limiter** (v2.0.0)
3. Click "Sign In" when prompted
4. Register a new account or use GitHub OAuth
5. Verify device auto-links
6. Check status bar shows token balance

---

## 🔧 PART 8: Maintenance & Updates

### 8.1 Update Backend Code

```bash
# SSH into server
ssh root@143.110.242.20

cd ~/token-tracker

# Pull latest changes
git pull origin main

# Install any new dependencies
cd backend
npm install

# Restart PM2
pm2 restart token-tracker-api

# Check logs
pm2 logs token-tracker-api --lines 50
```

### 8.2 View Logs

```bash
# Real-time logs
pm2 logs token-tracker-api

# Last 200 lines
pm2 logs token-tracker-api --lines 200

# Error logs only
pm2 logs token-tracker-api --err

# Nginx access logs
tail -f /var/log/nginx/access.log

# Nginx error logs
tail -f /var/log/nginx/error.log
```

### 8.3 Database Backups

Use Supabase's built-in backup system:
1. Supabase Dashboard → Database → Backups
2. Backups are automatic daily
3. Can restore to any point in time

### 8.4 Monitor Resources

```bash
# System resources
htop  # or 'top' if htop not installed

# PM2 monitoring
pm2 monit

# Disk usage
df -h

# Memory usage
free -h
```

---

## 🚨 Troubleshooting

### Backend Won't Start

```bash
# Check PM2 logs
pm2 logs token-tracker-api --err --lines 100

# Common issues:
# 1. Port 3000 already in use
netstat -tulpn | grep :3000
# Kill process: kill -9 <PID>

# 2. Missing environment variables
cat ~/token-tracker/backend/.env

# 3. Database connection failed
# Check Supabase credentials in .env
```

### Nginx Returns 502 Bad Gateway

```bash
# Check if backend is running
pm2 status

# Check Nginx logs
tail -f /var/log/nginx/error.log

# Restart services
pm2 restart token-tracker-api
systemctl restart nginx
```

### SSL Certificate Issues

```bash
# Check certificate status
certbot certificates

# Renew manually if needed
certbot renew

# Force renewal
certbot renew --force-renewal
```

### CORS Errors in Browser

Check `backend/.env`:
```dotenv
ALLOWED_ORIGINS=https://tokentrackerdasboard.abdulrahmanazam.me,https://tokentrackerbackend.abdulrahmanazam.me
```

Restart after changes:
```bash
pm2 restart token-tracker-api
```

---

## 📝 Post-Deployment Checklist

- [ ] Cloudflare DNS A record added (proxied)
- [ ] Backend cloned from GitHub
- [ ] `.env` file created with Supabase credentials
- [ ] Database schema_v2.sql applied
- [ ] PM2 running backend successfully
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate obtained (HTTPS working)
- [ ] Dashboard deployed to Vercel
- [ ] Admin login works on dashboard
- [ ] Extension v2.0.0 connects successfully
- [ ] User registration works
- [ ] Device linking works
- [ ] Token tracking functions properly

---

## 🔗 Important URLs

- **Backend API**: https://tokentrackerbackend.abdulrahmanazam.me
- **Dashboard**: https://tokentrackerdasboard.abdulrahmanazam.me (or Vercel URL)
- **Health Check**: https://tokentrackerbackend.abdulrahmanazam.me/api/health
- **GitHub Repo**: https://github.com/AbdulRahmanAzam/vs-code-extension-token-tracker
- **Marketplace**: https://marketplace.visualstudio.com/items?itemName=Abdul-Rahman-Azam.token-tracker-extension

---

## 📞 Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs token-tracker-api`
2. Check Nginx logs: `tail -f /var/log/nginx/error.log`
3. Verify environment variables: `cat ~/token-tracker/backend/.env`
4. Test backend locally: `curl http://localhost:3000/api/health`
5. Check Supabase connection in dashboard

---

**Deployment Status**: Ready for Production 🚀
**Version**: 2.0.0
**Last Updated**: February 6, 2026
