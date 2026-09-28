# Autonomous Mineflayer Bot – GitHub + Render

## Dateien
- `index.js` – Bot und autonomes Task-System
- `package.json` – Node.js-Abhängigkeiten
- `render.yaml` – Render-Konfiguration

## GitHub
1. Neues Repository erstellen.
2. Diese drei Dateien in das Repository hochladen.
3. Commit auf `main`.

## Render
Render mit GitHub verbinden und das Repository als Web Service auswählen.
Build:
`npm install`

Start:
`npm start`

Umgebungsvariablen:
- `MC_HOST` = Minecraft-Serveradresse
- `MC_PORT` = Serverport
- `MC_USERNAME` = Botname
- `MC_VERSION` = optional, z. B. `1.21.11`

## Chat
`!status`
`!lager`
`!lagern`
`!stop`
`!start`
`!resume`

## Wichtig
Der kostenlose Render-Web-Service kann bei Inaktivität heruntergefahren werden. Das kann einen dauerhaft laufenden Minecraft-Bot unterbrechen. Die Render-Health-URL ist `/health`.
