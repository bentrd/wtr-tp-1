import { Config, JsonDB } from "node-json-db";

export type User = {
  id: number;
  name: string;
  username: string;
  email: string;
};

export type Product = {
  id: number;
  name: string;
  stock: number;
};

export type Status = "preparing" | "shipped" | "delivered" | "cancelled";

export type Order = {
  id: number;
  userId: User["id"];
  productId: Product["id"];
  quantity: number;
  status: Status;
  createdAt: string;
};

type DonneesEvenement =
  | { type: "order-created" | "order-status" | "order-cancelled"; data: Order }
  | { type: "stock-updated"; data: Product };

export type BoutiqueEvent = DonneesEvenement & { id: number };

type Etat = {
  users: User[];
  products: Product[];
  orders: Order[];
  deliveryDeadlines: Record<number, number>;
  events: BoutiqueEvent[];
};

type NouvelleCommande = Pick<Order, "userId" | "productId" | "quantity">;

export class ErreurBoutique extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

const DELAI_LIVRAISON = 20_000;

export async function ouvrirBoutique(fichier: string, publier: (event: BoutiqueEvent) => void) {
  const db = new JsonDB(new Config(fichier, true, true));
  let etat = await db.getObject<Etat>("/");
  const minuteurs = new Map<number, NodeJS.Timeout>();
  let file = Promise.resolve();

  // Le contrôle du stock et l'écriture passent dans la même file.
  function serialiser<T>(operation: () => Promise<T>): Promise<T> {
    const resultat = file.then(operation);
    file = resultat.then(() => {}, () => {});
    return resultat;
  }

  async function enregistrer(prochainEtat: Etat, ...evenements: DonneesEvenement[]) {
    const dernierId = etat.events[etat.events.length - 1]?.id ?? 0;
    const ajouts = evenements.map((event, index) => ({ ...event, id: dernierId + index + 1 }));
    const nouveau = { ...prochainEtat, events: [...etat.events, ...ajouts] };
    await db.push("/", nouveau);
    etat = nouveau;
    for (const event of ajouts) publier(event);
  }

  function order(id: number) {
    return etat.orders.find((commande) => commande.id === id);
  }

  function commandeExistante(id: number) {
    const commande = order(id);
    if (!commande) throw new ErreurBoutique(404, "Commande introuvable.");
    return commande;
  }

  function remplacerProduit(produit: Product) {
    return etat.products.map((element) => element.id === produit.id ? produit : element);
  }

  function remplacerCommande(commande: Order) {
    return etat.orders.map((element) => element.id === commande.id ? commande : element);
  }

  function planifierLivraison(id: number, echeance: number) {
    const minuteur = setTimeout(() => {
      minuteurs.delete(id);
      void serialiser(async () => {
        const commande = order(id);
        if (commande?.status === "shipped") await avancer(commande, "delivered");
      }).catch((erreur: unknown) => {
        console.error("Livraison automatique impossible", erreur);
        planifierLivraison(id, Date.now() + 1_000);
      });
    }, Math.max(0, echeance - Date.now()));
    minuteur.unref();
    minuteurs.set(id, minuteur);
  }

  async function avancer(commande: Order, status: "shipped" | "delivered") {
    const suivante = { ...commande, status };
    const deliveryDeadlines = { ...etat.deliveryDeadlines };
    if (status === "shipped") {
      deliveryDeadlines[commande.id] = Date.now() + DELAI_LIVRAISON;
    } else {
      delete deliveryDeadlines[commande.id];
    }

    await enregistrer(
      { ...etat, orders: remplacerCommande(suivante), deliveryDeadlines },
      { type: "order-status", data: suivante },
    );

    if (status === "shipped") {
      planifierLivraison(commande.id, deliveryDeadlines[commande.id]);
    } else {
      clearTimeout(minuteurs.get(commande.id));
      minuteurs.delete(commande.id);
    }

    return suivante;
  }

  // L'échéance reste la même après un redémarrage.
  for (const commande of etat.orders) {
    if (commande.status !== "shipped") continue;
    const echeance = etat.deliveryDeadlines[commande.id];
    if (echeance <= Date.now()) {
      await serialiser(() => avancer(commande, "delivered"));
    } else {
      planifierLivraison(commande.id, echeance);
    }
  }

  return {
    users: () => etat.users,
    products: () => etat.products,
    orders: () => etat.orders,
    events: () => etat.events,
    order,

    creer: (champs: NouvelleCommande) => serialiser(async () => {
      if (!etat.users.some((user) => user.id === champs.userId)) {
        throw new ErreurBoutique(404, "Utilisateur introuvable.");
      }
      const produit = etat.products.find((element) => element.id === champs.productId);
      if (!produit) throw new ErreurBoutique(404, "Produit introuvable.");
      if (produit.stock < champs.quantity) throw new ErreurBoutique(409, "Stock insuffisant.");

      const commande: Order = {
        id: etat.orders.length + 1,
        ...champs,
        status: "preparing",
        createdAt: new Date().toISOString(),
      };
      const produitModifie = { ...produit, stock: produit.stock - commande.quantity };
      await enregistrer(
        { ...etat, orders: [...etat.orders, commande], products: remplacerProduit(produitModifie) },
        { type: "order-created", data: commande },
        { type: "stock-updated", data: produitModifie },
      );
      return commande;
    }),

    changerStatut: (id: number, status: "shipped" | "delivered") => serialiser(async () => {
      const commande = commandeExistante(id);
      const statutAttendu = status === "shipped" ? "preparing" : "shipped";
      if (commande.status !== statutAttendu) {
        throw new ErreurBoutique(409, "Transition de statut impossible.");
      }
      return avancer(commande, status);
    }),

    annuler: (id: number) => serialiser(async () => {
      const commande = commandeExistante(id);
      if (commande.status !== "preparing") {
        throw new ErreurBoutique(409, "Seule une commande en préparation peut être annulée.");
      }
      const produit = etat.products.find((element) => element.id === commande.productId);
      if (!produit) throw new ErreurBoutique(404, "Produit introuvable.");

      const annulee: Order = { ...commande, status: "cancelled" };
      const produitModifie = { ...produit, stock: produit.stock + commande.quantity };
      await enregistrer(
        { ...etat, orders: remplacerCommande(annulee), products: remplacerProduit(produitModifie) },
        { type: "order-cancelled", data: annulee },
        { type: "stock-updated", data: produitModifie },
      );
      return annulee;
    }),
  };
}

export type Boutique = Awaited<ReturnType<typeof ouvrirBoutique>>;
