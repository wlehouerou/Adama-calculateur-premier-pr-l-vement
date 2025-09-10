import React, { useMemo, useState } from "react";

/** ========= Helpers dates & formats ========= */
function parseEuro(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s/g, "").replace(/,/g, ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function parseDMY(str) {
  // attend jj/mm/aaaa
  if (!str) return null;
  const [d, m, y] = str.split("/").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmt(d) {
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}
function addMonths(date, n) {
  const d = new Date(date);
  const target = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const last = new Date(y, m + 1, 0).getDate();
  const day = Math.min(d.getDate(), last);
  return new Date(y, m, day);
}
function setDay(date, day) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}
function daysBetween(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / (24 * 3600 * 1000));
}

/** ========= Règles métier (version simplifiée, robuste) =========
 * — Les dates sont en jj/mm/aaaa côté UI.
 * — On calcule un résultat "théorique" + messages d'alerte si la compagnie
 *   est susceptible de décaler (cas "à confirmer").
 */

/** Néoliane
 * - 1er prélèvement le 5 OU le 10 (choix agent).
 * - 1re cotisation = toujours 1 mois plein (pas de prorata).
 * - Si signature ≤ 25 => 1er prélèvement en M+1 ; si >25 => en M+2.
 * - Si l’effet est très tard dans le mois, la compagnie peut décaler (à confirmer).
 * - Frais de dossier : 30 € si santé seule, 0 € si couplé prévoyance. Prélèvés séparément (souvent ~15).
 */
function computeNeoliane({
  primeMensuelle,
  dateSignature,
  dateEffet,
  jourPrel,
  fraisNeoliane // "30" ou "0"
}) {
  const prime = parseEuro(primeMensuelle);
  const signature = dateSignature;
  const effet = dateEffet;
  const alerts = [];

  if (!prime || !signature || !effet || !jourPrel) {
    return { ok: false, message: "Renseignez tous les champs.", alerts: [] };
  }

  // Mois du premier passage selon la signature (repère ~25)
  const baseMonth =
    signature.getDate() <= 25 ? addMonths(signature, 1) : addMonths(signature, 2);

  // Le 1er passage ne se fait jamais avant le mois de l’effet
  let month = baseMonth;
  const effetMonth = new Date(effet.getFullYear(), effet.getMonth(), 1);
  if (new Date(month.getFullYear(), month.getMonth(), 1) < effetMonth) {
    month = effet;
  }

  // Date théorique du 1er débit (5 ou 10 du mois retenu)
  let datePrelev = setDay(
    new Date(month.getFullYear(), month.getMonth(), 1),
    jourPrel
  );

  // Cas "effet très tardif" : alerte (la compagnie peut décaler)
  const eomEffet = endOfMonth(effet);
  const joursRestantsEffet = daysBetween(effet, eomEffet);
  if (joursRestantsEffet <= 3) {
    alerts.push(
      "Effet très tard dans le mois : Néoliane peut décaler le 1er prélèvement d’un mois. L’échéancier (envoyé par la compagnie) confirmera."
    );
  }

  // Montant = 1 mois plein
  const cotisations = [{ label: "1 mois", montant: prime }];

  return {
    ok: true,
    compagnie: "Néoliane Santé",
    montant: prime,
    cotisations,
    datePrelev,
    remarques: [
      "Cotisations de date à date (pas de prorata).",
      `1er passage théorique en ${signature.getDate() <= 25 ? "M+1" : "M+2"} selon la signature.`,
      "Frais de dossier prélevés séparément (souvent autour du 15)."
    ],
    fraisDossier: parseEuro(fraisNeoliane),
    alerts
  };
}

/** Kereis (Cegema)
 * - Jours possibles : 5 / 12 / 24.
 * - Si effet et souscription au même mois :
 *    * signature 1–15 → 1 mois
 *    * signature 16–31 → 2 mois
 *    Premier passage souvent le 24 (mais le jour sélectionné reste la référence ensuite).
 * - Si effet au mois suivant (ou plus tard) : 1 mois, prélevé le jour choisi dans le mois d’effet (à terme d’avance).
 * - Certains cas rares peuvent adapter la date exacte : à confirmer par l’échéancier de Kereis.
 */
function computeKereis({ primeMensuelle, dateSignature, dateEffet, jourPrel }) {
  const prime = parseEuro(primeMensuelle);
  const signature = dateSignature;
  const effet = dateEffet;
  const alerts = [];

  if (!prime || !signature || !effet || !jourPrel) {
    return { ok: false, message: "Renseignez tous les champs.", alerts: [] };
  }

  const sameMonth =
    signature.getFullYear() === effet.getFullYear() &&
    signature.getMonth() === effet.getMonth();

  let nbMois = 1;
  if (sameMonth) {
    nbMois = signature.getDate() <= 15 ? 1 : 2;
  } else {
    nbMois = 1;
  }

  // 1er passage
  let datePrelev;
  if (sameMonth) {
    // Dans la pratique, "souvent le 24" pour le tout premier passage
    // mais on affiche la date correspondant au jour choisi si elle tombe avant la fin du mois,
    // sinon on prend la prochaine occurrence (mois suivant).
    const tentative = setDay(
      new Date(effet.getFullYear(), effet.getMonth(), 1),
      jourPrel
    );
    if (tentative >= signature) {
      datePrelev = tentative;
    } else {
      datePrelev = setDay(
        new Date(effet.getFullYear(), effet.getMonth() + 1, 1),
        jourPrel
      );
      alerts.push(
        "Chez Kereis, le 1er passage est souvent le 24 quand effet et souscription sont le même mois. L’échéancier confirmera la date exacte."
      );
    }
  } else {
    // Effet mois suivant (ou plus tard) : 1er passage dans le mois d’effet au jour choisi
    datePrelev = setDay(
      new Date(effet.getFullYear(), effet.getMonth(), 1),
      jourPrel
    );
  }

  const cotisations = [{ label: `${nbMois} mois`, montant: nbMois * prime }];

  return {
    ok: true,
    compagnie: "Kereis (Cegema)",
    montant: nbMois * prime,
    cotisations,
    datePrelev,
    remarques: [
      "Règle : 1–15 → 1 mois ; 16–31 → 2 mois si effet le même mois.",
      "Sinon : 1 mois, prélevé au jour choisi dans le mois d’effet.",
      "Jours possibles : 5 / 12 / 24."
    ],
    fraisDossier: 15, // inclus dans le 1er paiement
    alerts
  };
}

/** April (santé)
 * - Effet au 1er : 1 mois complet.
 * - Effet en cours de mois : prorata des jours restants du mois.
 * - Jour de prélèvement : 1 à 10 (choisi).
 * - En délais "courts" (signature + effet rapprochés), April peut décaler
 *   vers fin de mois d’effet ou début du mois suivant, OU faire un prélèvement
 *   exceptionnel fin de mois d’effet (rare). L’échéancier fera foi.
 * - Appel de cotisation envoyé ~15 jours avant l’effet (raccourci si <15 jours).
 * - Frais 20 € inclus au 1er paiement.
 */
function computeApril({ primeMensuelle, dateSignature, dateEffet, jourPrel }) {
  const prime = parseEuro(primeMensuelle);
  const signature = dateSignature;
  const effet = dateEffet;
  const alerts = [];

  if (!prime || !signature || !effet || !jourPrel) {
    return { ok: false, message: "Renseignez tous les champs.", alerts: [] };
  }

  const eom = endOfMonth(effet);
  const joursRestants = daysBetween(effet, eom) + 1; // inclusif
  const effetAuPremier = effet.getDate() === 1;

  // Montant
  let montant;
  let cotisations = [];
  if (effetAuPremier) {
    montant = prime;
    cotisations.push({ label: "1 mois complet", montant: prime });
  } else {
    const nbJoursMois = eom.getDate();
    const prorata = (prime * joursRestants) / nbJoursMois;
    montant = prorata;
    cotisations.push({
      label: `Prorata (${joursRestants} j)`,
      montant: prorata
    });
  }

  // Date théorique : jour choisi (1–10) dans le mois d’effet
  let datePrelev = setDay(
    new Date(effet.getFullYear(), effet.getMonth(), 1),
    jourPrel
  );

  // Si le jour choisi est antérieur à la date d’effet, April peut :
  // - soit prélever en fin de mois d’effet (prorata) si possible (rare) ;
  // - soit décaler au mois suivant (avec la 2e cotisation).
  if (jourPrel < effet.getDate()) {
    alerts.push(
      "Jour choisi antérieur à la date d’effet : April peut effectuer un prélèvement exceptionnel fin de mois d’effet (rare) OU décaler au début du mois suivant. L’échéancier confirmera."
    );
  }

  // Délais courts (souscription et effet proches) → probabilité de décalage
  const joursEntre = daysBetween(signature, effet);
  if (joursEntre < 12) {
    alerts.push(
      "Délais courts entre signature et effet : fortes chances de décalage vers fin de mois d’effet ou début du mois suivant. L’échéancier (envoyé par la compagnie) fera foi."
    );
  }

  return {
    ok: true,
    compagnie: "April (santé)",
    montant,
    cotisations,
    datePrelev,
    remarques: [
      "Effet au 1er : 1 mois complet ; effet en cours de mois : prorata des jours restants.",
      "Jour de prélèvement : 1 à 10.",
      "Appel de cotisation envoyé ~15 jours avant l’effet (raccourci si <15 j).",
      "Frais 20 € inclus au 1er paiement."
    ],
    fraisDossierInclus: 20,
    alerts
  };
}

/** ========= Composants UI ========= */
function Card({ title, children }) {
  return (
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      padding: 16,
      background: "#fff",
      boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
    }}>
      {title && <h3 style={{ marginTop: 0, marginBottom: 12 }}>{title}</h3>}
      {children}
    </div>
  );
}

export default function App() {
  // États
  const [compagnie, setCompagnie] = useState("neoliane");
  const [prime, setPrime] = useState("100");
  const [dateSignature, setDateSignature] = useState("");
  const [dateEffet, setDateEffet] = useState("");
  const [jourPrel, setJourPrel] = useState(5);
  const [fraisNeoliane, setFraisNeoliane] = useState("30"); // "30" ou "0"

  // Options de jours selon compagnie
  const dayOptions = useMemo(() => {
    if (compagnie === "neoliane") return [5, 10];
    if (compagnie === "kereis") return [5, 12, 24];
    return [1,2,3,4,5,6,7,8,9,10]; // April
  }, [compagnie]);

  // Calcul
  const result = useMemo(() => {
    const sig = parseDMY(dateSignature);
    const eff = parseDMY(dateEffet);

    if (!sig || !eff) {
      return { ok: false, message: "Saisissez dates au format jj/mm/aaaa." };
    }

    if (eff < sig) {
      return { ok: false, message: "La date d’effet doit être postérieure à la date de signature." };
    }

    const common = {
      primeMensuelle: prime,
      dateSignature: sig,
      dateEffet: eff,
      jourPrel
    };

    if (compagnie === "neoliane") {
      return computeNeoliane({ ...common, fraisNeoliane });
    }
    if (compagnie === "kereis") {
      return computeKereis(common);
    }
    return computeApril(common);
  }, [compagnie, prime, dateSignature, dateEffet, jourPrel, fraisNeoliane]);

  // Styles simples
  const wrap = { maxWidth: 1100, margin: "24px auto", fontFamily: "system-ui, Arial, sans-serif", color: "#0f172a" };
  const h1 = { fontSize: 24, fontWeight: 800, marginBottom: 8 };
  const sub = { color: "#334155", marginBottom: 24 };

  return (
    <div style={wrap}>
      <h1 style={h1}>Adama · 1re cotisation & 1er prélèvement</h1>
      <div style={sub}>
        Appli pédagogique + calculateur. Les dates s’affichent en <b>jj/mm/aaaa</b>.  
        L’échéancier officiel est <b>toujours envoyé par la compagnie par e-mail</b> avant la prise d’effet.
      </div>

      {/* Paramètres + Résultat */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="Paramètres">
          <div style={{ display: "grid", gap: 12 }}>
            <label>Compagnie<br/>
              <select value={compagnie} onChange={e => setCompagnie(e.target.value)}>
                <option value="neoliane">Néoliane Santé</option>
                <option value="kereis">Kereis (Cegema)</option>
                <option value="april">April (santé)</option>
              </select>
            </label>

            <label>Prime mensuelle (€)<br/>
              <input value={prime} onChange={e => setPrime(e.target.value)} placeholder="ex: 150,00" />
            </label>

            <label>Date de signature (jj/mm/aaaa)<br/>
              <input value={dateSignature} onChange={e => setDateSignature(e.target.value)} placeholder="jj/mm/aaaa" />
            </label>

            <label>Date d’effet (jj/mm/aaaa)<br/>
              <input value={dateEffet} onChange={e => setDateEffet(e.target.value)} placeholder="jj/mm/aaaa" />
            </label>

            <label>Jour de prélèvement<br/>
              <select value={jourPrel} onChange={e => setJourPrel(Number(e.target.value))}>
                {dayOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>

            {compagnie === "neoliane" && (
              <label>Frais Néoliane<br/>
                <select value={fraisNeoliane} onChange={e => setFraisNeoliane(e.target.value)}>
                  <option value="30">30 € (santé seule)</option>
                  <option value="0">0 € (couplé prévoyance)</option>
                </select>
              </label>
            )}
          </div>
        </Card>

        <Card title="Résultat">
          {!result.ok ? (
            <div style={{ color: "#b91c1c" }}>{result.message || "Complétez les champs."}</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div><b>Compagnie :</b> {result.compagnie}</div>
              <div><b>Montant du 1er prélèvement :</b> {result.montant.toFixed(2)} €</div>
              <div><b>Date estimée du 1er prélèvement :</b> {fmt(result.datePrelev)}</div>

              <div>
                <b>Détail :</b>
                <ul>
                  {result.cotisations.map((c, i) => (
                    <li key={i}>{c.label} : {c.montant.toFixed(2)} €</li>
                  ))}
                  {result.fraisDossier != null && result.fraisDossier > 0 && (
                    <li>Frais de dossier (prélevés séparément) : {result.fraisDossier.toFixed(2)} €</li>
                  )}
                  {result.fraisDossierInclus && (
                    <li>Frais {result.fraisDossierInclus.toFixed(2)} € inclus au 1er paiement</li>
                  )}
                </ul>
              </div>

              {result.remarques?.length > 0 && (
                <div>
                  <b>À savoir :</b>
                  <ul>
                    {result.remarques.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {result.alerts?.length > 0 && (
                <div style={{ background: "#fff7ed", border: "1px solid #fdba74", padding: 12, borderRadius: 8 }}>
                  <b>⚠ Cas à confirmer :</b>
                  <ul>
                    {result.alerts.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Mémo règles */}
      <h3 style={{ marginTop: 24 }}>Comprendre en un clin d’œil</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Card>
          <b>Néoliane Santé</b>
          <ul>
            <li>1er prélèvement : 5 ou 10.</li>
            <li>Signature ≤25 → M+1 ; &gt;25 → M+2 (jamais avant le mois de l’effet).</li>
            <li>Jamais de prorata (1 mois plein).</li>
            <li>Frais 30 € (santé seule) séparés (~15) ; 0 € si couplé.</li>
          </ul>
        </Card>
        <Card>
          <b>Kereis (Cegema)</b>
          <ul>
            <li>Jours : 5 / 12 / 24.</li>
            <li>Si effet = mois de souscription : 1–15 → 1 mois ; 16–31 → 2 mois.</li>
            <li>Sinon : 1 mois, au jour choisi dans le mois d’effet.</li>
            <li>Cas rares : date exacte ajustée → échéancier Kereis.</li>
          </ul>
        </Card>
        <Card>
          <b>April (santé)</b>
          <ul>
            <li>Effet au 1er : 1 mois. Effet en cours : prorata jours restants.</li>
            <li>Jour 1 à 10. Délais courts → possible décalage fin de mois d’effet / début mois suivant.</li>
            <li>Rare : prélèvement exceptionnel fin de mois d’effet (prorata).</li>
            <li>Appel de cotisation ~15 j avant l’effet (raccourci si &lt;15 j). Frais 20 € inclus.</li>
          </ul>
        </Card>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: "#64748b" }}>
        V1 — L’échéancier officiel est **toujours envoyé par la compagnie** par e-mail avant la prise d’effet.
      </div>
    </div>
  );
}
