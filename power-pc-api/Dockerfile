FROM node:24.13-alpine3.22 as base
WORKDIR /usr/src/app
RUN chown node:node .
COPY --chown=node:node package-lock.json package.json ./
USER node

FROM base as development
ENV NODE_ENV=development
RUN npm ci && npm cache clean --force;
CMD ["node", "--watch", "./src/server.js"]

FROM base as production
ENV NODE_ENV=production
RUN npm ci --only=production && npm cache clean --force;
COPY --chown=node:node . .
CMD ["node", "./src/server.js"]
