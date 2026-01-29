# Use a Bun base image
FROM oven/bun:1.1.5

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy the rest of the application
COPY . .

# Expose the application port (change if needed)
EXPOSE 8080

# Start the application
CMD ["bun", "run", "src/index.ts"]