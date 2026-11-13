# career-ops

> An open-source AI job search automation agent.

`career-ops` streamlines and automates the job search workflow: scan company job portals, evaluate postings into structured A–H fit reports with 1–5 scoring, tailor CVs and cover letters, and track applications in a local-first web dashboard.

---

## Key Features

- **Automated Portal Scanning:** Scrapes and filters postings from major ATS platforms (Ashby, Greenhouse, Lever, Workday, etc.) matching your target titles and locations.
- **Objective Fit Evaluation:** Analyzes job descriptions against your experience, calculating scores across key dimensions (skills match, level, compensation, and team focus).
- **CV & Application Tailoring:** Generates tailored CVs (PDF, LaTeX, Markdown) and cover letters matching specific job descriptions without fabricating facts.
- **Local-First Web Dashboard:** Review incoming opportunities, evaluate postings, and manage your pipeline through an interactive web UI.
- **Antigravity CLI Support:** Integrated with Google Antigravity (`agy`) and Gemini for headless evaluations and automated workflows.

---

## Prerequisites

- **Node.js:** `>= 22.13.0` (Node 22 LTS recommended)
- **npm:** `>= 10.0.0`
- **Playwright Chromium:** Required for headless browser scraping and PDF generation.

---

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Arpit-26/career-ops.git
   cd career-ops
   ```

2. **Install root dependencies:**
   ```bash
   npm install
   ```

3. **Install web dashboard dependencies:**
   ```bash
   cd web && npm install && cd ..
   ```

4. **Install Playwright Chromium browser & system libraries:**
   ```bash
   npx playwright install --with-deps chromium
   ```

5. **Verify your setup:**
   ```bash
   npm run doctor
   ```

---

## Running the Web Dashboard

To launch the local web UI:

```bash
npm run ui
```

Then open your browser at **[http://localhost:3000](http://localhost:3000)**.

To bind to all network interfaces (recommended for remote or container environments):

```bash
node scripts/ui-server.mjs --host 0.0.0.0 --port 3000
```

---

## Running on GitHub Codespaces

`career-ops` is fully compatible with GitHub Codespaces:

1. Click **Code** → **Codespaces** → **Create codespace on main**.
2. In the Codespace terminal, run:
   ```bash
   npm install
   cd web && npm install && cd ..
   npx playwright install --with-deps chromium
   npm run ui
   ```
3. GitHub Codespaces will automatically forward port `3000` and display a popup to open the web dashboard in your browser.

---

## Personalization

`career-ops` is local-first. Your personal data stays on your machine and is excluded from git commits:

- **`cv.md`**: Place your master CV / resume in markdown format.
- **`config/profile.yml`**: Define your target job titles, preferred locations, and compensation requirements.
- **`data/applications.md`**: Your central tracking ledger for job applications.
- **`portals.yml`**: Configure which company boards to scan and monitor.

---

## Antigravity CLI Integration

The repository includes a dedicated Antigravity CLI bridge in `bin/`:

- **Executable:** `bin/agy` (macOS/Linux) and `bin/agy.cmd` / `bin/agy.ps1` (Windows).
- **Execution:** Headless execution for automated job evaluation, cover letter drafting, and CV tailoring.
- **API Support:** Automatically utilizes the Google Gemini API when `GEMINI_API_KEY` is present in your environment, with an offline local engine fallback.

---

## License

This project is licensed under the [MIT License](LICENSE).
