# ── Etapa 1: build del frontend (Vite/React) ──
FROM node:20-alpine AS build
WORKDIR /app

# Instala dependencias (capa cacheable)
COPY package*.json ./
RUN npm ci

# Copia el resto del código y construye.
# Las variables VITE_* se leen automáticamente del archivo .env del proyecto
# y se "hornean" en el bundle durante el build.
COPY . .
RUN npm run build

# ── Etapa 2: servir los estáticos con nginx ──
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
