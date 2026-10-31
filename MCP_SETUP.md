# Tester Sarra avec Playwright MCP

Le MCP `playwright` est configuré dans `opencode.json` et se connecte au port
CDP `9222` de Sarra. Il permet de lire l’arbre d’accessibilité, cliquer,
capturer l’écran et consulter la console de l’application Electron.

## Installation

```sh
npm install -g @playwright/mcp
```

Le binaire `playwright-mcp` doit être dans le `PATH` (c’est le cas avec une
installation npm globale).

## Utilisation

1. Fermer Sarra si elle est ouverte, ou lancer `start-debug.bat` puis choisir
   `K` pour forcer le redémarrage.
2. `start-debug.bat` démarre Sarra avec `--remote-debugging-port=9222`.
3. Dans OpenCode, utiliser les outils Playwright (`browser_snapshot`,
   `browser_take_screenshot`, `browser_click`, `browser_console_messages`, …).

Le lancement normal reste `start.bat` : il n’ouvre pas le port de débogage.
Le port `9222` n’écoute que sur `127.0.0.1` et uniquement pendant une session
de test.
