FROM node:22-bookworm-slim AS keys
WORKDIR /app
COPY scripts/generate-keys.mjs ./scripts/generate-keys.mjs
RUN --mount=type=secret,id=api_rsa_private_key \
    if [ -f /run/secrets/api_rsa_private_key ]; then export API_RSA_PRIVATE_KEY="$(cat /run/secrets/api_rsa_private_key)"; fi; \
    node scripts/generate-keys.mjs

FROM rust:1-bookworm AS wasm
RUN rustup target add wasm32-unknown-unknown && cargo install wasm-bindgen-cli --version 0.2.100 --locked
WORKDIR /app/encrypt_modunel
COPY encrypt_modunel ./
COPY --from=keys /app/build-keys/public.der /app/public.der
COPY --from=keys /app/build-keys/response.key /app/response.key
ENV CARGO_RESPONSE_KEY_FILE=/app/response.key
ENV CARGO_PUBLIC_KEY_FILE=/app/public.der
RUN cargo build --release --target wasm32-unknown-unknown && \
    wasm-bindgen target/wasm32-unknown-unknown/release/encrypt_modunel.wasm --target web --out-dir /wasm

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY static ./static
COPY --from=wasm /wasm ./static/wasm
RUN npm run build
RUN npm run build:static

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata
ENV PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist/static ./static
COPY --from=keys --chown=node:node /app/build-keys/private.pem ./build-keys/private.pem
COPY --from=keys --chown=node:node /app/build-keys/response.key ./build-keys/response.key
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
