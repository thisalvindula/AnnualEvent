FROM node:22-alpine AS build

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm ci

COPY frontend ./frontend
RUN npm run build:frontend

FROM node:22-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY app ./app
COPY db ./db
COPY employee-photos ./employee-photos
COPY --from=build /usr/src/app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "node db/migrate.js && node app/server.js"]
