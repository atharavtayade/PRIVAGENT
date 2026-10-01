"""
PRIVAGENT — Control Center & Web Dashboard
Serves a modern, interactive web UI at http://localhost:8000/
"""

HTML_DASHBOARD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRIVAGENT — AI Reasoning Brain & Control Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;600;700;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 25, 41, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #00f2fe;
      --primary-glow: rgba(0, 242, 254, 0.25);
      --accent: #4facfe;
      --success: #00e676;
      --warning: #ffb300;
      --text: #f0f4fc;
      --text-muted: #8e9bb4;
      --code-bg: #060911;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(0, 242, 254, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(79, 172, 254, 0.08) 0%, transparent 40%);
    }

    header {
      border-bottom: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      padding: 1.25rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(9, 13, 22, 0.8);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 0 20px var(--primary-glow);
    }

    .brand-title {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 1.4rem;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff, #b0c4de);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .status-pills {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.85rem;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 600;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
    }

    .pill-online {
      color: var(--success);
      border-color: rgba(0, 230, 118, 0.3);
      background: rgba(0, 230, 118, 0.08);
    }

    .pill-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
      100% { opacity: 1; transform: scale(1); }
    }

    main {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      width: 100%;
      flex: 1;
    }

    .hero {
      text-align: center;
      margin-bottom: 2.5rem;
    }

    .hero h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 2.5rem;
      font-weight: 800;
      margin-bottom: 0.6rem;
      background: linear-gradient(135deg, #ffffff, #88c0d0);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .hero p {
      color: var(--text-muted);
      font-size: 1.05rem;
      max-width: 700px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2.5rem;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.35rem;
      backdrop-filter: blur(10px);
      transition: transform 0.2s ease, border-color 0.2s ease;
    }

    .stat-card:hover {
      transform: translateY(-3px);
      border-color: rgba(0, 242, 254, 0.3);
    }

    .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-family: 'Outfit', sans-serif;
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--primary);
    }

    .stat-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.4rem;
    }

    .sim-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
      margin-bottom: 2.5rem;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    .sim-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
    }

    .sim-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.3rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .sim-presets {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }

    .preset-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .preset-btn:hover {
      background: rgba(0, 242, 254, 0.15);
      border-color: var(--primary);
      color: var(--primary);
    }

    .input-group {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    input[type="text"] {
      flex: 1;
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 0.85rem 1.1rem;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }

    input[type="text"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 10px var(--primary-glow);
    }

    .btn-run {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      color: #050811;
      font-weight: 700;
      border: none;
      padding: 0.85rem 1.5rem;
      border-radius: 10px;
      cursor: pointer;
      font-size: 0.95rem;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }

    .btn-run:hover {
      opacity: 0.9;
      transform: scale(1.02);
    }

    .output-box {
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.2rem;
      font-family: 'Fira Code', monospace;
      font-size: 0.85rem;
      color: #b0c4de;
      max-height: 350px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .links-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .link-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1rem;
      text-decoration: none;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.85rem;
      transition: all 0.2s ease;
    }

    .link-card:hover {
      background: rgba(0, 242, 254, 0.08);
      border-color: var(--primary);
      transform: translateY(-2px);
    }

    .link-icon {
      font-size: 1.5rem;
    }

    .link-info h4 {
      font-size: 0.95rem;
      margin-bottom: 0.2rem;
    }

    .link-info p {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    footer {
      border-top: 1px solid var(--card-border);
      padding: 1.5rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .tag-highlight {
      color: var(--primary);
      font-weight: 600;
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="logo-icon">🛡️</div>
      <div>
        <div class="brand-title">PRIVAGENT</div>
        <div class="brand-sub">SIH26171 — ISRO Department of Space</div>
      </div>
    </div>
    <div class="status-pills">
      <div class="pill pill-online">
        <div class="pill-dot"></div> SERVER ONLINE
      </div>
      <div class="pill">
        🔒 PRIVACY GATE: <span class="tag-highlight" style="margin-left:4px;">ENFORCED</span>
      </div>
    </div>
  </header>

  <main>
    <div class="hero">
      <h1>Privacy-First AI Agent Reasoning Brain</h1>
      <p>
        On-device visual perception & PII redaction layer connected to an intelligent reasoning server. Protected screen context is safely analyzed without sensitive data ever leaving your device.
      </p>
    </div>

    <!-- Stats Row -->
    <div class="grid-stats">
      <div class="stat-card">
        <div class="stat-label">Server Status</div>
        <div class="stat-value" style="color: var(--success);">Active</div>
        <div class="stat-desc">FastAPI + Google Gemini 2.0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Inferences</div>
        <div class="stat-value" id="stat-requests">0</div>
        <div class="stat-desc">Sanitized agent plan requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Latency</div>
        <div class="stat-value" id="stat-latency">0ms</div>
        <div class="stat-desc">End-to-end plan generation</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Privacy Boundary</div>
        <div class="stat-value" style="color: var(--primary);">100% Safe</div>
        <div class="stat-desc">0 Raw screen data transmitted</div>
      </div>
    </div>

    <!-- Live Reasoning Playground -->
    <div class="sim-section">
      <div class="sim-header">
        <div class="sim-title">⚡ Live Reasoning Simulator</div>
        <span style="font-size: 0.8rem; color: var(--text-muted);">Test the AI reasoning engine directly</span>
      </div>

      <div class="sim-presets">
        <button class="preset-btn" onclick="setPreset('Search python tutorial on YouTube')">🔍 YouTube Search</button>
        <button class="preset-btn" onclick="setPreset('View statement details for order #8841')">🧾 View Statement</button>
        <button class="preset-btn" onclick="setPreset('Check current account status')">📊 Check Status</button>
      </div>

      <div class="input-group">
        <input type="text" id="task-input" placeholder="Enter a browser task (e.g., Search cat videos on YouTube)..." value="Search python tutorial on YouTube">
        <button class="btn-run" onclick="runSimulation()">Run Plan</button>
      </div>

      <div class="output-box" id="output-box">// Click "Run Plan" or submit a task to see generated browser actions...</div>
    </div>

    <!-- Quick Navigation Links -->
    <div class="links-grid">
      <a href="/docs" class="link-card" target="_blank">
        <div class="link-icon">📖</div>
        <div class="link-info">
          <h4>Interactive Swagger Docs</h4>
          <p>Explore REST API schemas & endpoints at /docs</p>
        </div>
      </a>

      <a href="/health" class="link-card" target="_blank">
        <div class="link-icon">💚</div>
        <div class="link-info">
          <h4>Health Status</h4>
          <p>Inspect live server health at /health</p>
        </div>
      </a>

      <a href="/privacy/policy" class="link-card" target="_blank">
        <div class="link-icon">🛡️</div>
        <div class="link-info">
          <h4>Privacy Policy Audit</h4>
          <p>View PII category redaction rules at /privacy/policy</p>
        </div>
      </a>

      <a href="/metrics" class="link-card" target="_blank">
        <div class="link-icon">📈</div>
        <div class="link-info">
          <h4>Telemetry Metrics</h4>
          <p>View inference benchmark metrics at /metrics</p>
        </div>
      </a>
    </div>
  </main>

  <footer>
    PRIVAGENT (SIH26171) — Privacy-First On-Device Visual Perception for Lightweight Browser Agents · ISRO Dept of Space
  </footer>

  <script>
    function setPreset(text) {
      document.getElementById('task-input').value = text;
    }

    async function updateStats() {
      try {
        const res = await fetch('/metrics');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('stat-requests').innerText = data.total_inference_requests || 0;
          document.getElementById('stat-latency').innerText = (data.average_server_latency_ms || 0) + 'ms';
        }
      } catch (_) {}
    }

    async function runSimulation() {
      const task = document.getElementById('task-input').value.trim();
      const output = document.getElementById('output-box');
      if (!task) return;

      output.innerText = '// Transmitting sanitized context payload to reasoning brain...\n';

      const payload = {
        task: task,
        page: {
          url: 'https://youtube.com',
          title: 'YouTube',
          viewport: { width: 1280, height: 800 }
        },
        elements: [
          {
            id: 'el-1',
            type: 'input',
            selector: 'input#search',
            label: 'Search',
            text: '',
            tag: 'input',
            bbox: [200, 10, 400, 40],
            is_redacted: false
          },
          {
            id: 'el-2',
            type: 'button',
            selector: 'button#search-icon-legacy',
            label: 'Search Button',
            text: 'Search',
            tag: 'button',
            bbox: [600, 10, 60, 40],
            is_redacted: false
          }
        ],
        privacy_metadata: {
          totalRedactions: 0,
          policyMode: 'BALANCED',
          sanitized: true
        }
      };

      try {
        const t0 = performance.now();
        const res = await fetch('/agent/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const elapsed = (performance.now() - t0).toFixed(2);

        if (res.ok) {
          const data = await res.json();
          output.innerText = `// Plan Generated in ${elapsed}ms\n` + JSON.stringify(data, null, 2);
        } else {
          output.innerText = `// Server returned error ${res.status}: ${res.statusText}`;
        }
      } catch (err) {
        output.innerText = `// Failed to connect to server: ${err.message}`;
      }

      updateStats();
    }

    updateStats();
    setInterval(updateStats, 5000);
  </script>
</body>
</html>
"""
