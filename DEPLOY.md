# Deploy Search Nine to Vercel

The game is a zero-build static app with Vercel serverless functions under
`api/`. The online account and leaderboard layer uses Supabase Postgres as its
durable store. The browser still falls back to local play if the variables are
not configured.

## 1. Create the database

1. Create a free project at [supabase.com](https://supabase.com/).
2. Open **SQL Editor**, create a new query, paste `supabase/schema.sql`, and run it.
3. Open **Project Settings → API** and copy the Project URL and the
   `service_role` key. The service-role key must only be added to Vercel server
   environment variables.

## 2. Put the code on GitHub

From this project folder:

```bash
git init
git add .
git commit -m "Build Search Nine online game foundation"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/search-nine-sudoku.git
git push -u origin main
```

Create the empty GitHub repository first. Do not add a README or `.gitignore`
there because this folder already contains both.

## 3. Import it into Vercel

1. Open [vercel.com/new](https://vercel.com/new) and choose **Continue with GitHub**.
2. Import `search-nine-sudoku`.
3. Keep the framework preset as **Other** and the build command blank.
4. Add these Environment Variables for **Production, Preview, and Development**:

   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service-role key
   - `SESSION_SECRET` = a long random value, for example `openssl rand -hex 32`

5. Deploy.

After deployment, open the Vercel URL, create a username/password account, and
solve the daily puzzle. The global leaderboard accepts verified daily solves
only; the API checks the submitted grid server-side before saving it.

## Scoring behavior

For each daily puzzle, the ranking order is:

1. Solves with zero checks, sorted by time.
2. If nobody has a zero-check solve, solves with checks, sorted by time.

The same user/puzzle gets one best score. A later solve replaces it only when
it improves the check count or ties the check count and improves the time.
