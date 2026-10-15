# Linux Health Monitor

A lightweight, real-time health monitoring system for Linux machines. It collects system
metrics straight from the source — traditional Linux interfaces like `/proc` — serves them
through a FastAPI backend, and visualizes them on a live, BIOS-themed web dashboard.

Useful doesn't have to mean complicated: no agents, no databases, no heavyweight
monitoring stack. Just clean collectors, a small API, and one question answered fast —
*is my machine healthy right now?*

&lt;!-- TODO: add a screenshot of the dashboard here --&gt;
&lt;!-- ![Dashboard](docs/dashboard.png) --&gt;

## Features

- **CPU** — utilization computed from `/proc/stat` deltas across sampling intervals
- **Memory** — usage and breakdown straight from `/proc/meminfo`
- **Disk** — per-mount usage statistics
- **Network** — throughput calculated from `/proc/net/dev` counter deltas
- **GPU** — utilization and memory via `nvidia-smi` (when available)
- **System** — hostname, kernel, uptime, and platform info
- **Live dashboard** — auto-updating web UI served by FastAPI, no build step required

## How It Works

```
/proc, /sys, nvidia-smi          Linux system interfaces
        |
        v
  collectors/      cpu, memory, disk, network, gpu, system collectors
        |
        v
  monitor.py       builds one JSON snapshot per interval (also runnable standalone)
        |
        v
  app.py           FastAPI app — background asyncio sampler, JSON API, dashboard
        |
        v
  templates/ + static/   live dashboard (vanilla JS + CSS)
```

A background sampler task runs at a fixed interval (1s by default), computes
rate-based metrics from counter deltas (CPU %, network throughput), and keeps the
latest snapshot in memory. The API and dashboard read from that snapshot, so requests
never block on collection.

## Quick Start

Requires Python 3.10+ and a Linux system (developed and tested on Ubuntu).

```bash
# 1. Clone the repository
git clone https://github.com/Ishan-Bhattacharya/Linux_Health_Monitor.git
cd Linux_Health_Monitor

# 2. Create a virtual environment and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn jinja2

# 3. Run the server
uvicorn app:app --reload
```

Then open http://localhost:8000 in your browser.

You can also inspect a single metrics snapshot from the terminal without the server:

```bash
python monitor.py
```

## API Endpoints

| Endpoint       | Description                                                        |
|----------------|--------------------------------------------------------------------|
| `GET /`        | Live dashboard (HTML)                                              |
| `GET /api/health`  | Service status and whether a metrics snapshot is available     |
| `GET /api/metrics` | Full latest snapshot: CPU, memory, disks, network, GPU, system |
| `GET /api/system`  | System info only (hostname, kernel, uptime, platform)          |

Interactive API docs are auto-generated at `/docs` (Swagger UI) and `/redoc`.

Example:

```bash
curl http://localhost:8000/api/metrics
```

```json
{
  "timestamp": 1729000000.0,
  "cpu": { "..." : "..." },
  "memory": { "..." : "..." },
  "disks": [],
  "network": { "..." : "..." },
  "gpu": { "..." : "..." },
  "system": { "..." : "..." }
}
```

## Project Structure

```
Linux_Health_Monitor/
├── app.py              # FastAPI application: sampler lifecycle, API routes, dashboard
├── monitor.py          # Snapshot builder; runnable standalone for CLI output
├── collectors/
│   ├── cpu.py          # /proc/stat parsing, utilization deltas
│   ├── memory.py       # /proc/meminfo parsing
│   ├── disk.py         # filesystem usage
│   ├── network.py      # /proc/net/dev counter deltas
│   ├── gpu.py          # nvidia-smi wrapper
│   └── system.py       # hostname, kernel, uptime, platform
├── templates/
│   └── index.html      # dashboard page
├── static/
│   ├── dashboard.js    # live UI updates
│   ├── style.css
│   ├── bios-theme.css  # retro BIOS theme
│   └── vendor/
└── tests/
```

## Why /proc Instead of a Monitoring Library?

Every metric this project reports is something the Linux kernel already publishes.
Reading `/proc/stat`, `/proc/meminfo`, or `/proc/net/dev` directly forces you to
understand what the numbers actually mean — jiffies, counter deltas, buffer/cache
accounting — instead of trusting an abstraction. When this dashboard shows a memory
spike, you know exactly where the OS keeps that number and how it was computed.

## Configuration

The sampling interval is defined in `app.py`:

```python
SAMPLE_INTERVAL = 1.0  # seconds
```

## Requirements

- Python 3.10+
- `fastapi`, `uvicorn`, `jinja2`
- Optional: NVIDIA GPU + `nvidia-smi` for GPU metrics

## Roadmap

- [ ] Alert thresholds with dashboard indicators
- [ ] Historical metrics with a simple time-series buffer
- [ ] Per-process CPU/memory listing
- [ ] Tests for collectors
