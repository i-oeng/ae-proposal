FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
ARG API_INTERNAL_BASE_URL=http://127.0.0.1:8000
ENV API_INTERNAL_BASE_URL=$API_INTERNAL_BASE_URL
RUN npm run build


FROM python:3.12-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV API_HOST=0.0.0.0
ENV API_PORT=8000
ENV FRONTEND_HOST=0.0.0.0
ENV FRONTEND_PORT=3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=frontend-builder /usr/local/bin/node /usr/local/bin/node

COPY requirements-runtime.txt ./
RUN pip install --no-cache-dir -r requirements-runtime.txt

COPY api ./api
COPY core ./core
COPY knowledge_base ./knowledge_base
COPY reference_materials ./reference_materials
COPY templates ./templates
COPY scripts ./scripts
COPY ui ./ui
COPY config.yaml README.md ./
COPY --from=frontend-builder /app/frontend/.next/standalone ./frontend
COPY --from=frontend-builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-builder /app/frontend/public ./frontend/public

RUN mkdir -p cache logs outputs

EXPOSE 3000 8000

CMD ["python", "scripts/start_container.py"]
