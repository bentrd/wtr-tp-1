const numero = document.querySelector("#numero");
const connexion = document.querySelector("#connexion");
const fiche = document.querySelector("#fiche");
const titre = document.querySelector("#titre-commande");
const statut = document.querySelector("#statut-commande");
const quantite = document.querySelector("#quantite");
const date = document.querySelector("#date-commande");

const libelles = {
  preparing: "En préparation",
  shipped: "Expédiée",
  delivered: "Livrée",
  cancelled: "Annulée",
};
const formaterDate = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

const parametre = new URLSearchParams(location.search).get("order");
const id = Number(parametre);
let demande;
let source;

function afficher(commande) {
  titre.textContent = `Commande n° ${commande.id}`;
  statut.textContent = libelles[commande.status];
  statut.dataset.statut = commande.status;
  quantite.textContent = commande.quantity;
  date.dateTime = commande.createdAt;
  date.textContent = formaterDate.format(new Date(commande.createdAt));
  fiche.hidden = false;
}

function estTerminee(commande) {
  return commande.status === "delivered" || commande.status === "cancelled";
}

async function suivre(signal) {
  connexion.textContent = "Recherche de la commande…";

  try {
    const reponse = await fetch(`/orders/${id}`, { signal });
    if (reponse.status === 404) {
      connexion.textContent = "Commande introuvable.";
      return;
    }
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const commande = await reponse.json();
    if (signal.aborted) return;
    afficher(commande);

    if (estTerminee(commande)) {
      connexion.textContent = "Suivi terminé.";
      return;
    }

    // Le premier événement donne l'état courant, même si la commande a
    // changé entre le GET et l'ouverture du flux.
    const flux = new EventSource(`/orders/${id}/events`);
    source = flux;
    flux.onopen = () => {
      connexion.textContent = "Suivi en direct.";
    };
    flux.onerror = () => {
      connexion.textContent = flux.readyState === EventSource.CLOSED
        ? "Le flux de suivi est indisponible."
        : "Connexion interrompue. Reconnexion automatique…";
    };

    for (const type of ["order-created", "order-status", "order-cancelled"]) {
      flux.addEventListener(type, (evenement) => {
        const miseAJour = JSON.parse(evenement.data);
        afficher(miseAJour);
        if (estTerminee(miseAJour)) {
          flux.close();
          connexion.textContent = "Suivi terminé.";
        }
      });
    }
  } catch {
    if (!signal.aborted) connexion.textContent = "Impossible de charger la commande.";
  }
}

window.addEventListener("pageshow", () => {
  if (parametre === null) return;
  numero.value = parametre;
  if (!/^\d+$/.test(parametre) || !Number.isSafeInteger(id) || id < 1) {
    connexion.textContent = "Le numéro de commande doit être un entier positif.";
    return;
  }
  demande = new AbortController();
  void suivre(demande.signal);
});

window.addEventListener("pagehide", () => {
  demande?.abort();
  source?.close();
});
