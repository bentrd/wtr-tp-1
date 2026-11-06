# TP1 Web temps réel

Benjamin Tordjman — 5IWB-A  
https://github.com/bentrd/wtr-tp-1

## Lancer

```sh
docker compose up --build -d
```

[localhost:3000](http://localhost:3000) · Suivi d’une commande avec `/?order=1`.
Les données JsonDB sont conservées dans un volume Docker.

## Routes

Corps en JSON, identifiants et quantités entiers positifs.

| Méthode | Route | Utilisation |
| --- | --- | --- |
| GET | `/users` | Liste des clients |
| GET | `/products` | Produits et stocks |
| GET | `/orders` | Liste des commandes |
| GET | `/orders/:id` | Une commande |
| POST | `/orders` | Créer avec `{"userId":1,"productId":1,"quantity":2}` |
| PATCH | `/orders/:id/status` | Avancer avec `{"status":"shipped"}` puis `{"status":"delivered"}` |
| POST | `/orders/:id/cancel` | Annuler une commande en préparation |
| GET | `/events` | SSE global, commandes et stocks |
| GET | `/orders/:id/events` | SSE limité à la commande |

Succès `200`, création `201`. Erreurs JSON `400` (requête invalide), `404` (introuvable), `409` (stock ou transition refusée).
La livraison est automatique 20 secondes après l’expédition.

## Avancement

F1 à F10 et B1 à B4 terminés. Les bonus couvrent la reprise avec `Last-Event-ID`, la fermeture du suivi terminé, la reconnexion à 5 secondes et un heartbeat toutes les 10 secondes. Le flux terminé renvoie `204` si tous ses événements ont déjà été reçus.
