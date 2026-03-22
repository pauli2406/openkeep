FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openkeep/web build
RUN pnpm --filter @openkeep/api build

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
