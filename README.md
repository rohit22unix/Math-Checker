# Math-Checker

Math-Checker is a mobile-friendly worksheet checker that uploads a worksheet image, sends it to a local Ollama server, and returns a worksheet report without using any paid API.

## Windows setup

1. Start Ollama locally:
   ```powershell
   ollama serve
   ```
2. Pull the fast instruct vision model:
   ```powershell
   ollama pull qwen3-vl:2b-instruct
   ```
   For better accuracy (slower), use `qwen3-vl:4b-instruct` instead.
3. Install dependencies if needed:
   ```powershell
   npm install
   ```
4. Build the app:
   ```powershell
   npm run build
   ```
5. Start the app so it is reachable from your phone:
   ```powershell
   npm run start -- --hostname 0.0.0.0
   ```
6. Open the app from another device using your laptop's IPv4 address and port 3000, for example:
   ```text
   http://192.168.2.14:3000
   ```

The laptop and phone must be on the same Wi-Fi network.

## Local configuration

The app reads the following environment variables:

```env
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3-vl:2b-instruct
```

Create `.env.local` from `.env.example` if you need to override the defaults.

Optional speed settings:

```env
OLLAMA_FAST_MODE=true
OLLAMA_KEEP_ALIVE=30m
```

## Speed tips

| Setup | Typical analysis time |
|---|---|
| CPU + `qwen3-vl:2b-instruct` | 25–60 seconds |
| NVIDIA GPU + `qwen3-vl:2b-instruct` | 8–20 seconds |
| CPU + `qwen3-vl:4b-instruct` | 60–120 seconds |

To get close to **10 seconds**:

1. Use a **GPU** — Ollama will use it automatically when available.
2. Keep **`qwen3-vl:2b-instruct`** (already the default).
3. Open the app once and wait for **Ollama: ready** — this pre-loads the model.
4. Set `OLLAMA_FAST_MODE=true` in `.env.local` for smaller/faster vision requests.
5. Crop photos close to the worksheet — less image data means faster inference.

The first worksheet after reboot is slower while Ollama loads the model into memory.

## GPU on another home PC (CPU-only laptop)

If your laptop has **no NVIDIA GPU**, you can still get **8–20 second** analysis by running Ollama on a different PC on your home network that has a GPU. The Math-Checker app stays on your laptop; only the vision model runs remotely.

### 1. Set up the GPU PC

On the Windows PC with an NVIDIA GPU:

1. Install [Ollama](https://ollama.com/download) if it is not already installed.
2. Pull the vision model:
   ```powershell
   ollama pull qwen3-vl:2b-instruct
   ```
3. Allow Ollama to accept connections from your home network. In **System → Environment Variables**, add a user variable:
   ```text
   OLLAMA_HOST=0.0.0.0
   ```
   Restart Ollama (quit the tray app and run `ollama serve`, or reboot).
4. Allow Windows Firewall inbound TCP on port **11434** (Private network profile).
5. Find the GPU PC's local IP (for example `192.168.1.50`):
   ```powershell
   ipconfig
   ```
6. From your laptop, confirm Ollama is reachable:
   ```powershell
   curl http://192.168.1.50:11434/api/tags
   ```

Both machines must be on the **same Wi‑Fi / LAN**.

### 2. Point Math-Checker at the GPU PC

On your laptop, create or edit `.env.local` in the project folder:

```env
OLLAMA_URL=http://192.168.1.50:11434
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_FAST_MODE=true
```

Replace `192.168.1.50` with your GPU PC's IP. Rebuild and start the app:

```powershell
npm run build
npm run start -- --hostname 0.0.0.0
```

Open the app and wait until the status line shows **Ollama: ready · Processor: gpu**. Worksheet checks should then finish in about **8–20 seconds**.

### Troubleshooting

| Symptom | Fix |
|---|---|
| **Ollama: offline** on laptop | GPU PC is asleep, Ollama not running, or wrong IP in `OLLAMA_URL` |
| **Processor: cpu** while using remote URL | GPU drivers missing on GPU PC, or model loaded before `OLLAMA_HOST=0.0.0.0` — restart Ollama on the GPU PC |
| Connection refused from laptop | Windows Firewall blocking port 11434 on the GPU PC |
| Still ~60s on "GPU" | Use `qwen3-vl:2b-instruct` (not the 4b model) and enable `OLLAMA_FAST_MODE=true` |

Copy `.env.example` to `.env.local` and uncomment the remote GPU lines as a starting template.

## Rent a cloud GPU (no GPU PC at home)

If you have **no NVIDIA GPU anywhere**, you can rent one by the hour and still use **free Ollama** (no OpenAI/Google vision API). Math-Checker stays on your laptop; only the vision model runs in the cloud.

**Step-by-step guide:** [docs/RUNPOD-SETUP.md](docs/RUNPOD-SETUP.md)

**Quick test after setup:**

```powershell
.\scripts\test-ollama.ps1
```

### Cost (typical)

| Provider | GPU example | ~Price | Worksheet session (~15 min) |
|---|---|---|---|
| [RunPod](https://www.runpod.io/console/pods) | RTX 3060 / 3070 | $0.15–0.25/hr | ~$0.04–0.06 |
| [RunPod](https://www.runpod.io/console/pods) | RTX 4090 | ~$0.44/hr | ~$0.11 |
| [Vast.ai](https://vast.ai) | Spot GPUs | often cheaper | varies |

**Stop the pod when you finish** — you only pay while it is running. A few homework checks per week is usually well under a dollar.

### Option A — RunPod (easiest)

1. Create a [RunPod](https://www.runpod.io) account and add billing.
2. **Pods → Deploy** → pick a GPU with **≥ 8 GB VRAM** (RTX 3060/3070 is enough for `qwen3-vl:2b-instruct`).
3. Use the **Ollama** template from the RunPod hub, or PyTorch + install Ollama manually.
4. In pod settings:
   - Expose HTTP port **11434**
   - Set env var **`OLLAMA_HOST=0.0.0.0`**
   - (Optional) Attach a **network volume** at `/workspace` and set `OLLAMA_MODELS=/workspace/ollama-models` so the model survives restarts.
5. Open the **Web Terminal** on the pod and pull the model:
   ```bash
   ollama pull qwen3-vl:2b-instruct
   ```
6. Copy the pod’s **proxy URL** for port 11434 (looks like `https://xxxxxxxx-11434.proxy.runpod.net`).
7. On your laptop, create `.env.local`:
   ```env
   OLLAMA_URL=https://xxxxxxxx-11434.proxy.runpod.net
   OLLAMA_MODEL=qwen3-vl:2b-instruct
   OLLAMA_FAST_MODE=true
   ```
8. Rebuild and start Math-Checker:
   ```powershell
   npm run build
   npm run start -- --hostname 0.0.0.0
   ```
9. Open the app — status should show **Processor: gpu**. When done checking worksheets, **Stop** the pod in RunPod.

Official RunPod guide: [docs.runpod.io/tutorials/pods/run-ollama](https://docs.runpod.io/tutorials/pods/run-ollama)

### Option B — SSH tunnel (more private)

If your cloud provider gives you SSH access instead of an HTTPS proxy, tunnel Ollama to your laptop so nothing is publicly exposed:

```powershell
ssh -L 11434:127.0.0.1:11434 root@YOUR_CLOUD_IP -N
```

Leave that window open. In `.env.local`:

```env
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_FAST_MODE=true
```

Math-Checker talks to `localhost:11434`; traffic is forwarded over SSH to Ollama on the GPU machine.

### Cloud troubleshooting

| Symptom | Fix |
|---|---|
| **Ollama: offline** | Pod stopped, wrong proxy URL, or model not pulled yet |
| **Processor: cpu** on cloud pod | GPU not attached — redeploy with a CUDA-capable template |
| HTTPS / certificate errors | Use the RunPod proxy URL exactly as shown (include `https://`) |
| Bill keeps growing | Stop the pod in the provider dashboard when not in use |
| Still slow first run | Normal — first request loads the model; later ones are faster |

### Stay on CPU instead?

If you only check worksheets occasionally and ~30–60 seconds is fine, keep Ollama on your laptop with no cloud cost:

```env
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3-vl:2b-instruct
```
