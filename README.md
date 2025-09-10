# Canyonland Technologies Inc. — Website

Static site (HTML/CSS/JS) designed for Netlify. Includes Netlify Forms.

## Local preview
Just open `index.html` in a browser.

## Deploy on Netlify (GitHub flow)
1. Push this folder to a new GitHub repo (e.g., `canyonland-site`).
2. In Netlify, **Add new site → Import from Git** → choose the repo.
3. Build settings:
   - **Base directory**: (leave blank)
   - **Build command**: (leave blank)
   - **Publish directory**: `./`
4. Deploy. Netlify gives you `*.netlify.app`.
5. Add your custom domain in **Site settings → Domain management**.
6. Keep ZenBusiness as DNS (Option B):
   - Add CNAME: `www → your-site-name.netlify.app`
   - Add A records for root `@ → 75.2.60.5` and `@ → 99.83.190.102`
7. Forms: in Netlify dashboard → **Forms** → enable notifications for `contact`.

## Edits
Push to `main` and Netlify auto-deploys.
