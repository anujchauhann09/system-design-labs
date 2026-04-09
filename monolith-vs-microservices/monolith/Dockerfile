# Use official Node LTS image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (layer caching — only reinstalls if deps change)
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy the rest of the source code
COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
