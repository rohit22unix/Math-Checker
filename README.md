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

Create `.env.local` with those values if you need to override the defaults.

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
