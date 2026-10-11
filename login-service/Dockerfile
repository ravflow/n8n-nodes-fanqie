FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
USER pwuser
ENV NODE_ENV=production
EXPOSE 8789
CMD ["node", "src/server.mjs"]
