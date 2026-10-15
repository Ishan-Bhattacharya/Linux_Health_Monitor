#!usr/bin/env python3

from pathlib import Path


def get_memory_metrics():
    values = {}

    with Path("/proc/meminfo").open(
        "r", encoding="utf-8"
    ) as file:
        for line in file:
            key, value = line.split(":", 1)
            values[key] = int(value.strip().split()[0]) * 1024

    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", 0)
    swap_total = values.get("SwapTotal", 0)
    swap_free = values.get("SwapFree", 0)

    return {
        "total_bytes": total,
        "available_bytes": available,
        "used_bytes": max(0, total - available),
        "used_percent": round(
            100 * (total - available) / total, 2
        ) if total else None,
        "swap_total_bytes": swap_total,
        "swap_used_bytes": swap_total - swap_free,
        "swap_used_percent": round(
            100 * (swap_total - swap_free) / swap_total, 2
        ) if swap_total else 0.0,
    }
