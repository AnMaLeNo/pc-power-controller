FROM node:24.13-alpine3.22 AS base
WORKDIR /usr/src/app
RUN chown node:node .
COPY --chown=node:node package-lock.json package.json ./
USER node

FROM base AS development
ENV NODE_ENV=development
RUN npm ci && npm cache clean --force
COPY --chown=node:node . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM base AS build
RUN npm ci && npm cache clean --force
COPY --chown=node:node . .
ENV NODE_ENV=production
RUN npm run build

FROM nginx:1.29-alpine AS production
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/app/dist /usr/share/nginx/html
EXPOSE 5173
