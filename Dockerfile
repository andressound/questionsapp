# Imagen ligera para desplegar el backend en la nube.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8080

# Node recibe SIGTERM directamente (sin npm de por medio) para el cierre ordenado.
CMD ["node", "src/server.js"]
