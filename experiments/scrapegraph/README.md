# Pilote ScrapeGraphAI

Ce banc d’essai compare 20 à 30 pages publiques Greenhouse : l’API GET
officielle sert de vérité terrain, l’extracteur HTML/JSON-LD est déterministe et
ScrapeGraphAI utilise exclusivement un modèle Ollama local. Aucun HTML brut ni
donnée candidat n’est écrit sur disque.

Exécution de référence, dans un environnement Python isolé :

```bash
SCRAPEGRAPHAI_TELEMETRY_ENABLED=false uv run --python 3.12 \
  --with scrapegraphai python experiments/scrapegraph/benchmark.py \
  --limit 20 --model qwen2.5:0.5b
```

Le pilote n’emploie ni l’API managée ScrapeGraphAI ni une API LLM payante.

## Compatibilité Python constatée le 21 octobre 2026

- Python 3.12 résout `scrapegraphai==2.3.1`, qui déclare
  `Requires-Python >=3.12,<4`; l’import `SmartScraperGraph` réussit avec
  `langchain-community==0.4.2` et `langchain-ollama==1.1.0`.
- Python 3.11 résout l’ancienne version `scrapegraphai==1.76.0`
  (`Requires-Python >=3.10,<4`). Son import échoue : son code importe
  `ChatOllama` depuis `langchain_community.chat_models`, alors que ce symbole
  n’est plus exporté par `langchain-community==0.4.2`. Les contraintes larges
  de 1.76.0 autorisent pourtant cette combinaison incompatible.

Le benchmark est donc volontairement fixé à Python 3.12. Il reste isolé via
`uv`; aucune dépendance Python n’est ajoutée au projet Next.js.
