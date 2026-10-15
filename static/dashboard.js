"use strict";

/*
 * Linux Health Monitor
 * Live telemetry dashboard with Chart.js.
 *
 * Expected endpoint: GET /api/metrics
 * Expected page sections: [data-view="memory"], etc.
 */

(() => {
    const REFRESH_INTERVAL = 2000;
    const HISTORY_LIMIT = 150;

    const COLORS = {
        cpu: "#ff2438",
        memory: "#f2f2f4",
        swap: "#8b8b94",
        download: "#ff2438",
        upload: "#f2f2f4",
        storage: "#ff2438",
        gpu: "#ff8a94",
        grid: "rgba(255, 255, 255, 0.07)",
        text: "#8b8b94"
    };

    const state = {
        charts: {},
        history: {
            labels: [],
            cpu: [],
            memory: [],
            swap: [],
            networkDownload: [],
            networkUpload: [],
            gpu: [],
            gpuMemory: [],
            load1: [],
            load5: [],
            load15: []
        },
        latestMetrics: null,
        refreshTimer: null,
        refreshing: false
    };

    const $ = (id) => document.getElementById(id);

    function setText(id, value) {
        const element = $(id);
        if (element && value !== undefined && value !== null) {
            element.textContent = String(value);
        }
    }

    function number(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min = 0, max = 100) {
        return Math.max(min, Math.min(max, value));
    }

    function formatPercent(value, digits = 1) {
        return `${clamp(number(value)).toFixed(digits)}%`;
    }

    function formatBytes(bytes) {
        bytes = Math.max(0, number(bytes));

        if (bytes < 1024) return `${bytes.toFixed(0)} B`;

        const units = ["KB", "MB", "GB", "TB", "PB"];
        let size = bytes / 1024;
        let index = 0;

        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index++;
        }

        return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[index]}`;
    }

    function formatRate(bytesPerSecond) {
        return `${formatBytes(bytesPerSecond)}/s`;
    }

    function formatDuration(seconds) {
        seconds = Math.max(0, Math.floor(number(seconds)));

        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days) return `${days}d ${hours}h`;
        if (hours) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function setConnectionStatus(connected, message) {
        const status = $("status");
        const indicator = $("status-indicator");

        if (status) {
            status.textContent = message || (connected ? "Connected" : "Disconnected");
        }

        if (indicator) {
            indicator.classList.toggle("connected", connected);
            indicator.classList.toggle("disconnected", !connected);
        }
    }

    /*
     * Find the page container using the existing navigation structure.
     */
    function getView(name) {
        return document.querySelector(`[data-view="${name}"]`);
    }

    /*
     * Create chart panels automatically. No manual canvas edits needed.
     */
    function createChartPanel(viewName, chartId, title, description) {
        const view = getView(viewName);

        if (!view) {
            console.warn(`Linux Health Monitor: view "${viewName}" not found.`);
            return null;
        }

        let canvas = $(chartId);
        if (canvas) return canvas;

        let grid = view.querySelector(".telemetry-chart-grid");

        if (!grid) {
            grid = document.createElement("div");
            grid.className = "telemetry-chart-grid";

            const heading = view.querySelector("h2, h3");
            const section = heading?.closest("section");

            if (section && section.parentElement === view) {
                section.insertAdjacentElement("afterend", grid);
            } else {
                view.appendChild(grid);
            }
        }

        const panel = document.createElement("article");
        panel.className = "telemetry-chart-panel";

        const header = document.createElement("div");
        header.className = "telemetry-chart-heading";

        const titleElement = document.createElement("h3");
        titleElement.textContent = title;

        const descriptionElement = document.createElement("p");
        descriptionElement.textContent = description;

        header.append(titleElement, descriptionElement);

        const container = document.createElement("div");
        container.className = "telemetry-chart-container";

        canvas = document.createElement("canvas");
        canvas.id = chartId;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", title);

        container.appendChild(canvas);
        panel.append(header, container);
        grid.appendChild(panel);

        return canvas;
    }

    function chartOptions({ percent = false, beginAtZero = true } = {}) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: COLORS.text,
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: "#0a0a0c",
                    titleColor: "#e2e8f0",
                    bodyColor: "#cbd5e1",
                    borderColor: "#2b2b31",
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: COLORS.text,
                        maxTicksLimit: 6,
                        maxRotation: 0
                    },
                    grid: {
                        color: COLORS.grid
                    }
                },
                y: {
                    beginAtZero,
                    ...(percent ? { min: 0, max: 100 } : {}),
                    ticks: {
                        color: COLORS.text,
                        callback: percent
                            ? (value) => `${value}%`
                            : undefined
                    },
                    grid: {
                        color: COLORS.grid
                    }
                }
            }
        };
    }

    function makeLineChart(canvasId, datasets, options = {}) {
        if (typeof Chart === "undefined") {
            console.error(
                "Chart.js is unavailable. Check the Chart.js script in index.html."
            );
            return null;
        }

        const canvas = $(canvasId);
        if (!canvas) return null;

        if (state.charts[canvasId]) {
            state.charts[canvasId].destroy();
        }

        const chart = new Chart(canvas.getContext("2d"), {
            type: "line",
            data: {
                labels: [],
                datasets: datasets.map((dataset) => ({
                    ...dataset,
                    data: [],
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: false,
                    spanGaps: true
                }))
            },
            options: chartOptions(options)
        });

        state.charts[canvasId] = chart;
        return chart;
    }

    function makeBarChart(canvasId, datasets, options = {}) {
        if (typeof Chart === "undefined") return null;

        const canvas = $(canvasId);
        if (!canvas) return null;

        if (state.charts[canvasId]) {
            state.charts[canvasId].destroy();
        }

        const chart = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: [],
                datasets: datasets.map((dataset) => ({
                    ...dataset,
                    data: [],
                    borderWidth: 0,
                    borderRadius: 5,
                    maxBarThickness: 30
                }))
            },
            options: {
                ...chartOptions(options),
                indexAxis: options.horizontal ? "y" : "x",
                scales: {
                    ...chartOptions(options).scales,
                    x: {
                        ...chartOptions(options).scales.x,
                        ...(options.horizontal ? { stacked: true } : {})
                    },
                    y: {
                        ...chartOptions(options).scales.y,
                        ...(options.horizontal ? { stacked: true } : {})
                    }
                }
            }
        });

        state.charts[canvasId] = chart;
        return chart;
    }

    function makeDoughnutChart(canvasId, { legend = true, colors = null } = {}) {
        if (typeof Chart === "undefined") return null;

        const canvas = $(canvasId);
        if (!canvas) return null;

        if (state.charts[canvasId]) {
            state.charts[canvasId].destroy();
        }

        const chart = new Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: ["Used", "Available"],
                datasets: [{
                    data: [0, 100],
                    backgroundColor: colors || [COLORS.storage, "#2b2b31"],
                    borderWidth: 0,
                    hoverOffset: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "72%",
                plugins: {
                    legend: {
                        display: legend,
                        position: "bottom",
                        labels: {
                            color: COLORS.text,
                            usePointStyle: true,
                            padding: 16
                        }
                    }
                }
            }
        });

        state.charts[canvasId] = chart;
        return chart;
    }

    function updateChart(chart, labels, values) {
        if (!chart) return;

        chart.data.labels = [...labels];

        chart.data.datasets.forEach((dataset, index) => {
            dataset.data = values[index] || [];
        });

        chart.update("none");
    }

    function appendHistory(label, key, value) {
        state.history.labels.push(label);
        state.history[key].push(value);
    }

    function recordSample(metrics) {
        const history = state.history;
        const label = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        history.labels.push(label);

        history.cpu.push(number(metrics.cpu?.usage_percent, null));

        const memory = metrics.memory || {};
        const swapTotal = number(memory.swap_total_bytes);
        const swapUsed = number(memory.swap_used_bytes);

        history.memory.push(number(memory.used_percent, null));
        history.swap.push(
            swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0
        );

        /*
         * Support common network counter naming conventions.
         * The exact collector fields are handled below.
         */
        let downloadRate = 0;
        let uploadRate = 0;

        for (const iface of Object.values(metrics.network || {})) {
            if (!iface || typeof iface !== "object") continue;

            downloadRate += number(
                iface.rx_bytes_per_sec ??
                iface.download_bytes_per_sec ??
                iface.rx_rate ??
                0
            );

            uploadRate += number(
                iface.tx_bytes_per_sec ??
                iface.upload_bytes_per_sec ??
                iface.tx_rate ??
                0
            );
        }

        history.networkDownload.push(downloadRate);
        history.networkUpload.push(uploadRate);

        const devices = metrics.gpu?.devices || [];
        const availableGPUs = devices.filter(
            device => device.utilization_percent != null
        );

        history.gpu.push(
            availableGPUs.length
                ? Math.max(...availableGPUs.map(
                    device => number(device.utilization_percent)
                ))
                : null
        );

        const vramUsed = devices.reduce(
            (sum, device) => sum + number(device.vram_used_bytes),
            0
        );

        const vramTotal = devices.reduce(
            (sum, device) => sum + number(device.vram_total_bytes),
            0
        );

        history.gpuMemory.push(
            vramTotal > 0 ? (vramUsed / vramTotal) * 100 : null
        );

        const load = metrics.system?.load_average ||
                     metrics.cpu?.load_average || [];

        history.load1.push(load.length > 0 ? number(load[0]) : null);
        history.load5.push(load.length > 1 ? number(load[1]) : null);
        history.load15.push(load.length > 2 ? number(load[2]) : null);

        while (history.labels.length > HISTORY_LIMIT) {
            history.labels.shift();

            for (const key of Object.keys(history)) {
                if (key !== "labels") {
                    history[key].shift();
                }
            }
        }
    }

    /*
     * Memory
     */
    function updateMemory(metrics) {
        const memory = metrics.memory || {};

        const total = number(memory.total_bytes);
        const used = number(memory.used_bytes);
        const available = number(memory.available_bytes);
        const usedPercent = number(memory.used_percent);

        setText("memory-usage", formatPercent(usedPercent));
        setText("memory-donut-percent", formatPercent(usedPercent));
        setText("memory-focus-percent", formatPercent(usedPercent));
        setText("memory-used-amount", formatBytes(used));
        setText("memory-available-amount", formatBytes(available));
        setText("memory-focus-used", formatBytes(used));
        setText("memory-focus-available", formatBytes(available));

        setText(
            "memory-details",
            `${formatBytes(used)} used of ${formatBytes(total)}`
        );

        setText(
            "memory-focus-details",
            `${formatBytes(used)} used · ${formatBytes(available)} available · ${formatBytes(total)} total`
        );

        const memoryBar = $("memory-bar");
        if (memoryBar) {
            memoryBar.style.width = `${clamp(usedPercent)}%`;
        }

        const swapTotal = number(memory.swap_total_bytes);
        const swapUsed = number(memory.swap_used_bytes);
        const swapAvailable = Math.max(0, swapTotal - swapUsed);
        const swapPercent = number(memory.swap_used_percent);

        setText("swap-donut-percent", formatPercent(swapPercent));
        setText("swap-used-amount", formatBytes(swapUsed));
        setText("swap-available-amount", formatBytes(swapAvailable));
        setText(
            "swap-details",
            `${formatBytes(swapUsed)} used of ${formatBytes(swapTotal)}`
        );

        for (const id of ["memory-donut-chart", "memory-focus-donut"]) {
            const donut = state.charts[id];
            if (donut) {
                donut.data.datasets[0].data = [used, Math.max(0, available)];
                donut.update("none");
            }
        }

        const swapDonut = state.charts["swap-donut-chart"];
        if (swapDonut) {
            swapDonut.data.datasets[0].data = swapTotal > 0
                ? [swapUsed, swapAvailable]
                : [0, 1];
            swapDonut.update("none");
        }

        const memoryChart = state.charts["memory-history-chart"];
        updateChart(
            memoryChart,
            state.history.labels,
            [state.history.memory]
        );

        const swapChart = state.charts["swap-history-chart"];
        updateChart(
            swapChart,
            state.history.labels,
            [state.history.swap]
        );

        const compositionChart = state.charts["memory-composition-chart"];

        if (compositionChart) {
            compositionChart.data.datasets[0].data = [
                used,
                available
            ];
            compositionChart.update("none");
        }
    }

    /*
     * Network
     */
    function getInterfaceRates(iface) {
        return {
            rx: number(
                iface.rx_bytes_per_sec ??
                iface.download_bytes_per_sec ??
                iface.rx_rate ??
                0
            ),
            tx: number(
                iface.tx_bytes_per_sec ??
                iface.upload_bytes_per_sec ??
                iface.tx_rate ??
                0
            )
        };
    }

    function updateNetwork(metrics) {
        const network = metrics.network || {};
        const interfaces = Object.entries(network);

        let download = 0;
        let upload = 0;
        let receivedTotal = 0;
        let transmittedTotal = 0;

        const interfaceLabels = [];
        const interfaceRx = [];
        const interfaceTx = [];

        for (const [name, iface] of interfaces) {
            if (!iface || typeof iface !== "object") continue;

            const rates = getInterfaceRates(iface);

            download += rates.rx;
            upload += rates.tx;

            receivedTotal += number(
                iface.rx_bytes ??
                iface.bytes_received ??
                iface.received_bytes ??
                0
            );

            transmittedTotal += number(
                iface.tx_bytes ??
                iface.bytes_sent ??
                iface.transmitted_bytes ??
                0
            );

            interfaceLabels.push(name);
            interfaceRx.push(rates.rx);
            interfaceTx.push(rates.tx);
        }

        setText("download-speed", formatRate(download));
        setText("upload-speed", formatRate(upload));
        setText("download-focus-value", formatRate(download));
        setText("upload-focus-value", formatRate(upload));

        const summary =
            `${interfaces.length} interfaces · ` +
            `${formatBytes(receivedTotal)} received · ` +
            `${formatBytes(transmittedTotal)} transmitted`;

        setText("network-focus-details", summary);

        const interfaceChart = state.charts["network-interface-chart"];

        if (interfaceChart) {
            interfaceChart.data.labels = interfaceLabels;
            interfaceChart.data.datasets[0].data = interfaceRx;
            interfaceChart.data.datasets[1].data = interfaceTx;
            interfaceChart.update("none");
        }

        updateChart(
            state.charts["network-throughput-chart"],
            state.history.labels,
            [
                state.history.networkDownload,
                state.history.networkUpload
            ]
        );
    }

    /*
     * Storage
     */
    function getDiskValue(disk, keys, fallback = 0) {
        for (const key of keys) {
            if (disk[key] !== undefined && disk[key] !== null) {
                return number(disk[key], fallback);
            }
        }
        return fallback;
    }

    function updateStorage(metrics) {
        const disks = Array.isArray(metrics.disks) ? metrics.disks : [];

        const labels = [];
        const percentages = [];
        const usedValues = [];
        const availableValues = [];

        for (const disk of disks) {
            const mount = String(
                disk.mount_point ??
                disk.mount ??
                disk.path ??
                disk.device ??
                "Unknown"
            );

            const total = getDiskValue(disk, [
                "total_bytes", "total", "size_bytes"
            ]);

            const used = getDiskValue(disk, [
                "used_bytes", "used"
            ]);

            const available = getDiskValue(disk, [
                "available_bytes", "free_bytes", "available"
            ]);

            let percent = getDiskValue(disk, [
                "used_percent", "usage_percent", "percent"
            ], total > 0 ? used / total * 100 : 0);

            if (percent <= 1 && total > 0 && used > 0) {
                percent *= 100;
            }

            labels.push(mount);
            percentages.push(clamp(percent));
            usedValues.push(used);
            availableValues.push(available);
        }

        const usageChart = state.charts["storage-usage-chart"];

        if (usageChart) {
            usageChart.data.labels = labels;
            usageChart.data.datasets[0].data = percentages;
            usageChart.update("none");
        }

        const capacityChart = state.charts["storage-capacity-chart"];

        if (capacityChart) {
            capacityChart.data.labels = labels;
            capacityChart.data.datasets[0].data = usedValues;
            capacityChart.data.datasets[1].data = availableValues;
            capacityChart.update("none");
        }

        const totalUsed = usedValues.reduce((a, b) => a + b, 0);
        const totalAvailable = availableValues.reduce((a, b) => a + b, 0);

        const details = disks.map((disk, index) => {
            const mount = labels[index];
            const percent = percentages[index];

            let status = "Normal";
            if (percent >= 90) status = "Critical";
            else if (percent >= 80) status = "Warning";

            return `${mount}: ${percent.toFixed(1)}% used (${status})`;
        });

        const summary =
            `${disks.length} filesystems · ` +
            `${formatBytes(totalUsed)} used · ` +
            `${formatBytes(totalAvailable)} available`;

        setText("storage-focus-details", summary);
        setText(
            "disk-details",
            details.join(" | ") || "No filesystem data available"
        );
    }

    /*
     * GPU
     */
    function updateGPU(metrics) {
        const gpu = metrics.gpu || {};
        const devices = gpu.devices || [];

        const available = gpu.available === true && devices.length > 0;

        setText(
            "gpu-status",
            available
                ? `${devices.length} GPU device${devices.length === 1 ? "" : "s"} detected`
                : "GPU telemetry unavailable"
        );

        setText(
            "gpu-focus-status",
            available
                ? `${devices.length} GPU device${devices.length === 1 ? "" : "s"} detected`
                : "GPU telemetry unavailable"
        );

        const details = devices.map((device) => {
            const name = `${device.vendor || "GPU"} ${device.card || ""}`.trim();
            const utilization = device.utilization_percent;

            const vramUsed = number(device.vram_used_bytes);
            const vramTotal = number(device.vram_total_bytes);

            const utilizationText = utilization == null
                ? "utilization unavailable"
                : `${number(utilization).toFixed(1)}% utilization`;

            const memoryText = vramTotal > 0
                ? `${formatBytes(vramUsed)} / ${formatBytes(vramTotal)} VRAM`
                : "VRAM telemetry unavailable";

            return `${name}: ${utilizationText} · ${memoryText}`;
        });

        setText(
            "gpu-details",
            details.join(" | ") || "No GPU telemetry available"
        );

        setText(
            "gpu-focus-details",
            details.join("\n") || "No GPU telemetry available"
        );

        const usageChart = state.charts["gpu-history-chart"];

        updateChart(
            usageChart,
            state.history.labels,
            [state.history.gpu]
        );

        const memoryChart = state.charts["gpu-memory-history-chart"];

        updateChart(
            memoryChart,
            state.history.labels,
            [state.history.gpuMemory]
        );
    }

    /*
     * System
     */
    function updateSystem(metrics) {
        const system = metrics.system || {};
        const cpu = metrics.cpu || {};

        setText("hostname", system.hostname || "Unknown");
        setText("sidebar-hostname", system.hostname || "Unknown");

        const load = system.load_average || cpu.load_average || [];

        const loadText = load.length
            ? load.map(value => number(value).toFixed(2)).join(" / ")
            : "Unavailable";

        const uptime = formatDuration(system.uptime_seconds);

        const details = [
            system.hostname,
            system.os,
            `Kernel ${system.kernel || "Unknown"}`,
            `Uptime ${uptime}`
        ].filter(Boolean).join(" · ");

        setText("system-details", details);
        setText("system-focus-details", details);
        setText("cpu-focus-load", loadText);

        updateChart(
            state.charts["system-load-chart"],
            state.history.labels,
            [
                state.history.load1,
                state.history.load5,
                state.history.load15
            ]
        );
    }

    /*
     * CPU: retain the existing numeric readings and per-core grid.
     */
    function updateCPU(metrics) {
        const cpu = metrics.cpu || {};

        const usage = number(cpu.usage_percent);
        const cores = number(cpu.logical_cores, 0);

        setText("cpu-usage", formatPercent(usage));
        setText("cpu-focus-value", formatPercent(usage));
        setText("cpu-cores", cores);
        setText("cpu-focus-cores", cores);
        setText("core-count", cores);

        updateChart(
            state.charts["cpu-history-chart"],
            state.history.labels,
            [state.history.cpu]
        );

        const perCore = Array.isArray(cpu.per_core) ? cpu.per_core : [];
        const grid = $("per-core-grid");

        if (grid && perCore.length) {
            grid.innerHTML = perCore.map((core, index) => {
                const value = typeof core === "object"
                    ? number(core.usage_percent ?? core.usage ?? core.percent)
                    : number(core);

                return `
                    <div class="core-meter">
                        <div class="core-meter-label">
                            <span>Core ${index}</span>
                            <span>${clamp(value).toFixed(1)}%</span>
                        </div>
                        <div class="core-meter-track">
                            <div class="core-meter-fill"
                                 style="width:${clamp(value)}%"></div>
                        </div>
                    </div>`;
            }).join("");
        }
    }

    /*
     * Initialize all charts after their canvases have been created.
     */
    function initializeCharts() {
        if (typeof Chart === "undefined") {
            console.error("Chart.js did not load.");
            return;
        }

        /*
         * Charts whose canvases already exist in index.html
         */
        makeLineChart("cpu-history-chart", [{
            label: "CPU usage",
            borderColor: COLORS.cpu,
            backgroundColor: COLORS.cpu,
            data: []
        }], { percent: true });

        makeDoughnutChart("memory-donut-chart", {
            legend: false, colors: [COLORS.memory, "#2b2b31"]
        });
        makeDoughnutChart("memory-focus-donut", {
            legend: false, colors: [COLORS.memory, "#2b2b31"]
        });
        makeDoughnutChart("swap-donut-chart", {
            legend: false, colors: [COLORS.swap, "#2b2b31"]
        });

        /*
         * Memory charts
         */
        createChartPanel(
            "memory",
            "memory-history-chart",
            "RAM Usage History",
            "Used memory over the last five minutes"
        );

        createChartPanel(
            "memory",
            "swap-history-chart",
            "Swap Usage History",
            "Swap utilization over the last five minutes"
        );

        createChartPanel(
            "memory",
            "memory-composition-chart",
            "Memory Composition",
            "Current used and available physical memory"
        );

        makeLineChart("memory-history-chart", [{
            label: "RAM used",
            borderColor: COLORS.memory,
            backgroundColor: COLORS.memory,
            data: []
        }], { percent: true });

        makeLineChart("swap-history-chart", [{
            label: "Swap used",
            borderColor: COLORS.swap,
            backgroundColor: COLORS.swap,
            data: []
        }], { percent: true });

        makeDoughnutChart("memory-composition-chart");

        /*
         * Network charts
         */
        createChartPanel(
            "network",
            "network-throughput-chart",
            "Network Throughput",
            "Receive and transmit rates"
        );

        createChartPanel(
            "network",
            "network-interface-chart",
            "Interface Traffic",
            "Current receive and transmit rates per interface"
        );

        makeLineChart("network-throughput-chart", [
            {
                label: "Download",
                borderColor: COLORS.download,
                data: []
            },
            {
                label: "Upload",
                borderColor: COLORS.upload,
                data: []
            }
        ]);

        makeBarChart("network-interface-chart", [
            {
                label: "Receive",
                backgroundColor: COLORS.download,
                data: []
            },
            {
                label: "Transmit",
                backgroundColor: COLORS.upload,
                data: []
            }
        ]);

        /*
         * Storage charts
         */
        createChartPanel(
            "storage",
            "storage-usage-chart",
            "Filesystem Utilization",
            "Percentage of capacity used by mount point"
        );

        createChartPanel(
            "storage",
            "storage-capacity-chart",
            "Storage Capacity",
            "Used and available bytes by filesystem"
        );

        makeBarChart("storage-usage-chart", [{
            label: "Used capacity",
            backgroundColor: COLORS.storage,
            data: []
        }]);

        makeBarChart("storage-capacity-chart", [
            {
                label: "Used",
                backgroundColor: COLORS.storage,
                data: []
            },
            {
                label: "Available",
                backgroundColor: "#2b2b31",
                data: []
            }
        ], { horizontal: true });

        /*
         * GPU charts
         */
        createChartPanel(
            "gpu",
            "gpu-history-chart",
            "GPU Utilization History",
            "Maximum reported GPU utilization"
        );

        createChartPanel(
            "gpu",
            "gpu-memory-history-chart",
            "VRAM Usage History",
            "Percentage of detected video memory in use"
        );

        makeLineChart("gpu-history-chart", [{
            label: "GPU utilization",
            borderColor: COLORS.gpu,
            data: []
        }], { percent: true });

        makeLineChart("gpu-memory-history-chart", [{
            label: "VRAM used",
            borderColor: COLORS.swap,
            data: []
        }], { percent: true });

        /*
         * System charts
         */
        createChartPanel(
            "system",
            "system-load-chart",
            "System Load Average",
            "Load averages over the last five minutes"
        );

        makeLineChart("system-load-chart", [
            {
                label: "1 minute",
                borderColor: COLORS.cpu,
                data: []
            },
            {
                label: "5 minutes",
                borderColor: COLORS.memory,
                data: []
            },
            {
                label: "15 minutes",
                borderColor: COLORS.gpu,
                data: []
            }
        ]);
    }

    async function refresh() {
        if (state.refreshing) return;
        state.refreshing = true;

        try {
            const response = await fetch("/api/metrics", {
                cache: "no-store",
                headers: { "Accept": "application/json" }
            });

            if (!response.ok) {
                throw new Error(`Metrics API returned HTTP ${response.status}`);
            }

            const metrics = await response.json();
            state.latestMetrics = metrics;

            recordSample(metrics);

            updateCPU(metrics);
            updateMemory(metrics);
            updateNetwork(metrics);
            updateStorage(metrics);
            updateGPU(metrics);
            updateSystem(metrics);

            setText(
                "last-updated",
                new Date().toLocaleTimeString()
            );

            setConnectionStatus(true, "Connected");
        } catch (error) {
            console.error("Metrics refresh failed:", error);
            setConnectionStatus(false, "Connection error");
        } finally {
            state.refreshing = false;
        }
    }

    /*
     * Existing navigation compatibility.
     */
    function activateView(viewName) {
        document.querySelectorAll("[data-view]").forEach((view) => {
            const active = view.dataset.view === viewName;
            view.hidden = !active;
            view.classList.toggle("active", active);
        });

        document.querySelectorAll("[data-view-link]").forEach((link) => {
            const active = link.dataset.viewLink === viewName;
            link.classList.toggle("active", active);

            if (active) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });

        const titles = {
            overview: ["Overview", "System resource summary."],
            cpu: ["CPU", "Processor utilization and load."],
            memory: ["Memory", "RAM and swap consumption."],
            storage: ["Storage", "Mounted filesystems and available disk capacity."],
            network: ["Network", "Network interface activity and transfer rates."],
            gpu: ["GPU", "GPU utilization and available video memory telemetry."],
            system: ["System", "Operating system, kernel, uptime, and host details."]
        };

        const page = titles[viewName];

        if (page) {
            setText("page-title", page[0]);
            setText("page-description", page[1]);
            document.title = `${page[0]} | Linux Health Monitor`;
        }

        if (location.hash !== `#${viewName}`) {
            history.replaceState(null, "", `#${viewName}`);
        }

       requestAnimationFrame(() => {
    requestAnimationFrame(() => {
        Object.values(state.charts).forEach((chart) => {
            if (chart && chart.canvas.offsetParent !== null) {
                chart.resize();
                chart.update("none");
            }
        });
    });
});
    }

    function bindNavigation() {
        document.querySelectorAll("[data-view-link]").forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                activateView(link.dataset.viewLink);
            });
        });

        const sidebarToggle = $("sidebar-toggle");

        if (sidebarToggle) {
            sidebarToggle.addEventListener("click", () => {
                document.querySelector(".app-shell")
                    ?.classList.toggle("sidebar-collapsed");
            });
        }

        const initialView = location.hash.replace("#", "") || "overview";

        if (getView(initialView)) {
            activateView(initialView);
        } else {
            activateView("overview");
        }
    }

    function start() {
        if (typeof Chart === "undefined") {
            console.error(
                "Chart.js is missing. Check /static/vendor/chart.umd.min.js"
            );
            return;
        }

        initializeCharts();
        bindNavigation();
        refresh();

        state.refreshTimer = window.setInterval(
            refresh,
            REFRESH_INTERVAL
        );

        window.LinuxHealthMonitor = {
            refresh,
            activateView,
            getLatestMetrics: () => state.latestMetrics,
            getHistory: () => state.history,
            getCharts: () => state.charts
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
