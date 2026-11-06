import type { Express, Response } from "express";
import type { Boutique, BoutiqueEvent, Status } from "./boutique.js";

function terminal(statut: Status) {
  return statut === "delivered" || statut === "cancelled";
}

function ecrire(res: Response, evenement: BoutiqueEvent) {
  res.write(`id: ${evenement.id}\nevent: ${evenement.type}\ndata: ${JSON.stringify(evenement.data)}\n\n`);
}

export function creerFlux() {
  // null désigne le flux global. Un numéro désigne une seule commande.
  const abonnes = new Map<Response, number | null>();

  function ouvrir(res: Response, commandeId: number | null) {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 5000\n\n");
    abonnes.set(res, commandeId);
    res.on("close", () => abonnes.delete(res));
  }

  function fermer(res: Response) {
    abonnes.delete(res);
    res.end();
  }

  function publier(evenement: BoutiqueEvent) {
    for (const [res, commandeId] of abonnes) {
      if (commandeId === null) {
        ecrire(res, evenement);
      } else if (evenement.type !== "stock-updated" && evenement.data.id === commandeId) {
        ecrire(res, evenement);
        if (terminal(evenement.data.status)) fermer(res);
      }
    }
  }

  const heartbeat = setInterval(() => {
    for (const res of abonnes.keys()) res.write(": heartbeat\n\n");
  }, 10_000);
  heartbeat.unref();

  function installer(app: Express, boutique: Boutique) {
    app.get("/events", (req, res) => {
      const brut = req.get("Last-Event-ID");
      const dernierId = lireCurseur(brut, boutique.events());
      if (dernierId === null) {
        res.status(400).json({ error: "Last-Event-ID invalide." });
        return;
      }
      ouvrir(res, null);
      if (dernierId !== undefined) {
        for (const evenement of boutique.events()) {
          if (evenement.id > dernierId) ecrire(res, evenement);
        }
      }
    });

    app.get("/orders/:id/events", (req, res) => {
      const commandeId = Number(req.params.id);
      if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(commandeId) || commandeId < 1) {
        res.status(400).json({ error: "Identifiant de commande invalide." });
        return;
      }
      const commande = boutique.order(commandeId);
      if (!commande) {
        res.status(404).json({ error: "Commande introuvable." });
        return;
      }

      const journal = boutique.events();
      const dernierId = lireCurseur(req.get("Last-Event-ID"), journal);
      if (dernierId === null) {
        res.status(400).json({ error: "Last-Event-ID invalide." });
        return;
      }

      const historique = journal.filter((event) =>
        event.type !== "stock-updated" && event.data.id === commandeId);
      // Première ouverture : état actuel. Reconnexion : événements manqués uniquement.
      const reprise = dernierId === undefined
        ? historique.slice(-1)
        : historique.filter((event) => event.id > dernierId);

      if (terminal(commande.status) && reprise.length === 0) {
        res.status(204).end();
        return;
      }

      // Lecture du journal et abonnement sont synchrones pour éviter tout événement perdu.
      ouvrir(res, commandeId);
      for (const evenement of reprise) ecrire(res, evenement);
      if (terminal(commande.status)) fermer(res);
    });
  }

  return { installer, publier };
}

function lireCurseur(brut: string | undefined, journal: readonly BoutiqueEvent[]) {
  if (brut === undefined || brut === "") return undefined;
  const id = Number(brut);
  if (!/^\d+$/.test(brut) || !Number.isSafeInteger(id) || id > (journal.at(-1)?.id ?? 0)) return null;
  return id;
}
