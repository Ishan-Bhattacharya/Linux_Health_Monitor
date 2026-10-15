#!usr/bin/env python3

import json
import time

from collectors.cpu import (
    get_cpu_snapshot,
    get_cpu_metrics,
)
from collectors.memory import get_memory_metrics
from collectors.disk import get_disk_metrics
from collectors.network import (
    read_network_counters,
    get_network_metrics,
)
from collectors.gpu import get_gpu_metrics
from collectors.system import get_system_metrics


def collect_snapshot(previous_cpu, previous_network, elapsed):
    current_cpu = get_cpu_snapshot()
    current_network = read_network_counters()

    metrics = {
        "timestamp": time.time(),
        "cpu": get_cpu_metrics(previous_cpu, current_cpu),
        "memory": get_memory_metrics(),
        "disks": get_disk_metrics(),
        "network": get_network_metrics(
            previous_network,
            current_network,
            elapsed,
        ),
        "gpu": get_gpu_metrics(),
        "system": get_system_metrics(),
    }

    return metrics, current_cpu, current_network

def main():
    previous_cpu = get_cpu_snapshot()
    previous_network = read_network_counters()
    previous_time = time.monotonic()

    time.sleep(1)

    current_time = time.monotonic()

    metrics, previous_cpu, previous_network = collect_snapshot(
        previous_cpu,
        previous_network,
        current_time - previous_time,
    )

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
