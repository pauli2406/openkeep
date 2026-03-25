# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim

ARG WORKER_BASE_FINGERPRINT=unknown

LABEL org.openkeep.worker-base-fingerprint="$WORKER_BASE_FINGERPRINT"

ENV PNPM_HOME="/pnpm"
ENV PNPM_STORE_DIR="/pnpm/store"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    imagemagick \
    libheif1 \
    ocrmypdf \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.26.2 --activate

WORKDIR /app
