# Risal MCP server — small image, runs over stdio.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
# --ignore-scripts: the `prepare` hook runs `npm run build` (tsc), but src isn't
# copied yet — we build explicitly below, after COPY src.
RUN npm install --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
# --ignore-scripts: skip the `prepare`→tsc hook (tsc is a devDep, omitted here);
# the compiled dist/ is copied from the build stage, nothing to build at runtime.
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
# MCP talks over stdio; RISAL_API_KEY is provided at runtime (-e RISAL_API_KEY=…).
ENTRYPOINT ["node", "dist/index.js"]
