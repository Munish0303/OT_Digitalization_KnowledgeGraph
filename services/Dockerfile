FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# wheels/ is pre-downloaded on the host (unreliable network); falls back to PyPI if empty.
COPY wheels/ /wheels/
RUN pip install --no-cache-dir --no-index --find-links /wheels -r requirements.txt \
 || pip install --no-cache-dir --retries 10 --timeout 60 -r requirements.txt
COPY *.py ./
