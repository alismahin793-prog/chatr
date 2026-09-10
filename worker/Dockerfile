FROM node:24-alpine

RUN apk add --no-cache git

WORKDIR /app
COPY . .

CMD ["node", "dist/worker/src/index.js"]