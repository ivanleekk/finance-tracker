# 1. Use the Debian-based slim image
FROM node:22-slim

# 2. Install the missing shared library required for ARM64 native binaries
RUN apt-get update && apt-get install -y libatomic1 && rm -rf /var/lib/apt/lists/*

# 3. Install pnpm
RUN npm install -g pnpm

# 4. Set your working directory
WORKDIR /app

# 5. Copy ONLY package files first
COPY package.json pnpm-lock.yaml ./

# 6. Install dependencies
RUN pnpm install --frozen-lockfile

# 7. Copy the rest of your application code
COPY . .

# 8. Start the development server
EXPOSE 5173
CMD ["pnpm", "dev"]