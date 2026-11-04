# LBR (RCS) — what we learned (tested 2026-11-04, portal version LBR_25.7.0)

This records what the engine found while testing access to lbr.lu with a real LuxTrust login. Read it before changing the RCS source.

## Portal structure

| Item | Value |
|---|---|
| Front end | Vue single-page app at `https://www.lbr.lu/mjrcs-web-front/` |
| Data API (used by the front end) | `https://www.lbr.lu/mjrcs-web-api/v1`: `/status`, `/companies?name=`, `/companies/{rcs}`, `/companies/{rcs}/publications?registerName=`, `/companies/{rcs}/rbe`, `/journals?journalType=&startDate=&endDate=`, `/journals/companies` |
| Auth API | `https://www.lbr.lu/mjrcs-webauth-api/v1` |
| Login | LuxTrust through IBM TAM: `/login/TAMLoginServlet?…AUTHNLEVEL=2`. Searching without being logged in redirects there. |
| Logged-in signal | a **My account** button in the header |
| Search, home page | input `#UC-DOS-RECH.EC-DOS-RECH-01_search_searchtext`, placeholder "Enter a trade name or RCS number (B123456)" |
| Search URL | `/mjrcs-web-front/consult-search-list?search=B145917` |
| RCS number format | prefix letter plus digits, e.g. `B145917`. The engine normalises spacing and leading zeros (`normalizeRcs`). |

## Protections (decisive)

1. **Friendly Captcha on every search.**
   * After a search, a "Captcha Resolution: Captcha resolution in progress… / Verifying…" dialog appears before any result.
   * In a person's browser it completes by itself.
   * **In a Playwright-controlled browser it never completes** (still verifying after 90 s): the check identifies automated browsers.
2. **A quota page.** The front end redirects to `AccessLimitation.html` when a usage limit is hit.
3. **Login sessions do not survive a browser restart.** LuxTrust/TAM uses session cookies, so a login saved in the engine's browser profile is lost once the window closes. Any automated worker would have to log in at start and keep one browser open.

### Test with a person at the screen (2026-11-04, `rcs:session`)

* The person logged in with LuxTrust in the engine's browser, and the session waited for them to complete the check.
* LBR's server still answered **"An error occurred while validating the captcha. Please try again."** each time, then went back to "Captcha resolution in progress…".
* No search results were ever shown, for B10548 or for B107877.
* So a person completing the check does not make LBR accept an automated browser: the server rejects the check itself. The session was stopped, and nothing was stored.

## Decision

* The engine **does not get around** these protections:
  * no "stealth" browser to hide automation;
  * no captcha solving;
  * no direct calls to `/mjrcs-web-api` in place of the front end.
* When the check does not complete, the RCS adapter marks the session `blocked` and pauses all RCS work (`RcsBrowser.settle()`). That is the behaviour we saw in the test.
* The scheduled RCS jobs (`rcs_frontier`, `rcs_sweep`, `rcs_refresh`) therefore stay off. Set `ENGINE_DISABLED_SCHEDULES=rcs_frontier,rcs_sweep,rcs_refresh`, or switch them off on the console's Jobs page.

## How we get RCS data instead

1. **Official extract and licence from LBR.** This is the only route to a complete list of RCS numbers and to filing PDFs at scale. Use the draft request: [lbr-data-reuse-request.md](lbr-data-reuse-request.md). Imports go through `rcs_import_file`, as source `lbr_bulk`. Add filing documents to the request: bulk PDFs for every B-number means millions of documents, so it is only realistic as an LBR delivery.
2. **Free official sources in the meantime.**
   * GLEIF gives about 73k Luxembourg LEIs with their RCS number.
   * The CSSF gives all supervised entities.
   * `rcs_seed_frontier` and the census measure coverage of the B-range.
3. **Person-in-the-loop capture (optional).** A staff member browses LBR normally in their own Chrome, which passes the check like any visitor, and saves the company page they are looking at into the engine. This is the same as a person taking notes, so it has the volume of a person's browsing. It suits priority entities, not a full census.

## Test trail

`engine rcs:test <B…> --wait-file <file>` opens one browser, waits for the login, runs the lookup, and leaves a screenshot and a page summary for each step under `.engine-data/rcs-debug/`. That trail is how the findings above were established.
