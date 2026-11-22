# Forward Two multiplayer service. Build from the repo root (the server shares
# the ghost codec in web/src/net/ghost.js):
#   docker build -f server/Dockerfile -t forward-two-server .
#   docker run -p 8790:8790 -v f2data:/data forward-two-server
FROM node:22-alpine
ENV NODE_ENV=production PORT=8790 F2_DATA=/data
WORKDIR /app
COPY package.json ./
COPY server/ ./server/
COPY web/src/net/ghost.js ./web/src/net/ghost.js
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8790/healthz >/dev/null || exit 1
CMD ["node", "server/main.js"]
