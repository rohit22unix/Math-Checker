# Math-Checker

Math-Checker is a mobile-friendly worksheet checker that uploads a worksheet image, sends it to a local Ollama server, and returns a worksheet report without using any paid API.

## Windows setup

1. Start Ollama locally:
   ```powershell
   ollama serve
   ```
2. Confirm the vision model is installed:
   ```powershell
   ollama pull qwen3-vl:4b
   ```
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
OLLAMA_MODEL=qwen3-vl:4b
```

You can copy the example file and adjust values if needed:

```powershell
copy .env.example .env.local
```
