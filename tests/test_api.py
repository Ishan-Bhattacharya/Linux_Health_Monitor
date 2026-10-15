import time

from fastapi.testclient import TestClient

from app import app


def wait_for_metrics(client, timeout=10):
    """Wait until the background sampler publishes its first snapshot."""
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        response = client.get("/api/health")

        if response.status_code == 200:
            if response.json().get("metrics_available"):
                return

        time.sleep(0.1)

    raise AssertionError(
        "Metrics were not available within the timeout."
    )


def test_dashboard_route():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200


def test_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert isinstance(response.json(), dict)


def test_metrics_endpoint():
    with TestClient(app) as client:
        wait_for_metrics(client)

        response = client.get("/api/metrics")
        assert response.status_code == 200

        data = response.json()

        expected_sections = {
            "timestamp",
            "cpu",
            "memory",
            "disks",
            "network",
            "gpu",
            "system",
        }

        assert expected_sections.issubset(data.keys())
        assert isinstance(data["cpu"]["usage_percent"], (int, float))
        assert isinstance(data["memory"]["used_percent"], (int, float))
        assert isinstance(data["disks"], list)
        assert isinstance(data["network"], dict)
        assert isinstance(data["gpu"], dict)
        assert isinstance(data["system"], dict)
def test_system_endpoint():
    with TestClient(app) as client:
        wait_for_metrics(client)

        response = client.get("/api/system")
        assert response.status_code == 200

        data = response.json()

        assert "hostname" in data
        assert "os" in data
        assert "kernel" in data
        assert "logical_cores" in data
        assert data["logical_cores"] > 0
