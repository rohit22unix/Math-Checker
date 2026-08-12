# RunPod GPU setup for Math-Checker

Use this guide to rent a cloud GPU for **~8–20 second** worksheet checks while keeping **free Ollama** (no OpenAI/Google API).

**Typical cost:** ~$0.02–0.11 per homework session if you **Stop** the pod when finished.

---

## Start / Stop checklist (repeat each session)

Use this every time you check worksheets with RunPod GPU.

### When you START (before checking worksheets)

- [ ] **1. Start pod** — [RunPod Pods](https://www.console.runpod.io/pods) → select pod → **Start** (or deploy a new one if terminated)
- [ ] **2. Load model on GPU** — open **Web Terminal** on the pod and run:
  ```bash
  OLLAMA_HOST=0.0.0.0 ollama serve > ollama.log 2>&1 &
  sleep 5
  ollama run qwen3-vl:2b-instruct "Reply with OK."
  nvidia-smi
  ```
  Confirm GPU memory is in use (~2–32 GB) and `ollama ps` shows **100% GPU**.
- [ ] **3. SSH tunnel (Window 1)** — on your laptop, leave this open:
  ```powershell
  ssh -L 11435:127.0.0.1:11434 root@YOUR_POD_IP -p YOUR_SSH_PORT -i C:\Users\rohit\.ssh\id_ed25519
  ```
  Get `YOUR_POD_IP` and `YOUR_SSH_PORT` from the pod **Connect** tab.  
  **Use port 11435 locally** — Windows Ollama keeps 11434 busy.
- [ ] **4. Test tunnel (Window 2)**:
  ```powershell
  curl http://127.0.0.1:11435/api/ps
  ```
  Should return JSON with a large `"size_vram"`.
- [ ] **5. Start Math-Checker (Window 2)**:
  ```powershell
  cd C:\Users\rohit\OneDrive\Documents\AI-Tools\math-checker
  git pull origin master
  .\scripts\start-with-runpod.ps1
  ```
- [ ] **6. Open app** — `http://localhost:3000` → confirm **Ollama: ready · Processor: gpu**
- [ ] **7. Check worksheets** — expect **~8–25 seconds** per page

### When you STOP (after checking worksheets)

- [ ] **1. Stop Math-Checker** — close the app terminal or `Ctrl+C`
- [ ] **2. Close SSH tunnel** — type `exit` in Window 1 (or close the window)
- [ ] **3. Stop RunPod pod** — RunPod dashboard → your pod → **Stop**  
  **This stops billing.** Leaving a pod running overnight can cost ~$1–5.

### Pod is stopped right now?

Nothing to pay on RunPod until you **Start** the pod again. Your code and `.env.local` on the laptop are unchanged. Use the **START** checklist above next time.

---

## Part 1 — Create the RunPod GPU pod

### 1. Sign up and add credits

1. Go to [runpod.io](https://www.runpod.io) and create an account.
2. Open **Billing** and add **$5–10** — enough for many weeks of light use.

### 2. Deploy a pod

1. Open [Pods → Deploy](https://www.console.runpod.io/pods).
2. Pick a GPU with **≥ 8 GB VRAM**:
   - **RTX A4000 / A5000** (~$0.16–0.17/hr) — cheapest that works well
   - **RTX 3090** (~$0.22/hr) — good balance
   - **RTX 4090** (~$0.34/hr) — faster, not required
3. Choose **Community Cloud** unless you need Secure Cloud.
4. Template options:
   - **Fastest:** search **Ollama** in pod templates and use the official Ollama template.
   - **Manual:** use **PyTorch** template and install Ollama in Part 2 below.
5. Click **Edit Template** (or **Customize**):
   - **Expose HTTP Ports:** add `11434`
   - **Environment variable:** `OLLAMA_HOST` = `0.0.0.0`
6. Click **Deploy On-Demand** and wait until status is **Running** (~1–2 min).

### 3. Open the web terminal

1. Click your pod name.
2. **Enable Web Terminal** → **Open Web Terminal**.

### 4. Install Ollama (skip if you used the Ollama template)

```bash
apt update && apt install -y lshw zstd
(curl -fsSL https://ollama.com/install.sh | sh && OLLAMA_HOST=0.0.0.0 ollama serve > ollama.log 2>&1) &
```

Wait ~30 seconds, then verify:

```bash
curl http://127.0.0.1:11434/api/tags
```

### 5. Pull the vision model

```bash
ollama pull qwen3-vl:2b-instruct
```

This download is ~2–3 GB and takes a few minutes the first time.

Verify the model is listed:

```bash
ollama list
```

### 6. Copy your proxy URL

In the pod connection panel, find the **HTTP proxy** for port **11434**. It looks like:

```text
https://YOUR_POD_ID-11434.proxy.runpod.net
```

Save this — you need it for `.env.local`.

Test from the pod terminal:

```bash
curl https://YOUR_POD_ID-11434.proxy.runpod.net/api/tags
```

You should see JSON listing `qwen3-vl:2b-instruct`.

---

## Part 2 — Connect Math-Checker on your laptop

### 1. Update the project

In **PowerShell** on your Windows laptop:

```powershell
cd C:\Users\rohit\OneDrive\Documents\AI-Tools\math-checker
taskkill /IM node.exe /F
git pull origin master
```

### 2. Create `.env.local`

For **SSH tunnel** (recommended on Windows — use local port **11435**):

```env
OLLAMA_URL=http://127.0.0.1:11435
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_FAST_MODE=true
OLLAMA_KEEP_ALIVE=30m
```

Or, if the RunPod **HTTPS proxy** works for your pod (port 11434 exposed):

```env
OLLAMA_URL=https://YOUR_POD_ID-11434.proxy.runpod.net
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_FAST_MODE=true
OLLAMA_KEEP_ALIVE=30m
```

The `start-with-runpod.ps1` script writes the SSH tunnel `.env.local` for you automatically.

### 3. Test Ollama from your laptop

```powershell
.\scripts\test-ollama.ps1
```

Or manually:

```powershell
curl https://YOUR_POD_ID-11434.proxy.runpod.net/api/tags
```

### 4. Build and start Math-Checker

```powershell
.\scripts\start-with-runpod.ps1
```

Or manually:

```powershell
npm install
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run start -- --hostname 0.0.0.0
```

Open `http://localhost:3000`.

### 5. Confirm GPU is active

Wait for the status line under **Worksheet Report**:

```text
App grading engine: server-side-v2 · Ollama: ready · Processor: gpu
```

You should also see the green banner: *Ollama is using your GPU — worksheet analysis should finish in about 8–20 seconds.*

Upload a worksheet and press **Check My Work**. Timing should show **~8–20s** in the report header.

### 6. Stop the pod when done

In RunPod → your pod → **Stop** (or **Terminate**).

**You are billed only while the pod is running.** Forgetting to stop overnight can cost ~$1–5.

---

## Optional — Save the model between sessions

Without persistent storage, you re-download the model each new pod. To avoid that:

1. RunPod → **Storage** → **Add Network Volume** (~20 GB, ~$1.40/month).
2. Attach it to your pod at `/workspace`.
3. In the pod terminal:

```bash
export OLLAMA_MODELS=/workspace/ollama-models
mkdir -p /workspace/ollama-models
OLLAMA_HOST=0.0.0.0 OLLAMA_MODELS=/workspace/ollama-models ollama serve > /workspace/ollama.log 2>&1 &
ollama pull qwen3-vl:2b-instruct
```

---

## Troubleshooting

| Problem | What to do |
|---|---|
| **Ollama: offline** in app | Pod stopped, SSH tunnel closed, or wrong URL in `.env.local` |
| **Processor: cpu** | On pod run `ollama run qwen3-vl:2b-instruct "OK"` then check `nvidia-smi` |
| **`bind ... Permission denied`** on SSH | Use port **11435** locally, not 11434 (local Ollama conflict) |
| SSH asks for **password** | Add SSH public key to RunPod settings + pod `authorized_keys` |
| Proxy URL returns **404** | Use SSH tunnel instead; port 11434 may not be exposed on pod |
| `curl` fails from laptop | Pod not running; reconnect SSH tunnel |
| Only **1 question** in report | `git pull origin master` for quadrant fallback fix |
| High bill | **Stop** the pod after each session (see checklist above) |

---

## Cost cheat sheet

| Session length | RTX 3090 (~$0.22/hr) |
|---|---|
| 5 minutes | ~$0.02 |
| 15 minutes | ~$0.06 |
| 30 minutes | ~$0.11 |
| Left on 8 hours | ~$1.76 |

---

## Quick reference

| Item | Value |
|---|---|
| Model | `qwen3-vl:2b-instruct` |
| RunPod port | `11434` |
| Local SSH tunnel port | `11435` (avoids Windows Ollama on 11434) |
| Env var on pod | `OLLAMA_HOST=0.0.0.0` |
| Start script | `.\scripts\start-with-runpod.ps1` |
| Stop pod when done | **Yes — always** |

Official RunPod docs: [docs.runpod.io/tutorials/pods/run-ollama](https://docs.runpod.io/tutorials/pods/run-ollama)
