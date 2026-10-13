# Xenia Cloud Starter

A $0 control-plane prototype for a future browser-streamed Xenia setup.

## What works now

- GitHub Codespaces development environment
- Auto-forwarded web dashboard on port `3000`
- `/api/health` status endpoint
- Environment/GPU visibility check
- GitHub Actions validation on pushes and pull requests
- Chromebook-friendly browser interface

## What this does not do yet

This repository does **not** run Xenia in ordinary GitHub Codespaces. Standard Codespaces is used as the control plane because a compatible GPU is not guaranteed. A future GPU host can connect to this project for emulator execution and game streaming.

Use only game files you are legally entitled to use.

## Start in GitHub Codespaces

1. Open this repository on GitHub.
2. Select **Code → Codespaces → Create codespace on main**.
3. Wait for the dev container to start.
4. Port `3000` should be forwarded automatically and open the dashboard.
5. If it does not, open the **Ports** tab and open port `3000` manually.

## Commands

```bash
npm run check
npm start
```

Then open the forwarded URL for port `3000`.

## Architecture

```text
Chromebook / Chrome
        |
        | HTTPS now; WebRTC later
        v
GitHub Codespaces
- Dashboard
- Health API
- Deployment/control scripts
- CI
        |
        | future provider API + secure signaling
        v
GPU Host (future)
- Xenia Canary
- Streaming server
- User-provided legal game dump
```

## $0 stage

The current stage intentionally requires no paid GPU provider. The next milestone is to add a mock GPU-host API and browser streaming test so the complete control flow can be developed before money is spent on GPU time.
