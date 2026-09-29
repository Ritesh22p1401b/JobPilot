# JobPilot frontend image (Next.js). Build context: ./frontend
# The app has dynamic routes and an API proxy, so it can't be a static export; production runs the Next.js
# standalone server (`node server.js`), never `next dev`.

# ---- dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- development (compose.dev.yaml only): hot reload against bind-mounted sources
FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# ---- production build
FROM deps AS build
# Where the Next.js server proxies /api/v1 (rewrites are fixed at build time). Behind nginx, /api goes to the
# backend directly and this is only a fallback.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=${BACKEND_URL} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---- production runtime: only the standalone server and static assets
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
