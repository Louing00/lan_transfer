FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/apps/frontend/package.json apps/frontend/package.json
COPY --from=build /app/apps/backend/package.json apps/backend/package.json
RUN npm install --omit=dev

COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/frontend/dist apps/frontend/dist

EXPOSE 8080
CMD ["npm", "run", "start", "-w", "@lindrop/backend"]
