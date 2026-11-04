FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ARG APP_VERSION
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 NODE_USE_ENV_PROXY=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright TMPDIR=/tmp HOME=/tmp
ENV APP_VERSION=${APP_VERSION}
COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps firefox && chmod -R a+rX /ms-playwright
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
