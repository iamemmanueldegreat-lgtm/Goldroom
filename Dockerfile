FROM node:22-alpine
WORKDIR /app
COPY bot/package.json bot/package-lock.json ./
RUN npm ci --omit=dev
COPY bot/server.mjs bot/fazer.mjs ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
