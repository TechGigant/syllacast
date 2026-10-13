# ==============================================================================
# Multi-stage Dockerfile for Syllacast (Universal / Multi-Arch)
# ==============================================================================

# 1. Frontend Builder
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. Rust Backend Builder
FROM rust:1-bookworm AS backend-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY xtask ./xtask
COPY src ./src
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN cargo build --release --package syllacast

# 3. Minimal Runtime Container
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled backend binary (self-contained with embedded frontend assets)
COPY --from=backend-builder /app/target/release/syllacast /app/syllacast

ENV SYLLACAST_BIND=0.0.0.0 \
    SYLLACAST_PORT=8080

EXPOSE 8080

ENTRYPOINT ["/app/syllacast"]
