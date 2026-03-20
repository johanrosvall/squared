# Squared — Setup Guide

This guide will walk you through setting up Squared from scratch. You don't need to be technical — just follow each step.

---

## Step 1: Set Up Supabase (Free Database + Auth)

1. Go to [supabase.com](https://supabase.com) and click **Start your project**
2. Sign up with GitHub (recommended) or email
3. Click **New project**
4. Fill in:
   - **Name**: `squared`
   - **Database Password**: Choose a strong password (save it somewhere safe)
   - **Region**: Pick the closest to you (e.g., EU West for Stockholm)
5. Wait ~2 minutes for the project to set up

### Get Your API Keys
1. In your Supabase dashboard, click **Settings** (gear icon) → **API**
2. Copy two values:
   - **Project URL** (looks like `https://abcxyz.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)
3. Keep these handy — you'll need them in Step 3

### Create the Database Tables
1. In Supabase, click **SQL Editor** (left sidebar)
2. Click **New query**
3. Open the file `supabase/migrations/001_initial_schema.sql` from this project
4. Copy the entire contents and paste into the SQL editor
5. Click **Run** (or Ctrl+Enter)
6. You should see "Success. No rows returned" — that's correct!

---

## Step 2: Set Up Vercel (Free Hosting)

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub
2. Push this project to a new GitHub repository:
   - Create a new repo on GitHub
   - In your terminal:
     ```
     cd squared
     git init
     git add .
     git commit -m "Initial commit"
     git remote add origin https://github.com/YOUR_USERNAME/squared.git
     git push -u origin main
     ```
3. Back in Vercel, click **Add New** → **Project**
4. Select your `squared` repository
5. Before deploying, add **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` → paste your Project URL from Step 1
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → paste your anon key from Step 1
6. Click **Deploy**
7. Wait ~1–2 minutes. Vercel will give you a URL like `squared-abc.vercel.app`

---

## Step 3: Local Development (Optional)

If you want to run Squared locally:

1. Make sure you have [Node.js 18+](https://nodejs.org) installed
2. In the project folder:
   ```bash
   cp .env.local.example .env.local
   ```
3. Edit `.env.local` and paste your Supabase URL and anon key
4. Install dependencies and start:
   ```bash
   npm install
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000)

---

## Step 4: First-Time Use

1. Open your deployed app (or localhost)
2. Click **Create Account** and sign up
3. You'll be redirected to the **Accounts** page
4. Create your accounts:
   - **Primary Checking** (type: Checking)
   - **Credit Card** (type: Credit Card)
   - **Joint Account** (type: Shared) — if you share expenses with a partner
5. Click **Import CSV** to bring in your first bank statement
6. Map the columns and import!

---

## Project Structure (for developers)

```
squared/
├── app/                    # Next.js App Router pages
│   ├── auth/               # Login/Signup
│   ├── dashboard/          # Main dashboard
│   ├── accounts/           # Account management
│   ├── import/             # CSV import wizard
│   ├── transactions/       # Transaction list + CC bills
│   ├── reconcile/          # Reimbursement matching
│   ├── settle/             # Net balance view
│   ├── analytics/          # Spending analytics
│   └── settings/           # All settings
├── components/
│   ├── layout/             # GlobalNav, PageShell
│   └── ui/                 # Button, Input, Card, Badge, Modal
├── lib/
│   ├── supabase/           # Supabase client config
│   ├── types.ts            # TypeScript types
│   └── utils.ts            # Shared utilities
└── supabase/
    └── migrations/         # Database schema SQL
```

---

## Troubleshooting

**"Invalid API key"** — Double-check your `.env.local` values match Supabase Settings → API

**"User not found"** — Make sure you've run the SQL migration in Step 1

**Blank page after login** — Check browser console (F12) for errors. Usually a missing env variable.

**CSV import fails** — Make sure your CSV has headers in the first row and uses commas as delimiters.
