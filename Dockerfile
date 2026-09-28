# One image for api, worker and migrate; compose picks the command.
# Debian rather than Alpine: the Temporal worker's native core needs glibc.
FROM node:24-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/workflows/package.json packages/workflows/
RUN yarn workspaces focus @hire-wire/api @hire-wire/worker @hire-wire/db @hire-wire/workflows --production

COPY apps apps
COPY packages packages

USER node
ENV NODE_ENV=production
CMD ["node", "apps/api/src/server.ts"]
