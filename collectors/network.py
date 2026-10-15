#!usr/bin/env python3

from pathlib import Path


PROC_NET_DEV = Path("/proc/net/dev")


def read_network_counters():
    interfaces = {}

    with PROC_NET_DEV.open(
        "r", encoding="utf-8"
    ) as file:
        for line in file.readlines()[2:]:
            if ":" not in line:
                continue

            name, stats = line.split(":", 1)
            values = list(map(int, stats.split()))

            if len(values) < 16:
                continue

            interfaces[name.strip()] = {
                "rx_bytes": values[0],
                "rx_packets": values[1],
                "rx_errors": values[2],
                "tx_bytes": values[8],
                "tx_packets": values[9],
                "tx_errors": values[10],
            }

    return interfaces


def get_network_metrics(previous, current, elapsed):
    result = {}

    for name, counters in current.items():
        old = previous.get(name, {})

        rx_rate = None
        tx_rate = None

        if elapsed > 0 and old:
            rx_rate = max(
                0, counters["rx_bytes"] - old["rx_bytes"]
            ) / elapsed

            tx_rate = max(
                0, counters["tx_bytes"] - old["tx_bytes"]
            ) / elapsed

        result[name] = {
            **counters,
            "rx_bytes_per_sec": (
                round(rx_rate, 2) if rx_rate is not None else None
            ),
            "tx_bytes_per_sec": (
                round(tx_rate, 2) if tx_rate is not None else None
            ),
        }

    return result
