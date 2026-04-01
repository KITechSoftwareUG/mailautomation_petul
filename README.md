# Petulia Mail Automation Monorepo

Dieses Repository ist nun sauber als Monorepo strukturiert.

## Projektstruktur

- **/backend**: Der Node.js Backend-Service für die E-Mail-Automatisierung (ImapFlow, AI Processing).
- **/dashboard**: Das Next.js Frontend (Petulia AI Decision Hub) für das Monitoring und die Steuerung.

## Deployment auf Vercel

Vercel ist so konfiguriert (`vercel.json` im Root), dass es automatisch das Verzeichnis `/dashboard` als Root-Directory nutzt.
Sollte es im Dashboard von Vercel dennoch Probleme geben, stellen Sie manuell unter **Project Settings > General > Root Directory** das Verzeichnis `dashboard` ein.

## Backend Betrieb (PM2)

Das Backend wird über PM2 gestartet. Wechseln Sie dazu in das Backend-Verzeichnis:

```bash
cd backend
pm2 start ecosystem.config.cjs
```