import { fileURLToPath } from "node:url";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { ouvrirBoutique } from "./boutique.js";
import { installerRoutes } from "./routes.js";
import { creerFlux } from "./sse.js";

const app = express();
const flux = creerFlux();
const fichier = process.env.WTR_DB_FILE ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const boutique = await ouvrirBoutique(fichier, flux.publier);

app.use(express.json());
app.use(express.static(fileURLToPath(new URL("../public/", import.meta.url))));
flux.installer(app, boutique);
installerRoutes(app, boutique);

const erreurHttp: ErrorRequestHandler = (erreur: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(erreur);
    return;
  }

  if (erreur instanceof SyntaxError && "status" in erreur && erreur.status === 400) {
    res.status(400).json({ error: "JSON invalide." });
    return;
  }
  if (erreur instanceof Error && "status" in erreur && typeof erreur.status === "number"
      && erreur.status >= 400 && erreur.status < 500) {
    res.status(erreur.status).json({ error: erreur.message });
    return;
  }

  console.error(erreur);
  res.status(500).json({ error: "Erreur interne." });
};
app.use(erreurHttp);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => console.log(`Boutique en ligne sur http://localhost:${port}`));
