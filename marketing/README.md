# FundHub marketing pack

LaTeX sources for FundHub's business presentation, brochures and diagrams. They use the website's brand: the "FundHub" wordmark ("Hub" in emerald), the site colours and the Inter font.

| File | What it is |
|---|---|
| `presentation.tex` | Business presentation (Beamer, 16:9, about 30 slides): the referral-fee problem, FundHub, the platform screen by screen, Data Intelligence and provider leads, business model, growth, daily operations, roadmap |
| `brochure-clients.tex` | 2-page A4 brochure for fund managers and investors |
| `flyer-providers.tex` | 1-page A4 flyer for service providers |
| `diagrams/*.tex` | TikZ diagrams, each compilable on its own and included in the documents: `referral-problem`, `architecture`, `money-flow`, `service-flow`, `market-map`, `data-pipeline`, `lead-engine`, `ops-cycle` |
| `screenshots/*.jpg` | Screenshots of FundHub Web and FundHub Console, used in the presentation |
| `fundhub-brand.sty` | Shared brand: colours, logo commands, TikZ styles, browser-frame macro for screenshots |

## Compile

The sources were not compiled. To build the PDFs:

- **Overleaf:** upload the whole `marketing/` folder, set the compiler to pdfLaTeX, open `presentation.tex` and click Recompile.
- **Locally** (TeX Live or MiKTeX), from this folder:

  ```bash
  latexmk -pdf presentation.tex
  latexmk -pdf brochure-clients.tex
  latexmk -pdf flyer-providers.tex
  latexmk -pdf diagrams/money-flow.tex   # any diagram on its own
  ```

Always compile from this folder so `fundhub-brand.sty`, `diagrams/` and `screenshots/` are found. If the `inter` font package isn't installed, the documents fall back to Helvetica.

## Updating

- **Prices** are indicative, taken from the business plan. Change them in `presentation.tex` (Revenue streams), `diagrams/money-flow.tex` and `flyer-providers.tex`.
- **Screenshots:** retake them from a production build so the dev-mode overlay doesn't appear, at 1440×900, and keep the same file names.
- **Brand colours** live in `fundhub-brand.sty` and match `apps/web/src/app/globals.css`.
