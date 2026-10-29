# HypoDiabetic Monitor – Netlify deploy

## Files
- `index.html` – the app
- `privacy.html` – privacy policy (replace `[YOUR CONTACT EMAIL]` first)
- `manifest.webmanifest`, `sw.js`, `icons/` – makes it an installable app (needed for PWABuilder / Play Store)
- `netlify/functions/analyze.mjs` – AI backend for meal and label scans
- `netlify.toml` – Netlify settings

## Deploy (GitHub method – no terminal needed)
Drag-and-drop deploys do NOT run the AI function, so use GitHub:
1. github.com → New repository → name `hypodiabetic-monitor` → Create.
2. "uploading an existing file" → drag ALL files and folders from this zip → Commit.
3. Netlify → Add new site → Import an existing project → GitHub → pick the repo → Deploy.
4. Netlify → Site configuration → Environment variables → Add:
   `ANTHROPIC_API_KEY` = your key from console.anthropic.com
5. Deploys → Trigger deploy → Deploy site.
6. Open the site, scan a meal photo to test.

## Cost control
In console.anthropic.com → Limits, set a monthly spend limit (e.g. $10).
