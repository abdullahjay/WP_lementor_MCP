# Base image already bundles Node, Chromium/Firefox/WebKit and their
# system deps — using it for both stages avoids re-downloading browsers
# `playwright-core` would otherwise try to fetch itself (the image's own
# PLAYWRIGHT_BROWSERS_PATH env var is what `playwright-core` finds them
# through).
#
# renderer/package.json's `playwright-core` version MUST exactly match this
# image's tag (v1.48.0-jammy -> 1.48.0, no caret range). A caret range
# silently resolved a newer patch whose expected browser revision isn't
# the one baked into this image — real failure hit live: "browserType.launch:
# Executable doesn't exist... Playwright was just updated to 1.62.1."
# Bumping this image tag and the npm version must happen together.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS build
WORKDIR /app
COPY renderer/package.json renderer/package-lock.json* ./
RUN npm ci
COPY renderer/ ./
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.48.0-jammy
WORKDIR /app
ENV NODE_ENV=production
COPY renderer/package.json renderer/package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
