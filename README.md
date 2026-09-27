# Minecraft-Bot

Fünf Mineflayer-Bots für `serverplayer1235.aternos.me:12490`. Die ersten beiden essen automatisch,
wenn Nahrung im Inventar vorhanden ist. Fehlt ein Weizenfeld,
versucht der erste Bot auf einer festen Erkundungsroute bis etwa 48 Blöcke vom Spawn
Grassamen und höchstens zwei Holzblöcke zu sammeln, eine Werkbank und Holzhoe zu craften
und bis zu vier Saatplätze auf vorhandener Erde nahe Wasser anzulegen. Danach suchen beide Bots reifen Weizen im
Umkreis von 32 Blöcken, teilen die Pflanzen untereinander auf, ernten und pflanzen nach.
Der dritte Bot sammelt zusätzlich Samen, Holz und Stein, sucht alle sichtbaren Erztypen,
craftet eine priorisierte Auswahl an Werkzeugen, Stationen und Hilfsmitteln und schmilzt
Rohmetalle, sofern ein Ofen und Brennstoff erreichbar sind. Alle drei suchen freiliegende
Erze im Umkreis von 24 Blöcken und bauen sie nur mit passender Spitzhacke und nicht direkt
neben Lava ab. Es wird nicht unterirdisch getunnelt. Ohne `STORAGE_CHEST` bleibt die Truhenlogistik aus. Setze dort die Koordinaten
einer eigenen Kiste im Format `x,y,z`; der erste Bot holt daraus begrenzte Mengen an
Samen, Holz, Nahrung oder Spitzhacken und lagert Überschüsse sowie Erze wieder ein.
Werkzeuge, bis zu acht Samen und kleine Holz-/Nahrungsvorräte bleiben im Inventar.
Das Crafting ist eine feste Liste häufig nützlicher Rezepte, keine automatische Planung
jedes existierenden Rezepts oder beliebiger Spielerziele. Die Farm- und Generalistenroutinen
legen weder Wasser an noch graben sie Land aus; ohne vorhandenes Wasser, Erde oder erreichbare
Rohstoffe bleiben sie eingeschränkt. Bauen ist auf die unten beschriebene Hausvorlage begrenzt;
Kampf, Handel und beliebige Spielziele sind nicht enthalten.

Der vierte Bot `xxPowerBoyxx` gräbt den 16×16-Chunk aus, in dem er erscheint, zunächst
16 Ebenen tief. `MINER_DEPTH` kann auf 1 bis 64 gesetzt werden. Er benötigt eine Schaufel
und eine Spitzhacke im Inventar; Flüssigkeiten und Bedrock werden ausgelassen. Der fünfte
Bot `CreativGamer_yt` baut am Spawn ein einfaches 9×9-Holzhaus mit Glasfenstern und flachem
Dach. Der vorhandene Boden dient als Hausboden. Für Baumaterial nutzt er Creative-Inventar,
aber nur, wenn der Server seinen Spielmodus tatsächlich auf Kreativ gesetzt hat.

## Start

Voraussetzung: Node.js 22 oder neuer.

1. Abhängigkeiten installieren: `npm install`
2. `.env.example` nach `.env` kopieren und `BOT_USERNAME` anpassen.
3. Optional `STORAGE_CHEST=x,y,z` in `.env` setzen, wenn eine eigene Lagerkiste vorhanden ist.
4. `npm start` ausführen.

Tests: `npm test`.

Standardmäßig verwendet der Bot Offline-Authentifizierung und benötigt daher keinen
Microsoft-Login. Das funktioniert nur, wenn der Server Offline-/Cracked-Spieler erlaubt.
Für einen Server mit aktivierter Online-Authentifizierung `MC_AUTH=microsoft` setzen;
dann wird beim Start der Microsoft-Anmeldefluss verwendet.
Optional beschränkt `BOT_OWNER` die Chatbefehle auf einen Spielernamen.

## Chatbefehle

- `!farm` startet oder setzt die automatische Arbeit aller Bots fort.
- `!stop` pausiert alle Bots.
- `!follow [Spieler]` lässt den ersten Bot dem genannten Spieler folgen.
- `!come` lässt den ersten Bot zum Absender laufen.
- `!status` meldet Gesundheit und Nahrung.
- `!help` listet die Befehle.

Alle Bots werden mit zehn Sekunden Abstand verbunden, um den Server nicht mit gleichzeitigen
Logins zu überlasten. Die Standardnamen sind `MCBot`, `MCBot2`, `MCBot3`, `xxPowerBoyxx`
und `CreativGamer_yt`. Sie lassen sich über `BOT_USERNAME`, `BOT2_USERNAME`,
`BOT3_USERNAME`, `BOT4_USERNAME` und `BOT5_USERNAME` ändern. `BOT_OWNER` beschränkt die
Chatbefehle auf einen Spielernamen.

Vor dem Start müssen Werkzeuge und Rechte über die Aternos-Serverkonsole vorbereitet
werden, zum Beispiel:

```text
give xxPowerBoyxx minecraft:iron_shovel 1
give xxPowerBoyxx minecraft:iron_pickaxe 1
gamemode creative CreativGamer_yt
```

Ohne diese Werkzeuge wartet der Miner; ohne Creative-Modus wartet der Builder. Der Bot kann
sich keine Serverrechte selbst erteilen.

`MC_VERSION` bleibt standardmäßig leer, sodass Mineflayer die Serverversion erkennt.
Die installierten Abhängigkeiten unterstützen das Protokoll 26.1; Minecraft-Daten für
26.1.1 werden dabei als Datenstand 26.1 aufgelöst. Ob genau der angegebene Aternos-Server
die Verbindung annimmt, muss mit einem berechtigten Konto geprüft werden.