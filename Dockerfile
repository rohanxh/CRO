# Playwright's own image already carries Chromium and every system library it needs.
# Keep this tag in step with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY package.json package-lock.json ./
# Browsers ship with the base image, so skip Playwright's download step.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 3000

# Chromium needs a larger /dev/shm than the Docker default: run with --shm-size=1g.
CMD ["npm", "run", "start"]
