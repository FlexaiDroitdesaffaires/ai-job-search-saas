# Pilote ScrapeGraphAI open source

Date : 21 octobre 2026. Aucun service ScrapeGraphAI managé, proxy payant ou API
LLM payante n’a été utilisé. Le test s’appuie sur un conteneur Ollama local et
`qwen2.5:0.5b`. La télémétrie ScrapeGraphAI est désactivée.

## Environnement et compatibilité

- Python 3.12.14, environnement éphémère `uv` ;
- `scrapegraphai==2.3.1`, qui exige Python `>=3.12,<4` ;
- `langchain-community==0.4.2`, `langchain-ollama==1.1.0`,
  `pydantic==2.14.1`, `playwright==1.64.0` ;
- Ollama local, modèle Q4 de 494 M paramètres (397,8 Mo) ;
- aucune dépendance ajoutée à Next.js ou au lockfile pnpm.

Le premier essai sous Python 3.11 résolvait `scrapegraphai==1.76.0`. Cette
version importe encore `ChatOllama` depuis
`langchain_community.chat_models`, symbole absent de
`langchain-community==0.4.2`. Ses contraintes déclarées autorisent pourtant
cette combinaison : l’échec est une incompatibilité de dépendances de cette
ancienne version, reproduite par traceback. Python 3.12 et la version 2.3.1
corrigent l’import.

## Échantillon et référence

Le banc d’essai sélectionne 20 URL Greenhouse issues de l’API AI Dev Jobs. Les
GET publics Greenhouse, documentés comme accessibles sans authentification,
servent de vérité terrain. Aucun contenu brut n’est conservé.

Référence déterministe observée avant l’essai LLM :

| Méthode | Pages | Succès | Exactitude champs | Médiane | Erreurs |
|---|---:|---:|---:|---:|---:|
| API Greenhouse officielle | 20 | 19 | 95,00 % | 202,5 ms | 1 offre déjà indisponible |
| HTML / JSON-LD | 20 | 19 | 23,75 % | 4,3 ms | 1 vérité terrain indisponible |

Quatre champs sont comparés : titre, entreprise, lieu et description. Le taux
API inclut l’URL devenue indisponible comme échec, d’où 95 %.

## Préflight ScrapeGraphAI 3.12

L’import et la construction du graphe réussissent. Le premier document a été
envoyé à Ollama avec une sortie bornée à 512 tokens. Le modèle local n’a généré
qu’environ `0,87 token/s`; après plus de huit minutes, il approchait seulement
la limite de la première réponse. Le processus Python consommait environ 168 Mo
au pic avant inférence et le conteneur Ollama environ 830 Mo, avec plus de dix
cœurs CPU mobilisés. Coût API externe : 0 USD.

Le run 20 pages a été arrêté explicitement : à ce débit, une seule génération
de 512 tokens approche 9,8 minutes et 20 pages dépasseraient 3 h 15, hors autres
nœuds du graphe. Il serait trompeur d’annoncer 20 extractions ScrapeGraphAI
réussies ; aucune extraction complète n’a été produite dans l’enveloppe locale
raisonnable.

## Décision

**NO-GO pour le pipeline d’ingestion.** Sur les sources disposant d’une API
officielle, celle-ci est plus exacte, bien plus rapide et moins complexe. Pour
les pages HTML, l’extracteur déterministe reste utile comme signal partiel mais
ne remplace pas une API structurée. ScrapeGraphAI ne sera pas ajouté au runtime
Next.js ni au pipeline de production.

Un nouveau pilote ne se justifierait qu’avec une machine locale accélérée ou un
modèle plus adapté, un budget de latence prédéfini et une source autorisée sans
API structurée. Toute API payante nécessiterait une autorisation séparée.

Script reproductible : [`experiments/scrapegraph/benchmark.py`](../experiments/scrapegraph/benchmark.py).
