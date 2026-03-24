FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openkeep/docs build

EXPOSE 3001

CMD ["pnpm", "--filter", "@openkeep/docs", "serve", "--host", "0.0.0.0", "--port", "3001"]
