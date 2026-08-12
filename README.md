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

Create `.env.local` with those values if you need to override the defaults. Analysis usually takes 20–60 seconds on the 2b model; the first run may take longer while Ollama loads the model.
