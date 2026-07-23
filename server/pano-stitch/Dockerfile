# Runs the pano-stitch lib EXACTLY as-is (no source edits). serve.py guards app.run
# under __main__, so gunicorn imports `serve:app` and binds 0.0.0.0 without touching the lib.
FROM python:3.12-slim

# system libs opencv-python needs at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

EXPOSE 8151
# one worker, long timeout (a hard stitch can take minutes; stitch.py itself caps at 1800s)
CMD ["gunicorn", "-b", "0.0.0.0:8151", "-w", "1", "-t", "1800", "--graceful-timeout", "30", "serve:app"]
