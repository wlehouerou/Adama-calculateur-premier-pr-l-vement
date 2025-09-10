import React, { useMemo, useState } from "react";
import "./styles.css";

/* =========================
   Helpers dates & formats
   ========================= */
function parseEuro(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s/g, "").replace(/,/g, ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function parseDMY(str) {
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
  const t = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(t / 12);
  const m = ((t % 12) + 12) % 12;
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

/* =========================
   RÈGLES MÉTIER
   ========================= */

/** ---------------- NEOLIANE ----------------
 *  - A date à date, jamais de prorata.
 *  - 1er passage basé sur la signature : ≤25 → M+1, >25 → M+2 (jamais avant le mois d’effet).
 *  - Si le 1er passage intervient après le début de plusieurs périodes depuis l’effet,
 *    on regroupe TOUS les mois entamés (montant = n × prime).
 *  - Frais Néoliane gérés séparément (30 € santé seule / 0 € si couplé).
 */
function computeNeoliane({ primeMensuelle, dateSignature, dateEffet, jourPrel, fraisNeoliane }) {
  const prime = parseEuro(primeMensuelle);
  const signature = dateSignature,
    effet = dateEffet;
  const alerts = [];
  if (!prime || !signature || !effet || !jourPrel) {
    return { ok: false, message: "Renseignez tous les champs.", alerts: [] };
  }

  // Mois cible du 1er passage : M+1 si signature ≤25, sinon M+2
  const monthsAfter = signature.getDate() <= 25 ? 1 : 2;
  let monthCandidate = new Date(signature.getFullYear(), signature.getMonth() + monthsAfter, 1);
  const effetMonthStart = new Date(effet.getFullYear(), effet.getMonth(), 1);
  if (monthCandidate < effetMonthStart) monthCandidate = effetMonthStart;

  const datePrelev = setDay(monthCandidate, jourPrel);

  // Compter le nombre de périodes date-à-date déjà démarrées à la date du 1er prélèvement
  // Période 0 démarre à la date d’effet (ex. effet 20 → périodes 20/08–19/09, 20/09–19/10…)
  const start0 = new Date(effet.getFullYear(), effet.getMonth(), effet.getDate());
  let count = 0;
  let cursor = new Date(start0);

  // Chaque démarrage de période <= datePrelev compte
  while (cursor <= datePrelev) {
    count += 1;
    cursor = addMonths(cursor, 1);
  }
  if (count < 1) count = 1; // sécurité

  const montant = prime * count;
  if (count >= 2) {
    alerts.push(
      `1er prélèvement regroupé : ${count} mois de cotisation, car plusieurs périodes ont démarré avant le premier passage.`
    );
  }

  const frais = parseEuro(fraisNeoliane) || 0;

  return {
    ok: true,
    compagnie: "Néoliane Santé",
    montant,
    cotisations: [{ label: count === 1 ? "1 mois" : `${count} mois`, montant }],
    datePrelev,
    remarques: [
      "Cotisations de date à date (pas de prorata).",
      `1er passage théorique en ${signature.getDate() <= 25 ? "M+1" : "M+2"} selon la date de signature (jamais avant le mois de l’effet).`,
      "Si le 1er passage intervient après le début de plusieurs périodes, le prélèvement regroupe tous les mois entamés depuis la date d’effet."
    ],
    fraisDossier: frais,
    alerts
  };
}

/** ---------------- KEREIS (Cegema) ----------------
 *  - A terme d’avance & de date à date.
 *  - Si effet = mois de souscription :
 *       1–15 → 1 mois ; 16–31 → 2 mois (quel que soit le jour choisi).
 *    Sinon → 1 mois.
 *  - 1er passage au jour choisi (5 / 12 / 24). Cas particuliers possibles (échéancier confirme).
 *  - Frais : 15 € inclus au 1er paiement.
 */
function computeKereis({ primeMensuelle, dateSignature, dateEffet, jourPrel }) {
  const prime = parseEuro(primeMensuelle);
  const signature = dateSignature,
    effet = dateEffet;
  const alerts = [];
  if (!prime || !signature || !effet || !jourPrel) {
    return { ok: false, message: "Renseignez tous les champs.", alerts: [] };
  }

  const sameMonth =
    signature.getFullYear() === effet.getFullYear() && signature.getMonth() === effet.getMonth();
  const nbMois = sameMonth ? (signature.getDate() <= 15 ? 1 : 2) : 1;

  // Date du 1er passage : au jour choisi, dans le mois d’effet si possible
  let datePrelev = setDay(new Date(effet.getFullYear(), effet.getMonth(), 1), jourPrel);
  // Si on est dans le même mois et que le jour choisi tombe avant la signature, il peut glisser au mois suivant
  if (sameMonth) {
    const tentative = setDay(new Date(effet.getFullYear(), effet.getMonth(), 1), jourPrel);
    if (tentative < signature) {
      datePrelev = setDay(new Date(effet.getFullYear(), effet.getMonth() + 1, 1), jourPrel);
      alerts.push(
        "Cas particulier : la date exacte du 1er passage peut être ajustée par la compagnie. L’échéancier confirmera."
      );
    }
  }

  return {
    ok: true,
    compagnie: "Kereis (Cegema)",
    montant: nbMois * prime,
    cotisations: [{ label: nbMois === 1 ? "1 mois" : `${nbMois} mois`, montant: nbMois * prime }],
    datePrelev,
    remarques: [
      "Règle si effet = mois de souscription : 1–15 → 1 mois ; 16–31 → 2 mois.",
      "Sinon : 1 mois, prélevé au jour choisi dans le mois d’effet.",
      "Jours possibles : 5 / 12 / 24."
    ],
    fraisDossierInclus: 15,
    alerts
  };
}

/** ---------------- APRIL (santé) ----------------
 *  - Effet au 1er : 1 mois complet.
 *  - Effet en cours de mois : prorata des jours restants.
 *  - Si le 1er prélèvement n’a pas pu se faire dans le mois d’effet :
 *      1er prélèvement = prorata (mois d’effet) + 1 mois complet (mois du prélèvement) + 20 € de frais (inclus).
 *  - Jour de prélèvement : 1 à 10.
 *  - Alerte délais courts & possibilité exceptionnelle de prélèvement fin de mois d’effet.
 */
function computeApril({ primeMensuelle, dateSignature, dateEffet, jourPrel }) {
  const prime = parseEuro(primeMensuelle);
  const signature = dateSignature,
    effet = dateEffet;
  const alerts = [];
  if (!prime || !signature || !effet || !jourPrel) {
    return { ok: false, message: "Renseignez tous les champs.", alerts: [] };
  }

  // Peut-on prélever dans le mois d'effet ?
  const firstInEffectMonth = jourPrel >= effet.getDate();
  const datePrelev = firstInEffectMonth
    ? setDay(new Date(effet.getFullYear(), effet.getMonth(), 1), jourPrel)
    : setDay(new Date(effet.getFullYear(), effet.getMonth() + 1, 1), jourPrel);

  // Prorata éventuel
  const eom = endOfMonth(effet);
  const daysInMonth = eom.getDate();
  const effetAuPremier = effet.getDate() === 1;
  const nbJoursProrata = effetAuPremier ? 0 : daysInMonth - effet.getDate() + 1;
  const montantProrata = effetAuPremier ? 0 : (prime * nbJoursProrata) / daysInMonth;

  const parts = [];
  let total = 0;

  if (firstInEffectMonth) {
    // 1er passage dans le mois d'effet
    if (effetAuPremier) {
      parts.push({ label: "1 mois complet", montant: prime });
      total += prime;
    } else {
      parts.push({ label: `Prorata (${nbJoursProrata} j)`, montant: montantProrata });
      total += montantProrata;
    }
  } else {
    // 1er passage au mois suivant → prorata + 1 mois plein
    if (!effetAuPremier) {
      parts.push({ label: `Prorata (${nbJoursProrata} j)`, montant: montantProrata });
      total += montantProrata;
    } else {
      parts.push({ label: "Mois d’effet (1 mois)", montant: prime });
      total += prime;
    }
    parts.push({ label: "1 mois complet (mois du 1er prélèvement)", montant: prime });
    total += prime;
  }

  // Frais 20 € inclus au 1er paiement
  const frais = 20;
  parts.push({ label: "Frais (inclus)", montant: frais });
  total += frais;

  // Alertes
  const joursEntre = daysBetween(signature, effet);
  if (joursEntre < 12) {
    alerts.push(
      "Délais courts entre signature et effet : fortes chances de décalage vers fin de mois d’effet ou début du mois suivant. L’échéancier (envoyé par la compagnie) fera foi."
    );
  }
  if (!firstInEffectMonth) {
    alerts.push(
      "Jour choisi antérieur à la date d’effet : April peut, de façon exceptionnelle, prélever le prorata en fin de mois d’effet. L’échéancier confirmera."
    );
  }

  return {
    ok: true,
    compagnie: "April (santé)",
    montant: total,
    cotisations: parts,
    datePrelev,
    remarques: [
      "Effet au 1er : 1 mois complet ; effet en cours de mois : prorata des jours restants.",
      "Jour de prélèvement : 1 à 10.",
      "Appel de cotisation envoyé ~15 jours avant l’effet (raccourci si <15 j)."
    ],
    alerts
  };
}

/* =========================
   UI Components
   ========================= */
function Card({ title, children }) {
  return (
    <div className="card">
      <div className="inner">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [compagnie, setCompagnie] = useState("neoliane");
  const [prime, setPrime] = useState("200");
  const [dateSignature, setDateSignature] = useState("");
  const [dateEffet, setDateEffet] = useState("");
  const [jourPrel, setJourPrel] = useState(5);
  const [fraisNeoliane, setFraisNeoliane] = useState("30");

  const dayOptions = useMemo(() => {
    if (compagnie === "neoliane") return [5, 10];
    if (compagnie === "kereis") return [5, 12, 24];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }, [compagnie]);

  const result = useMemo(() => {
    const sig = parseDMY(dateSignature);
    const eff = parseDMY(dateEffet);
    if (!sig || !eff) return { ok: false, message: "Saisissez les dates au format jj/mm/aaaa." };
    if (eff < sig)
      return { ok: false, message: "La date d’effet doit être postérieure à la date de signature." };

    const common = { primeMensuelle: prime, dateSignature: sig, dateEffet: eff, jourPrel };
    if (compagnie === "neoliane") return computeNeoliane({ ...common, fraisNeoliane });
    if (compagnie === "kereis") return computeKereis(common);
    return computeApril(common);
  }, [compagnie, prime, dateSignature, dateEffet, jourPrel, fraisNeoliane]);

  return (
    <div className="app">
      <div className="header">
        <div className="brand" />
        <h1>Adama · 1re cotisation & 1er prélèvement</h1>
      </div>
      <div className="sub">
        Appli pédagogique + calculateur. Les dates s’affichent en <b>jj/mm/aaaa</b>. L’échéancier
        officiel est <b>toujours envoyé par la compagnie par e-mail</b> avant la prise d’effet.
      </div>

      <div className="grid">
        {/* Paramètres */}
        <Card title="Paramètres">
          <div className="row">
            <label>
              Compagnie
              <select value={compagnie} onChange={(e) => setCompagnie(e.target.value)}>
                <option value="neoliane">Néoliane Santé</option>
                <option value="kereis">Kereis (Cegema)</option>
                <option value="april">April (santé)</option>
              </select>
            </label>

            <label>
              Prime mensuelle (€)
              <input
                value={prime}
                onChange={(e) => setPrime(e.target.value)}
                placeholder="ex. 150,00"
              />
            </label>

            <div className="row two">
              <label>
                Date de signature (jj/mm/aaaa)
                <input
                  value={dateSignature}
                  onChange={(e) => setDateSignature(e.target.value)}
                  placeholder="jj/mm/aaaa"
                />
              </label>
              <label>
                Date d’effet (jj/mm/aaaa)
                <input
                  value={dateEffet}
                  onChange={(e) => setDateEffet(e.target.value)}
                  placeholder="jj/mm/aaaa"
                />
              </label>
            </div>

            <div className="row two">
              <label>
                Jour de prélèvement
                <select value={jourPrel} onChange={(e) => setJourPrel(Number(e.target.value))}>
                  {dayOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>

              {compagnie === "neoliane" && (
                <label>
                  Frais Néoliane
                  <select
                    value={fraisNeoliane}
                    onChange={(e) => setFraisNeoliane(e.target.value)}
                  >
                    <option value="30">30 € (santé seule)</option>
                    <option value="0">0 € (couplé prévoyance)</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        </Card>

        {/* Résultat */}
        <Card title="Résultat">
          {!result.ok ? (
            <div className="meta">{result.message || "Complétez les champs."}</div>
          ) : (
            <>
              <div className="kpi">
                <span className="pill">{result.compagnie}</span>
                <span className="amount">{result.montant.toFixed(2)} €</span>
                <span className="pill">1er prélèvement</span>
                <span className="date">{fmt(result.datePrelev)}</span>
              </div>

              <div className="meta">Détail :</div>
              <ul className="list">
                {result.cotisations?.map((c, i) => (
                  <li key={i}>
                    {c.label} : {c.montant.toFixed(2)} €
                  </li>
                ))}
                {result.fraisDossier != null && result.fraisDossier > 0 && (
                  <li>Frais de dossier (prélevés séparément) : {result.fraisDossier.toFixed(2)} €</li>
                )}
                {result.fraisDossierInclus != null && (
                  <li>Frais {result.fraisDossierInclus.toFixed(2)} € inclus au 1er paiement</li>
                )}
              </ul>

              {result.remarques?.length > 0 && (
                <>
                  <div className="meta">À savoir :</div>
                  <ul className="list">
                    {result.remarques.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}

              {result.alerts?.length > 0 && (
                <div className="alert">
                  <b>⚠ Cas à confirmer :</b>
                  <ul className="list">
                    {result.alerts.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Mémo compagnies */}
      <div className="panels">
        <div className="panel nl">
          <h4>Néoliane Santé</h4>
          <ul>
            <li>1er prélèvement : 5 ou 10.</li>
            <li>Signature ≤25 → M+1 ; &gt;25 → M+2 (jamais avant le mois de l’effet).</li>
            <li>Pas de prorata : 1 mois plein (date à date).</li>
            <li>1er passage tardif → regroupement des mois déjà entamés.</li>
            <li>Frais 30 € séparés (~15) ; 0 € si couplé prévoyance.</li>
          </ul>
        </div>
        <div className="panel kr">
          <h4>Kereis (Cegema)</h4>
          <ul>
            <li>Jours possibles : 5 / 12 / 24.</li>
            <li>Si effet = mois de souscription : 1–15 → 1 mois ; 16–31 → 2 mois.</li>
            <li>Sinon : 1 mois, au jour choisi dans le mois d’effet.</li>
            <li>Cas rares : date exacte ajustée → échéancier.</li>
          </ul>
        </div>
        <div className="panel ap">
          <h4>April (santé)</h4>
          <ul>
            <li>Effet au 1er : 1 mois. Effet en cours : prorata.</li>
            <li>Si 1er passage au mois suivant : prorata + 1 mois plein + frais 20 € (inclus).</li>
            <li>Jour 1 à 10. Délais courts → possible décalage fin de mois d’effet / début mois suivant.</li>
            <li>Rare : prélèvement exceptionnel fin de mois d’effet (prorata).</li>
            <li>Appel de cotisation ~15 j avant l’effet (raccourci si &lt;15 j).</li>
          </ul>
        </div>
      </div>

      <div className="footer">V1 · Aligné couleurs Adama · Aucune donnée n’est stockée</div>
    </div>
  );
}
