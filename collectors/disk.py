#!usr/bin/env python3

import shutil
import subprocess


def get_disk_metrics():
    result = subprocess.run(
        [
            "df", "-B1", "-P",
            "-x", "tmpfs",
            "-x", "devtmpfs",
        ],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
    )

    disks = []

    for line in result.stdout.splitlines()[1:]:
        parts = line.split(maxsplit=5)

        if len(parts) != 6:
            continue

        device, total, used, available, percent, mount = parts

        disks.append({
            "device": device,
            "mount": mount,
            "total_bytes": int(total),
            "used_bytes": int(used),
            "available_bytes": int(available),
            "used_percent": float(percent.rstrip("%")),
        })

    return disks
