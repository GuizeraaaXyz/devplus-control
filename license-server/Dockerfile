FROM oven/bun:1

WORKDIR /app

COPY license-server/server.mjs ./server.mjs

ENV LICENSE_DB_PATH=/var/data/licenses.sqlite

CMD ["bun", "run", "server.mjs"]
