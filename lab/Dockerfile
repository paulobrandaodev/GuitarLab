# CUDA base so Demucs and faster-whisper use the RTX 4060 instead of the CPU.
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TORCH_HOME=/models \
    HF_HOME=/models/hf

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8756
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8756"]
