# 1. Base stage for dependencies
FROM node:22-slim AS base
# Install the missing shared library required for ARM64 native binaries (for Mac users)
RUN apt-get update && apt-get install -y libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 2. Development stage
FROM base AS development
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev"]

# 3. Production build stage
FROM base AS build
COPY . .
RUN pnpm build

# 4. Production runtime stage
FROM node:22-slim AS production
RUN npm install -g pnpm
WORKDIR /app
# Copy only necessary files for production
COPY --from=build /app/build ./build
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "start"]