#!usr/bin/env python3

import os
import platform
import time


def get_system_metrics():
    uptime_seconds = int(time.time() - psutil_boot_time())

    return {
        "hostname": platform.node(),
        "os": platform.platform(),
        "kernel": platform.release(),
        "architecture": platform.machine(),
        "logical_cores": os.cpu_count(),
        "uptime_seconds": uptime_seconds,
        "load_average": (
            list(os.getloadavg())
            if hasattr(os, "getloadavg")
            else None
        ),
    }


def psutil_boot_time():
    with open("/proc/uptime", "r", encoding="utf-8") as file:
        uptime = float(file.read().split()[0])

    return time.time() - uptime
