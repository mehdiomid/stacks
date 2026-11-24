# ---- Build: compile the web app and the server ----
FROM node:22-alpine AS build
WORKDIR /app
# npm 10 (bundled with Node 22) fails to resolve this dependency tree; npm 11 works.
RUN npm install -g npm@11.21.1
COPY package.json package-lock.json ./
RUN npm ci
# Local-mode models (pinned and checksummed). A separate layer, so code changes don't download them again.
COPY scripts/fetch-models.mjs scripts/
RUN node scripts/fetch-models.mjs --namer
COPY . .
RUN npm run build && npm test

# ---- Static files for S3 + CloudFront (scripts/deploy-static.sh): the app without link previews, plus the models ----
FROM build AS static-build
RUN VITE_STATIC_HOSTING=1 npx vite build --outDir dist/static
FROM scratch AS static
COPY --from=static-build /app/dist/static /
COPY --from=static-build /app/models /models

# ---- Run: only the server's production dependencies and the built files ----
FROM node:22-alpine AS run
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN npm install -g npm@11.21.1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/models ./models
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "dist/server/index.js"]
