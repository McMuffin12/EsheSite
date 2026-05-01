# EsheSite (Life's Little Things)

## Project Overview
EsheSite is the Astro-powered website for Life's Little Things, a small business showcasing handmade crochet items. The site includes a storefront backed by Square, a gallery of finished pieces, and a contact form for commissions, questions, and feedback.

## Setup Instructions
1. Ensure Node.js `>=22.12.0` is installed.
2. Install dependencies:
   ```bash
   cd esheAstroSite
   npm install
   ```
3. (Optional) Configure environment variables for full functionality:
   ```bash
   # Square (store + checkout)
   SQUARE_ACCESS_TOKEN=
   SQUARE_LOCATION_ID=
   SQUARE_ENV=sandbox
   PUBLIC_SQUARE_APPLICATION_ID=
   PUBLIC_SQUARE_LOCATION_ID=
   SQUARE_WEBHOOK_SIGNATURE_KEY=

   # Resend (contact form emails)
   RESEND_API_KEY=
   RESEND_TO=
   RESEND_FROM=
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

Additional commands:
- `npm run build` — build the production site
- `npm run preview` — preview the production build locally

## Features
- Astro + Tailwind CSS marketing site for Life's Little Things.
- Home page with hero slideshow, featured banner, and gallery preview.
- About page highlighting the business story and crochet journey.
- Gallery page powered by a JSON image list.
- Contact form with Q&A, feedback, and commission flows (supports attachments) via Resend.
- Square-backed storefront with category filtering and inventory-aware product listing.
- Cart with quantity controls, stock checks, and shipping threshold messaging.
- Two-step checkout (shipping + payment) with Square card processing and order success page.
