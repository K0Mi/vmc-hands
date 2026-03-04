# VMC Hands

Hand tracking and posing for VSeeFace via VMC protocol.

## Features

- **Track Mode**: MediaPipe hand tracking → VSeeFace
- **Pose Mode**: Manual sliders to pose each finger joint
- Adjustable multipliers and smoothing
- Works with any VRM model that has finger bones

## Quick Start

### 1. Start the bridge (receives WebSocket, sends OSC)

```bash
cd bridge
npm install
node index.js
```

### 2. Start the web app

```bash
npm install
npm run dev
```

### 3. Configure VSeeFace

- Settings → General → Enable "Receive VMC protocol data"
- Port: 39539 (default)

### 4. Open http://localhost:3000

- Click "Start Camera" for hand tracking
- Or switch to "Pose" mode and use sliders

## Bridge Options

```bash
node index.js --port 8765 --osc-host 127.0.0.1 --osc-port 39539
```

## Settings

- **Curl Multiplier**: How much fingers bend (0.5-1.0)
- **Thumb Multiplier**: Thumb sensitivity  
- **Smoothing**: 0 = raw, 0.9 = very smooth

## Architecture

```
Browser (MediaPipe) → WebSocket → Bridge → OSC → VSeeFace
         ↓
    Sliders (manual pose)
```

## License

MIT
