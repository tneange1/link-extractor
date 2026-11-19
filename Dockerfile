FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV DATA_DIR=/app/data PORT=3020
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3020/__le_health || exit 1
CMD ["node", "src/server.js"]
