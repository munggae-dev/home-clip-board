# --- Web (PWA) ---
FROM node:24-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- API server ---
FROM golang:1.26-alpine AS server
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /server ./cmd/server

# --- Runtime ---
FROM alpine:3.23
RUN apk add --no-cache ca-certificates wget
WORKDIR /app

COPY LICENSE ./LICENSE
COPY --from=server /server ./server
COPY --from=web /app/web/dist ./web/dist

ENV PORT=8080 \
    HTTPS_PORT=8443 \
    DB_PATH=/app/data/data.db \
    UPLOAD_DIR=/app/data/uploads \
    STATIC_DIR=/app/web/dist

EXPOSE 8443
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- --no-check-certificate https://127.0.0.1:8443/api/health || exit 1

ENTRYPOINT ["/app/server"]
