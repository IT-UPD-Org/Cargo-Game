# Xếp hàng lên tàu

## Local development

Run `npm run dev` to automatically set up WASM, then start the local TypeScript watcher. Install Rust via rustup first and configure MongoDB in `.env`. The predev script installs the WASM target and matching wasm-bindgen CLI, generates or reuses RSA keys, and builds `static/wasm`. Initial setup may take several minutes.

TypeScript changes restart automatically; frontend edits appear after refreshing. After Rust changes, restart `npm run dev` or run `npm run build:wasm`.


## WASM request transport

Docker now builds `encrypt_modunel/` with Rust and wasm-bindgen. `sendApi(endpoint, body)` automatically fingerprints the browser inside WASM, computes a 32-character MD5 ID, injects `browserId`, and encrypts POST payloads using AES-256-GCM with an RSA-OAEP wrapped key. GET leaderboard reads remain public. The server decrypts requests and rejects expired or repeated envelopes (replay cache is per process).

Build with `docker build -t cargo-game .`. A random RSA key pair is generated in the keys stage; the masked public key goes into WASM and the private key stays in the server image. To supply an existing key, use `docker build --secret id=api_rsa_private_key,env=API_RSA_PRIVATE_KEY -t cargo-game .`. Keep the generated client and server from the same build together. Docker may reuse the key-generation layer from cache; use `--no-cache` to rotate generated keys.

The key is stored as masked bytes rather than readable PEM text in WASM. This is obfuscation, not a guarantee against extraction. Responses remain JSON. The binary envelope is versioned custom framing, not Protobuf.

For local development, run `node scripts/generate-keys.mjs`, install the Rust `wasm32-unknown-unknown` target and `wasm-bindgen-cli` version `0.2.100`, set `CARGO_PUBLIC_KEY_FILE` to the absolute `build-keys/public.der` path, build the crate for that target in release mode, and run wasm-bindgen with `--target web --out-dir static/wasm`. The server reads `build-keys/private.pem` by default (override with `API_RSA_PRIVATE_KEY_FILE`).

Express + TypeScript + MongoDB. Game files live in `static/`.

## Run

1. Install Node.js 20+ and start MongoDB locally (or use MongoDB Atlas).
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure `MONGODB_URL` and `MONGODB_DATABASE`.
4. Run `npm run dev`, then open http://localhost:3000.

Production: `npm run build`, then `npm start`. Use HTTPS and set `NODE_ENV=production`. Phone access also needs HTTPS for the browser fingerprint Web Crypto APIs (localhost works on desktop).

## Docker frontend compilation

`docker build -t cargo-game .` runs `npm run build:static` in the build stage.
All JavaScript under `static/` is processed in order through **javascript-obfuscator → google-closure-compiler** (the official npm package).
Closure uses SIMPLE optimization to preserve cross-file properties such as `window.cargoPlayer`.
Obfuscator self-defending mode is disabled because Closure modifies its output.
Processed assets are generated in `dist/static/` and copied to `/app/static` in the runtime image; source files in `static/` stay editable.
The Debian build stage supports Closure's native Linux executable. Compiler tools and temporary intermediate files are excluded from the final runtime image.

## Identity and scores

- First visit asks for a unique username. The WASM module builds a 32-character MD5 browser ID from canvas, WebGL, fonts, math quirks, language and hardware signals, plus a random per-device seed kept in `localStorage` (`cargoDeviceSeed`) so identical phones get different IDs.
- **No cookies for players.** On registration or login the server returns a random 64-hex session token. The WASM module stores it in `localStorage` (`cargoSession`) and sends it as the `X-Cargo-Session` header; only its SHA-256 hash is stored in MongoDB. The token is never exposed to page JavaScript, and responses stay encrypted.
- Clearing site data (or Safari's 7-day storage purge) removes the token and seed, which loses access to that player; the admin code lookup is the recovery path. Private modes that block `localStorage` cannot stay logged in.
- Players who logged in under the previous cookie scheme are handed over once (the old `cargo_player` cookie is exchanged for a localStorage token and then cleared).
- The admin dashboard still uses its own HttpOnly `cargo_admin` cookie after Basic Auth.
- Each finished round is sent to `/api/score` and stored in `plays`; `highestScore` is kept with `$max`. Failed saves can be retried.
- Scores are validated for shape and range but gameplay runs in the browser, so these are not cheat-proof scores.

API: `GET /api/player`, `POST /api/player` (`username`, `browserId`), `POST /api/score` (`scores`, `playId`).
