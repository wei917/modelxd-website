# ModelXD — Deployment Guide

## What's in this package

```
modelxd/
├── app/
│   ├── layout.tsx        ← Root layout (fonts, metadata)
│   ├── globals.css       ← All styles (landing + XDuel)
│   ├── page.tsx          ← Landing page  →  modelxd.com/
│   └── xduel/
│       └── page.tsx      ← XDuel page    →  modelxd.com/xduel
├── public/
│   └── logo.png          ← XD star logo
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## Option A — Deploy to Vercel (recommended, free)

### 1. Push to GitHub

```bash
# In this folder:
git init
git add .
git commit -m "init ModelXD"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/modelxd.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to **vercel.com** → Sign up / Log in with GitHub
2. Click **"Add New Project"**
3. Import your `modelxd` GitHub repo
4. Leave all settings as default — Vercel auto-detects Next.js
5. Click **"Deploy"**

That's it. You'll get a live URL like `modelxd.vercel.app` in ~60 seconds.

---

## Option B — Connect your custom domain (modelxd.com)

After deploying to Vercel:

### In Vercel
1. Go to your project → **Settings → Domains**
2. Add `modelxd.com` and `www.modelxd.com`
3. Vercel shows you two DNS records to add

### In GoDaddy (or your registrar)
Go to **DNS Management** and add:

| Type  | Name | Value                  | TTL |
|-------|------|------------------------|-----|
| A     | @    | `76.76.21.21`          | 600 |
| CNAME | www  | `cname.vercel-dns.com` | 600 |

> ⚠️ Delete any existing A record pointing to GoDaddy's parking page first.

DNS propagates in 5–30 minutes. Vercel provisions SSL automatically.

---

## Option C — Run locally (for development)

```bash
npm install
npm run dev
```

Open **http://localhost:3000**

```bash
npm run build    # production build
npm run start    # serve production build
```

---

## Pages

| Route          | Description              |
|----------------|--------------------------|
| `/`            | Landing page             |
| `/xduel`       | XDuel arena (6-step flow)|
| `/vote`        | Coming soon              |
| `/leaderboard` | Coming soon              |
| `/create`      | Coming soon              |

---

## Next steps

- Hook up **Supabase** for auth + storing votes
- Connect real AI APIs (OpenAI, Anthropic, Google) for live model responses
- Build `/vote`, `/leaderboard`, `/create` pages
