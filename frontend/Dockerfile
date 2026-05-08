# 1. Base stage for dependencies
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

# Disable the strict build check so it doesn't fight the frozen lockfile
RUN pnpm config set strict-dep-builds false
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------

# 2. Development stage
FROM base AS development
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev"]

# 3. Production build stage
FROM base AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN pnpm build

# 4. Production runtime stage
FROM node:22-slim AS production
RUN npm install -g pnpm@11
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/react-router.config.ts* ./

# Disable it here as well for the production install
RUN pnpm config set strict-dep-builds false
RUN pnpm install --prod --frozen-lockfile

# --- THE FIX ---
# Tell Node to accept external connections (crucial for Cloud Run)
ENV HOST=0.0.0.0
# Set the default port to what Cloud Run expects
ENV PORT=8080
EXPOSE 8080

# Run the start command
CMD ["sh", "-c", "pnpm start"]