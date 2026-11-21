# PriceTag

An installable iPhone web app (PWA) for logging and comparing supermarket and gas prices.

- Photo of the price tag, GPS/address, store, date seen, deal start/end (with countdown)
- Scan a barcode or a **standard PriceTag QR** (`PT1|SKU|Item|price|unit|YYYY-MM-DD|Store`)
- Compare the same tagged item across stores, normalised per unit (lb/oz/kg, gal/L)
- Offline-capable; data is stored on-device (IndexedDB). Export as JSON.

## Install on iPhone
1. Host over HTTPS (iOS requires it for the camera). Settings > Pages > Source: GitHub Actions, merge to `main`.
2. Open the URL in **Safari** > Share > **Add to Home Screen**.

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000 (camera needs HTTPS or localhost).

## Next step
Sharing prices between users needs a backend (e.g. Supabase) behind the functions in `app.js`.
