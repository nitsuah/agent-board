FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir openllm

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/readyz')" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
