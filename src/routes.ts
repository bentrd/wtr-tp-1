import { Router, type Express, type Request } from "express";
import { ErreurBoutique, type Boutique } from "./boutique.js";

function entierPositif(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isSafeInteger(valeur) && valeur > 0;
}

function lireId(valeur: string) {
  const id = Number(valeur);
  if (!/^\d+$/.test(valeur) || !entierPositif(id)) {
    throw new ErreurBoutique(400, "L'identifiant doit être un entier positif.");
  }
  return id;
}

function lireCorps(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
}

export function installerRoutes(app: Express, boutique: Boutique) {
  const api = Router();

  api.get("/users", (_req, res) => {
    res.json(boutique.users());
  });

  api.get("/products", (_req, res) => {
    res.json(boutique.products());
  });

  api.get("/orders", (_req, res) => {
    res.json(boutique.orders());
  });

  api.get("/orders/:id", (req, res) => {
    const commande = boutique.order(lireId(req.params.id));
    if (!commande) throw new ErreurBoutique(404, "Commande introuvable.");
    res.json(commande);
  });

  api.post("/orders", async (req, res) => {
    const { userId, productId, quantity } = lireCorps(req);
    if (!entierPositif(userId) || !entierPositif(productId) || !entierPositif(quantity)) {
      throw new ErreurBoutique(400, "userId, productId et quantity doivent être des entiers positifs.");
    }
    const commande = await boutique.creer({ userId, productId, quantity });
    res.status(201).location(`/orders/${commande.id}`).json(commande);
  });

  api.patch("/orders/:id/status", async (req, res) => {
    const id = lireId(req.params.id);
    const { status } = lireCorps(req);
    if (status !== "shipped" && status !== "delivered") {
      throw new ErreurBoutique(400, "Le statut attendu est shipped ou delivered.");
    }
    res.json(await boutique.changerStatut(id, status));
  });

  api.post("/orders/:id/cancel", async (req, res) => {
    res.json(await boutique.annuler(lireId(req.params.id)));
  });

  app.use(api);
}
