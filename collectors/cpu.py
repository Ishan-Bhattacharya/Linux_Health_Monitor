#!/usr/bin/env python3


from pathlib import Path
import os

PROC_STAT = Path("/proc/stat")
CPU_SYSFS = Path("/sys/devices/system/cpu")


def read_cpu_times():
    """Read aggregate and per-core CPU counters from /proc/stat."""
    result = {}

    with PROC_STAT.open("r", encoding="utf-8") as file:
        for line in file:
            parts = line.split()

            if not parts:
                continue

            name = parts[0]

            if name == "cpu" or (
                name.startswith("cpu") and name[3:].isdigit()
            ):
                result[name] = list(map(int, parts[1:]))

    if "cpu" not in result:
        raise RuntimeError("CPU statistics unavailable")

    return result


def calculate_cpu_usage(previous, current):
    """Calculate CPU utilization between two counter samples."""
    if previous is None or current is None:
        return None

    # Linux guest time is already included in user/nice.
    # Exclude guest and guest_nice from the total.
    previous_total = sum(previous[:8])
    current_total = sum(current[:8])

    previous_idle = previous[3] + previous[4]
    current_idle = current[3] + current[4]

    total_delta = current_total - previous_total
    idle_delta = current_idle - previous_idle

    if total_delta <= 0:
        return None

    usage = 100.0 * (total_delta - idle_delta) / total_delta

    return round(max(0.0, min(100.0, usage)), 2)


def read_cpu_frequency(cpu_name):
    """Return current CPU frequency in MHz when available."""
    frequency_file = (
        CPU_SYSFS / cpu_name / "cpufreq" / "scaling_cur_freq"
    )

    try:
        # Linux reports this frequency in kHz.
        return round(int(frequency_file.read_text().strip()) / 1000, 2)
    except (OSError, ValueError):
        return None


def get_cpu_metrics(previous, current):
    """Return aggregate and per-logical-CPU utilization."""
    previous = previous or {}
    current = current or {}

    aggregate_usage = calculate_cpu_usage(
        previous.get("cpu"),
        current.get("cpu"),
    )

    per_core = []

    cpu_names = sorted(
        (
            name for name in current
            if name.startswith("cpu") and name[3:].isdigit()
        ),
        key=lambda name: int(name[3:]),
    )

    for name in cpu_names:
        usage = calculate_cpu_usage(
            previous.get(name),
            current.get(name),
        )

        per_core.append({
            "cpu": name,
            "usage_percent": usage,
            "frequency_mhz": read_cpu_frequency(name),
        })

    try:
        load_average = list(os.getloadavg())
    except OSError:
        load_average = None

    return {
        "usage_percent": aggregate_usage,
        "logical_cores": os.cpu_count(),
        "load_average": load_average,
        "per_core": per_core,
    }


def get_cpu_snapshot():
    """Return raw counters for the next sampling interval."""
    return read_cpu_times()
