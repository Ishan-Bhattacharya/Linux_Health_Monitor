#!/usr/bin/env python3

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

from monitor import (
    collect_snapshot,
    get_cpu_snapshot,
    read_network_counters,
)


BASE_DIR = Path(__file__).resolve().parent

SAMPLE_INTERVAL = 1.0

latest_metrics = None
sampler_task = None


async def metrics_sampler():
    global latest_metrics

    previous_cpu = get_cpu_snapshot()
    previous_network = read_network_counters()
    previous_time = time.monotonic()

    while True:
        await asyncio.sleep(SAMPLE_INTERVAL)

        current_time = time.monotonic()
        elapsed = current_time - previous_time

        try:
            metrics, previous_cpu, previous_network = (
                await asyncio.to_thread(
                    collect_snapshot,
                    previous_cpu,
                    previous_network,
                    elapsed,
                )
            )

            latest_metrics = metrics

        except Exception as exc:
            # Log the error without terminating the sampler.
            print(f"Metrics collection error: {exc}")

        previous_time = current_time


@asynccontextmanager
async def lifespan(app: FastAPI):
    global sampler_task

    sampler_task = asyncio.create_task(metrics_sampler())

    try:
        yield
    finally:
        sampler_task.cancel()

        try:
            await sampler_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Linux Health Monitor",
    version="0.1.0",
    lifespan=lifespan,
)

templates = Jinja2Templates(
    directory=str(BASE_DIR / "templates")
)

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": time.time(),
        "metrics_available": latest_metrics is not None,
    }


@app.get("/api/metrics")
async def metrics():
    if latest_metrics is None:
        raise HTTPException(
            status_code=503,
            detail="Metrics are not available yet",
        )

    return latest_metrics


@app.get("/api/system")
async def system():
    if latest_metrics is None:
        raise HTTPException(
            status_code=503,
            detail="System information is not available yet",
        )

    return latest_metrics["system"]
