#!usr/bin/env python3

from pathlib import Path


DRM_ROOT = Path("/sys/class/drm")


def read_int(path):
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def get_gpu_metrics():
    devices = []

    if not DRM_ROOT.exists():
        return {
            "available": False,
            "devices": [],
        }

    for card in sorted(DRM_ROOT.glob("card[0-9]*")):
        device_path = card / "device"
        vendor_path = device_path / "vendor"

        try:
            vendor = vendor_path.read_text().strip().lower()
        except OSError:
            continue

        if vendor != "0x1002":
            continue

        try:
            device_id = (
                device_path / "device"
            ).read_text().strip()
        except OSError:
            device_id = None

        busy = read_int(
            device_path / "gpu_busy_percent"
        )

        vram_used = read_int(
            device_path / "mem_info_vram_used"
        )

        vram_total = read_int(
            device_path / "mem_info_vram_total"
        )

        devices.append({
            "card": card.name,
            "vendor": "AMD",
            "device_id": device_id,
            "utilization_percent": busy,
            "vram_used_bytes": vram_used,
            "vram_total_bytes": vram_total,
            "telemetry": {
                "utilization_available": busy is not None,
                "dedicated_vram_available": (
                    vram_used is not None
                    and vram_total is not None
                ),
            },
        })

    return {
        "available": bool(devices),
        "devices": devices,
    }
