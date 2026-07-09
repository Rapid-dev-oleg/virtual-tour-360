# ── Stage 1: Build React frontend ──
FROM node:20-slim AS builder

WORKDIR /app/web
COPY web/package.json ./
RUN npm install --legacy-peer-deps 2>&1

COPY web/ ./
RUN npm run build 2>&1

# ── Stage 2: Python backend ──
FROM python:3.11-slim-bookworm

# Install OpenCV + image dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python requirements first (cache layer)
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend into static directory
RUN mkdir -p static
COPY --from=builder /app/web/dist/ ./static/

# Create output directories
RUN mkdir -p uploads outputs temp

# Environment
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
