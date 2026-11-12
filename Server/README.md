# Mettalfold local backend (V1)

A small app that runs on your own Mac. You fill in a request in the browser, it is saved in the shared Google Sheet, sent to the right desk (agent) through its webhook, and the answer comes back through the sheet and appears on screen. Every step is shown on screen and saved in a log. Nothing runs unseen.

The six desks are exactly the ones in the workflow: Supplier Qualification, Product Book Creator, #1 Opportunity Finder, #2 Advisory GTM, #3 Introduction Desk, #4 Deal Desk. The sub-agents (GTM Execution Matching Desk, Relationship Manager) run behind #2 and show up as a timeline on the #2 result.

---
## A. Try it first in test mode (5 minutes, nothing real is touched)
1. Install Node 20 or newer from https://nodejs.org (the "LTS" button) if you do not have it. To check, open Terminal and type `node -v`.
2. In Terminal, go into this folder: type `cd ` (with a space), drag the folder onto the Terminal window, press Enter.
3. Type `npm install` and press Enter. Wait until it finishes.
4. Copy the file `.env.example` to a new file called `.env` (in Finder: duplicate it and rename it; files starting with a dot may be hidden, press Cmd+Shift+. to show them).
5. Open `.env` in any text editor. Set `APP_PASSWORD=` to a password you choose (at least 8 characters). Leave everything else as it is. `WEBHOOK_MODE=mock` and `SHEET_MODE=mock` mean test mode.
6. In Terminal type `npm start` and press Enter.
7. Open http://localhost:3000 in your browser. Pick your name, enter the password.
8. Submit a supplier. A pretend desk answers in a few seconds. Tips: put the word HOLD or DROP in the supplier name to see those outcomes, FAILAGENT to see an agent error, WEBHOOKFAIL to see a failed send, SLOW to see a desk that never answers.

To run the automatic checks: `npm test` (takes about 10 seconds, prints PASS or FAIL per check).

## B. Connect the real Google Sheet (no Google Cloud needed): Apps Script
This gives the backend a safe door into the sheet "Mettalfold Agent Results".
1. Open the sheet. Click **Extensions > Apps Script**.
2. Delete the sample code. Open `apps_script/Code.gs` from this folder, copy everything, paste it into the Apps Script editor. Click the save icon.
3. Click the gear icon (**Project Settings**). Under **Script properties** click **Add script property**: name `SECRET`, value a long random phrase of at least 12 characters (for example three unrelated words and some numbers). Save. Keep this phrase private.
4. Click **Deploy > New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and approve the permissions Google asks for (it may say "unverified app": click Advanced, then continue; it is your own script).
5. Copy the **Web app URL** (starts with `https://script.google.com/macros/s/`).
6. In `.env` set:
   - `SHEET_MODE=appsscript`
   - `APPS_SCRIPT_URL=` the web app URL
   - `APPS_SCRIPT_SECRET=` the same phrase you put in step 3
7. Stop the app (Ctrl+C in Terminal) and start it again with `npm start`. If the sheet is reachable you will see "Sheet ok (appsscript)" in Terminal. If not, the app shows a red banner with the reason.
Notes: "Anyone" means anyone with the long URL can reach the door, but it only opens with your secret phrase, and opening the URL in a browser shows nothing but "alive". If you change Code.gs later, use **Deploy > Manage deployments > Edit > New version**.

Alternative (more setup): `SHEET_MODE=serviceaccount` with a Google Cloud service account key file at `secrets/service-account.json`, shared as Editor on the sheet.

## C. Connect the real agents (only when you are ready)
1. In `.env` paste each desk's webhook address and key into its slots (`SUPPLIER_QUALIFICATION_URL` and `_KEY`, and so on). Keys stay only in this file.
2. Change `WEBHOOK_MODE=mock` to `WEBHOOK_MODE=live`. The screen then shows a red "LIVE agents" badge.
3. Restart with `npm start`. Submit one Supplier Qualification test first and watch the step by step log.
The app only ever sends the key to a Cursor automation address over https. Format used: `POST` with header `Authorization: Bearer <key>` and a JSON body (request_id, case_id, agent_code, inputs, parent_request_id, submitted_by, sheet_id, and the earlier step's outcome, summary and link).

## D. How to use it
- **New request**: pick a desk, fill the form, Submit. Steps that follow an earlier step need that earlier step approved by a human first (the app enforces this).
- **Send several at once**: for suppliers, intro packs and deals. Each line becomes its own request with its own approval.
- **Cases**: every client case has a row showing all desks in order and where it stands. Click a request for details, the timeline of sub-agent steps, and the log.
- **Approve / Reject**: only shown when a human decision is needed. Approving never sends anything by itself; it opens the next step for you to submit.
- **Hold / Book Waiting**: use "Resubmit with the missing items". **Drop** closes it. **Reject** records the human no.
- **Retry**: shown after a problem or a long wait. It makes a new linked request (up to 3 retries).
- **Duplicates**: the same request in the same case is stopped with a plain message and a "Submit anyway" button.
- **Sheet down**: a red banner appears, the last known data stays visible, new requests and approvals are paused so nothing is half-saved.
- **Two people**: Rishabh and Hemant each run their own copy against the same sheet. Ids are checked against the sheet and made unique even if you both submit at the same second.
- **Log**: `logs/audit.jsonl` holds every step with who and when. No keys or passwords are ever written to it.

## Settings in .env
`PORT`, `HOST` (127.0.0.1 keeps it private to this Mac), `APP_PASSWORD`, `USERS`, `SESSION_SECRET` (optional; if empty, you must sign in again after each restart), `POLL_SECONDS` (default 4), `DELAY_HINT_SECONDS` (300: shows "taking longer than usual"), `TIMEOUT_MINUTES` (15: shows "No answer"), `STRICT_GATES=0` only if you ever need to switch off the approval chain (not recommended).

## Files
`server.js` (web app and login), `lib/core.js` (rules, gates, poller), `lib/agents.js` (the six desks and fields), `lib/sender.js` (webhook sender), `lib/sheet/` (mock, appsscript, serviceaccount), `lib/mockAgent.js` and `mock-agent.js` (pretend desk), `apps_script/Code.gs`, `public/` (screens), `test/run-tests.js`, `CHECKLIST_Desk_Routines_vs_Spec.md`.


## Tests (v34)

Both test suites start their own private copy of the app with fake desks and a fake sheet in a temporary folder.
They never read `.env`, never call a real desk, never write to the real Google Sheet, and never touch `data/`, `files/` or `logs/`
of the real install (the API suite checks this at the end).

- `npm test` runs the API and workflow suite (about 110 checks, about 25 s): sign-in and security; Supplier through Deal Desk;
  the human supplier confirmation reaching every desk and its helpers (GTM Execution Matching Desk, Relationship Manager);
  Hold, Drop, Reject, Approve anyway, resubmits, duplicates and idempotency; retries, timeouts, sheet outages and a sheet read
  that never answers; files, late files, archive hiding, the version footer and cache busting.
- `npm run test:e2e` runs the headless-browser suite (about 50 checks, about 30 s). It walks the whole flow in Chromium and checks
  instant feedback, automatic navigation after Approve, the stepper, the breadcrumb, the Deal Desk picker and review, the
  workflow-complete screen, late files with no waiting box, error toasts, the update banner, and that nothing overflows sideways.
  It needs `npm i --no-save playwright-core && npx playwright-core install chromium`. Without them it prints SKIP.

## v35: files show up by themselves
- Every result lists all the files it names (main result + each helper desk), as `files: [{name,url,ready,size}]` in `/api/cases` and `/api/status/:id`. Desk workspace paths (`/workspace/...`) are turned into `/files/<name>` links, for helper desks too.
- The result page shows a **Files in CASE-xxxx** panel with Open and Download for every file in the case. A file that is not on this Mac yet shows "On its way"; the page re-checks every 3 s and swaps in the link, PDF viewer or table by itself.
- Excel files are read in Node (`lib/xlsx.js`), so the table viewer works on Macs without python openpyxl, with a tab per sheet.
- `tools/check-files.sh` checks main + helper files and skips archived cases/requests.

## Contact research (v38)

Paid company enrichment (#1 Opportunity Finder) and contact finding (#3 Introduction Desk) through an outside data service.
The service is never named in the app, its files or its answers. Its code lives only in `lib/providers/cr.js`.

- **Login details:** `.env` keys `CR_CLIENT_ID` / `CR_CLIENT_SECRET` (the older names `SNOVIO_CLIENT_ID` / `SNOVIO_CLIENT_SECRET` also work). If they are missing the page says "not connected" and nothing can run.
- **Page:** `/research#CASE-0003`, or the grey "Contact research" link on the case bar. It shows filters, the enrichment run / skip choice, Pursue-now accounts, approvals, runs, files and history.
- **Filters:** stored in `data/contact_research/<CASE>.json`. Edit them on the page or with `POST /api/research/<CASE>/filters`. The JSON holds job_titles, persona_roles, seniority, departments, exclude_titles, locations, company_size, domains, max_prospects_per_company (10, at most 15) and search_pages.
- **Enrichment choice:** `POST /api/research/<CASE>/enrichment {"mode":"auto|run|skip"}`. "auto" means skip when the #1 list already has enough companies with websites.
- **Contacts:** only for accounts #2 marked "Pursue now" (Keep warm and Nurture are never searched). Each contact costs one credit.
- **Approval:** the app cannot approve or run anything. Only the command line can:
  - `node tools/research.js pending CASE-0003`: what would run and its cost (free)
  - `node tools/research.js approve CASE-0003 --step contacts --by Rishabh --cap 20 [--accounts "A;B"] [--max-per-company 10]`
  - `node tools/research.js run CASE-0003 --step contacts`. It needs an unexpired, unused approval that matches the current filters. It stops at the cap.
  - `node tools/research.js revoke CASE-0003 --id APR-...`
  - `--mock` uses a fake service (no credits). `CR_MAX_CAP` sets the highest cap allowed (default 50).
- **Outputs:** `files/03_IntroDesk_<stem>_ContactResearch_V<n>.csv/.xlsx` and `files/01_OpportunityFinder_<stem>_CompanyEnrichment_V<n>.csv/.xlsx`.
- **Tests:** `npm test` now runs `test/run-tests.js` and `test/research-tests.js`. The second uses only the fake service.
