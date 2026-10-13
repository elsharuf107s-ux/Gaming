# Xenia Cloud Starter

A $0 control-plane prototype for a future browser-streamed Xenia setup.

## What works now

- GitHub Codespaces development environment
- Auto-forwarded web dashboard on port `3000`
- `/api/health` control-plane status
- `/api/gpu-host` simulated GPU-host status
- `/api/games` game library
- `/api/launch` mock/browser launch flow
- `/api/sessions` active session tracking
- Browser Stream Lab at `/stream.html`
- Keyboard and Chrome Gamepad API input testing
- 1280x720 canvas rendering and live FPS display
- GitHub Actions validation for the server, APIs, launch flow, and stream page

## What the Assassin's Creed entry means

The Assassin's Creed card is a **mock Xenia launch target only**. No copyrighted Xbox 360 game files or Ubisoft assets are included. Actual Assassin's Creed gameplay will require a compatible GPU host, Xenia, and game files you are legally entitled to use.

## Start in GitHub Codespaces

1. Open this repository on GitHub.
2. Select **Code → Codespaces → Create codespace on main**.
3. Let the dev container start the Node server.
4. Open forwarded port `3000`.
5. On the dashboard, launch **Streaming Test Lab**.
6. Test WASD/arrow keys, Space, Shift, and a connected controller if you have one.

## Commands

```bash
npm run check
npm start
```

## Current architecture

```text
Low-end Chromebook / Chrome
        |
        | HTTPS through Codespaces forwarded port
        v
GitHub Codespaces
- Dashboard
- Game library
- Session manager
- Mock GPU host
- Stream/input test client
- CI
        |
        | future provider API + authenticated WebRTC
        v
Real GPU Host (future)
- Windows/Linux GPU machine
- Xenia Canary
- Capture + hardware encoder
- Controller injection
- User-provided legal game dump
```

## Next real-host milestone

The API boundary is now in place. A future GPU connector can replace the mock host without replacing the Chromebook dashboard. The connector will need to provide host health, start/stop, game launch, session state, and an authenticated stream/signaling URL.

## Cost

The current implementation is designed to stay within GitHub's included Codespaces/Actions allowance and uses no paid GPU provider. Stop your Codespace when you are done testing to preserve included compute hours.
