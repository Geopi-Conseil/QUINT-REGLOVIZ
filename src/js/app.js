/* =========================================================================
   Mes obligations face au risque inondation - Quint-Fonsegrives
   Application carte (Leaflet). Aucune dépendance de build : fichier chargé
   tel quel par index.html.

   Vue d'ensemble du fichier :
   1. Configuration & constantes
   2. Initialisation de la carte et des couches
   3. Chargement des données (GeoJSON)
   4. Sélection d'un bâtiment / rendu du panneau d'information
   4bis. Correction déclarative du bâtiment (par le visiteur)
   5. Recherche d'adresse (API Adresse - BAN) et géolocalisation
   6. Légende et bascule des couches
   7. Tableau de bord communal (élus, techniciens)
   ========================================================================= */

(() => {
  "use strict";

  /* ----------------------------------------------------------------------
   * 1. Configuration
   * -------------------------------------------------------------------- */

  const CONFIG = {
    // Centre approximatif de la commune et niveau de zoom initial
    center: [43.5813, 1.5429],
    zoom: 15,
    minZoom: 12,
    maxZoom: 19,
    // Code INSEE de la commune, utilisé pour restreindre la recherche d'adresse
    codeInsee: "31445",
    dataUrls: {
      zonage: "data/zonage_pprin.geojson",
      batimentsZone: "data/batiments_ppri.geojson",
      batimentsHorsZone: "data/batiments_hors_zone.geojson",
      erp: "data/erp.geojson",
      hauteurEau: "data/hauteur_eau.geojson",
    },
    // Doit rester cohérent avec les couleurs utilisées lors de l'export
    // (voir docs/METHODOLOGIE.md et scripts/export_geojson.py)
    zoneOrder: ["Bi", "Ji", "Ri", "GHi", "Pi"],
    zoneShortNames: {
      Bi: "Bleue",
      Ji: "Jaune",
      Ri: "Rouge",
      GHi: "Grise hachurée",
      Pi: "Pourpre",
    },
  };

  /* ----------------------------------------------------------------------
   * 2. Carte
   * -------------------------------------------------------------------- */

  const map = L.map("map", {
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    zoomControl: false,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  const layers = {
    zonage: L.layerGroup(),
    horsZone: L.layerGroup(),
    batiments: L.layerGroup(),
    erp: L.layerGroup(),
    hauteurEau: L.layerGroup(),
  };
  layers.zonage.addTo(map);
  layers.batiments.addTo(map);
  layers.erp.addTo(map);
  // Les bâtiments hors zone sont masqués par défaut : ce sont 5400+ polygones
  // qui n'apportent pas d'information tant qu'on n'a pas cliqué dessus ; les
  // afficher par défaut alourdirait la carte pour un intérêt limité.
  // L'utilisateur peut les activer depuis la légende.
  // La hauteur d'eau estimée est également masquée par défaut : elle double
  // visuellement le fond de zonage (déjà coloré par aléa) ; l'utilisateur
  // l'active depuis la légende s'il veut voir la lame d'eau continue plutôt
  // que la valeur ponctuelle par bâtiment (affichée dans le panneau).

  let selectedLayer = null;
  const defaultStyleCache = new WeakMap();

  /* ----------------------------------------------------------------------
   * 3. Chargement des données
   * -------------------------------------------------------------------- */

  async function loadJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Échec du chargement de ${url} (${res.status})`);
    return res.json();
  }

  function styleZonage(feature) {
    return {
      color: feature.properties.zoneColor,
      weight: 1,
      fillColor: feature.properties.zoneColor,
      fillOpacity: 0.28,
    };
  }

  // Tous les bâtiments (en zone réglementée ou non) sont affichés dans une
  // même couleur neutre (gris foncé) : la couleur de zone reste portée par
  // le fond réglementaire (styleZonage) et la légende, ce qui évite une
  // carte où chaque bâtiment redouble déjà la couleur du fond sous lui.
  const BUILDING_FILL = "#4a4f57";
  const BUILDING_STROKE = "#2c3036";

  function styleBatiment() {
    return {
      color: BUILDING_STROKE,
      weight: 1,
      fillColor: BUILDING_FILL,
      fillOpacity: 0.75,
    };
  }

  function styleHorsZone() {
    return {
      color: BUILDING_STROKE,
      weight: 0.5,
      fillColor: BUILDING_FILL,
      fillOpacity: 0.35,
    };
  }

  // Couche de hauteur d'eau estimée (TIN des cotes de crue - MNT sol LiDAR
  // HD), par classe de hauteur plutôt qu'en continu : voir
  // docs/METHODOLOGIE.md pour le détail du calcul. feature.properties.classeColor
  // porte déjà la couleur, comme feature.properties.zoneColor pour le zonage.
  function styleHauteurEau(feature) {
    return {
      color: feature.properties.classeColor,
      weight: 0,
      fillColor: feature.properties.classeColor,
      fillOpacity: 0.55,
    };
  }

  function highlightStyle() {
    return { color: "#111418", weight: 3, fillOpacity: 0.9 };
  }

  function onEachBatiment(feature, layer) {
    // Copie (et non simple référence) : Leaflet mute layer.options en place
    // à chaque setStyle(), donc garder une référence ferait pointer le
    // « style d'origine » vers le dernier style appliqué au lieu du vrai
    // style de départ, empêchant toute restauration correcte (sélection
    // d'un bâtiment comme filtres du tableau de bord, §7).
    defaultStyleCache.set(layer, { ...layer.options });
    layer.on("click", () => selectBuilding(layer, feature));
    layer.on("keypress", (e) => {
      if (e.originalEvent && (e.originalEvent.key === "Enter" || e.originalEvent.key === " ")) {
        selectBuilding(layer, feature);
      }
    });
  }

  // À faible zoom, les bâtiments (petits polygones) sont difficiles à
  // atteindre précisément au clic : un clic dans une zone qui ne touche
  // aucun bâtiment retombe sur le polygone de zonage. On affiche alors une
  // réponse minimale (zone + invitation à zoomer) plutôt que de ne rien
  // faire, ce qui serait déroutant pour l'utilisateur.
  function onEachZonage(feature, layer) {
    layer.on("click", (e) => {
      clearSelection();
      renderZoneFallbackPanel(feature.properties);
      setPanelExpanded(true);
      if (window.innerWidth < 860) {
        map.flyTo(e.latlng, Math.max(map.getZoom() + 2, 17), { duration: 0.5 });
      } else {
        map.setView(e.latlng, Math.max(map.getZoom() + 2, 17));
      }
    });
  }

  function renderZoneFallbackPanel(p) {
    panelCloseBtn.hidden = false;
    panelZoneDot.style.background = p.zoneColor;
    panelTitle.textContent = CONFIG.zoneShortNames[p.zoneCode]
      ? `Zone ${CONFIG.zoneShortNames[p.zoneCode]}`
      : "Zone réglementée";
    panelSubtitle.textContent = p.zoneLabel || "";
    panelBody.innerHTML = `
      <div class="intro-block">
        ${badge(CONFIG.zoneShortNames[p.zoneCode] || p.zoneCode, p.zoneColor)}
        <p>Ce point se trouve dans une zone réglementée par le PPRi. La carte
        vient de zoomer : cliquez maintenant directement sur le contour de
        votre bâtiment pour afficher ses obligations précises.</p>
      </div>
    `;
  }

  function onEachErp(feature, latlng) {
    const color = feature.properties.zoneColor || "#9E9E9E";
    const marker = L.circleMarker(latlng, {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95,
      className: "erp-marker",
    });
    marker.bindPopup(renderErpPopup(feature.properties), { maxWidth: 280 });
    // Nécessaire pour que le tableau de bord (§7) puisse restaurer le style
    // d'origine d'un marqueur ERP après un filtre (voir onEachBatiment, qui
    // fait de même pour les bâtiments dès leur création ; copie superficielle
    // pour la même raison : setStyle() mute marker.options en place).
    defaultStyleCache.set(marker, { ...marker.options });
    return marker;
  }

  function renderErpPopup(p) {
    const zone = p.zoneCode
      ? `en zone <strong>${escapeHtml(CONFIG.zoneShortNames[p.zoneCode] || p.zoneCode)}</strong>`
      : "hors zonage réglementaire";
    return `
      <strong>${escapeHtml(p.nom || "Établissement")}</strong><br>
      ${p.activite ? escapeHtml(p.activite) + "<br>" : ""}
      ${p.adresse ? `<span class="text-muted">${escapeHtml(p.adresse)}</span><br>` : ""}
      <span>Situé ${zone} du PPRi inondation.</span>
      ${
        p.classeVulnerabilite
          ? `<br><span class="text-muted">Sensibilité : ${escapeHtml(p.classeVulnerabilite)}</span>`
          : ""
      }
      <br><a href="glossaire.html" target="_blank" rel="noopener">Comprendre les obligations ERP</a>
    `;
  }

  async function init() {
    try {
      const [zonage, batZone, batHors, erp, hauteurEau] = await Promise.all([
        loadJSON(CONFIG.dataUrls.zonage),
        loadJSON(CONFIG.dataUrls.batimentsZone),
        loadJSON(CONFIG.dataUrls.batimentsHorsZone),
        loadJSON(CONFIG.dataUrls.erp),
        loadJSON(CONFIG.dataUrls.hauteurEau),
      ]);

      L.geoJSON(zonage, { style: styleZonage, onEachFeature: onEachZonage }).addTo(layers.zonage);

      L.geoJSON(batHors, {
        style: styleHorsZone,
        onEachFeature: onEachBatiment,
      }).addTo(layers.horsZone);

      L.geoJSON(batZone, {
        style: styleBatiment,
        onEachFeature: onEachBatiment,
      }).addTo(layers.batiments);

      L.geoJSON(erp, { pointToLayer: onEachErp }).addTo(layers.erp);

      L.geoJSON(hauteurEau, { style: styleHauteurEau }).addTo(layers.hauteurEau);

      window.__appData = { zonage, batZone, batHors, erp, hauteurEau };
      document.dispatchEvent(new CustomEvent("app:data-ready"));
    } catch (err) {
      console.error(err);
      showFatalError(
        "Les données cartographiques n'ont pas pu être chargées. " +
          "Vérifiez votre connexion puis rechargez la page."
      );
    }
  }

  function showFatalError(message) {
    const body = document.getElementById("panel-body");
    body.innerHTML = `<div class="notice">${escapeHtml(message)}</div>`;
    setPanelExpanded(true);
  }

  /* ----------------------------------------------------------------------
   * 4. Sélection d'un bâtiment & panneau d'information
   * -------------------------------------------------------------------- */

  const panel = document.getElementById("info-panel");
  const panelBody = document.getElementById("panel-body");
  const panelTitle = document.getElementById("panel-title");
  const panelSubtitle = document.getElementById("panel-subtitle");
  const panelZoneDot = document.getElementById("panel-zone-dot");
  const panelHandleBtn = document.getElementById("panel-handle");
  const panelCloseBtn = document.getElementById("panel-close");

  function setPanelExpanded(expanded) {
    panel.classList.toggle("expanded", expanded);
    panelHandleBtn.setAttribute("aria-expanded", String(expanded));
  }

  panelHandleBtn.addEventListener("click", () => {
    setPanelExpanded(!panel.classList.contains("expanded"));
  });

  panelCloseBtn.addEventListener("click", () => {
    clearSelection();
    showWelcomePanel();
  });

  function clearSelection() {
    if (selectedLayer) {
      const original = defaultStyleCache.get(selectedLayer);
      if (original) selectedLayer.setStyle(original);
      selectedLayer = null;
    }
  }

  function selectBuilding(layer, feature) {
    clearSelection();
    selectedLayer = layer;
    layer.setStyle(highlightStyle());
    if (layer.bringToFront) layer.bringToFront();

    // Centroïde du bâtiment (coordonnées affichées dans les détails
    // techniques) : calculé une fois ici, réutilisé par renderBuildingPanel
    // et par ses ré-appels depuis le bloc de correction (même référence
    // `feature.properties`).
    let bounds = null;
    if (layer.getBounds) {
      bounds = layer.getBounds();
      const c = bounds.getCenter();
      feature.properties.__centroid = { lat: c.lat, lng: c.lng };
    }

    renderBuildingPanel(feature.properties);
    setPanelExpanded(true);

    // Sur mobile, on centre la carte un peu au-dessus du panneau pour que
    // le bâtiment reste visible pendant que le panneau occupe le bas d'écran.
    if (bounds && window.innerWidth < 860) {
      map.flyTo(bounds.getCenter(), Math.max(map.getZoom(), 17), { duration: 0.5 });
    } else if (bounds) {
      map.panTo(bounds.getCenter());
    }
  }

  // Certains champs numériques de l'export GeoJSON portent la chaîne
  // littérale "NULL" plutôt qu'une valeur JSON null (voir
  // scripts/export_geojson.py) : ce garde-fou évite d'afficher "NULL" tel
  // quel dans le panneau (ex. nombre de logements, hauteur inconnus).
  function hasValue(v) {
    return v !== null && v !== undefined && v !== "" && v !== "NULL";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badge(text, color) {
    return `<span class="badge" style="background:${color}">${escapeHtml(text)}</span>`;
  }

  /* ----------------------------------------------------------------------
   * 4bis. Correction déclarative du bâtiment (par le visiteur)
   * ----------------------------------------------------------------------
   * Les données publiques (BD TOPO, BDNB) se trompent parfois à l'échelle
   * d'un bâtiment précis (voir docs/METHODOLOGIE.md §3, §8). Un visiteur
   * qui connaît le bâtiment peut préciser deux points ici : la présence
   * d'un étage, et le type d'occupation (avec le nombre de logements).
   * L'outil recalcule alors la zone refuge, le diagnostic de vulnérabilité,
   * les obligations liées à la typologie et l'éligibilité FPRNM avec les
   * mêmes règles et les mêmes textes que ceux appliqués côté données
   * (docs/METHODOLOGIE.md §4 et §6) - seule la source change.
   *
   * La correction reste strictement locale (stockage du navigateur,
   * localStorage) : jamais envoyée, jamais partagée avec les autres
   * visiteurs, et sans valeur réglementaire (rappelé dans le panneau).
   * -------------------------------------------------------------------- */

  const OVERRIDES_KEY = "reglo-risques:corrections-batiments:v1";

  function loadOverrides() {
    try {
      return JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function getOverride(id) {
    if (!id) return null;
    return loadOverrides()[id] || null;
  }

  function saveOverride(id, data) {
    if (!id) return;
    try {
      const all = loadOverrides();
      all[id] = { ...data, updatedAt: new Date().toISOString() };
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
    } catch (e) {
      // Stockage indisponible (navigation privée, quota...) : la correction
      // s'applique quand même pour l'affichage courant, sans persister.
    }
  }

  function clearOverride(id) {
    if (!id) return;
    try {
      const all = loadOverrides();
      delete all[id];
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
    } catch (e) {
      /* voir saveOverride */
    }
  }

  // Textes repris tels quels de docs/METHODOLOGIE.md (§4, §6), identiques à
  // ceux déjà utilisés côté données pour les bâtiments classés BD TOPO/BDNB,
  // afin qu'une correction du visiteur affiche exactement le même libellé
  // qu'un bâtiment nativement classé dans la même catégorie.
  const CORRECTION_TEXTS = {
    obligationsHabitation:
      "Habitation : extension/changement de destination admis sous reserve " +
      "(plancher a PHE+20cm, mesures de mitigation) ; reconstruction apres " +
      "destruction par une crue INTERDITE.",
    obligationsActivite:
      "Local d'activite : si ERP 1a3 categorie / etablissement sensible ou " +
      "strategique, creation et reconstruction INTERDITES (sauf derogation " +
      "tres encadree). Sinon extension/changement de destination admis a 20% " +
      "sous conditions (PHE+20cm, diagnostic, mitigation).",
    diagnosticHabitation: "Auto-diagnostic de vulnerabilite (facultatif, a la charge du proprietaire).",
    diagnosticActivite:
      "OBLIGATOIRE si ERP 1a3 categorie, etablissement strategique/sensible, " +
      "ou activite de plus de 20 salaries (a verifier sur site, non " +
      "deductible de la BD TOPO) ; sinon auto-diagnostic recommande.",
    diagnosticAnnexe: "Non concerne (annexe).",
    eligibiliteHabitation:
      "Éligible - habitation : Fonds Barnier (FPRNM) à 80% des travaux de " +
      "prévention prescrits par le PPRi, plafond 36 000 €/bien, sous réserve " +
      "d'un bien existant avant l'approbation du PPRi (18/04/2016).",
    eligibiliteActivite:
      "Potentiellement éligible - activité : Fonds Barnier (FPRNM) à 20% des " +
      "travaux prescrits par le PPRi si moins de 20 salariés (à vérifier), " +
      "sous réserve d'un bien existant avant l'approbation du PPRi.",
    eligibiliteIndeterminee: "Non déterminé - typologie non éligible en l'état ou à qualifier sur site.",
  };

  // Applique une correction déclarative (si elle existe) aux propriétés du
  // bâtiment et recalcule les champs dérivés concernés. Ne modifie jamais
  // l'objet `p` d'origine (issu du GeoJSON) : retourne une copie, ou `p`
  // lui-même si aucune correction n'est active.
  function applyOverride(p, override) {
    if (!override || (!override.etagePresent && !override.typologieCategorie)) return p;

    const eff = { ...p, overridden: true };

    if (override.etagePresent === "Oui" || override.etagePresent === "Non") {
      eff.etagePresent = override.etagePresent;
      eff.etageSource = "déclaré par vous";
    }

    let nbLogements = null;
    const T = CORRECTION_TEXTS;
    if (override.typologieCategorie === "individuelle") {
      eff.typologie = "Maison individuelle";
      eff.typologieSource = "déclaré par vous";
      eff.obligationsTypologie = T.obligationsHabitation;
      eff.diagnostic = T.diagnosticHabitation;
      eff.eligibiliteFprnm = T.eligibiliteHabitation;
      nbLogements = 1;
    } else if (override.typologieCategorie === "collectif") {
      nbLogements = Math.max(2, parseInt(override.nbLogements, 10) || 2);
      eff.typologie = `Logement collectif (${nbLogements} logements)`;
      eff.typologieSource = "déclaré par vous";
      eff.obligationsTypologie = T.obligationsHabitation;
      eff.diagnostic = T.diagnosticHabitation;
      eff.eligibiliteFprnm = T.eligibiliteHabitation;
    } else if (override.typologieCategorie === "activite") {
      eff.typologie = "Entreprise / activité économique";
      eff.typologieSource = "déclaré par vous";
      eff.obligationsTypologie = T.obligationsActivite;
      eff.diagnostic = T.diagnosticActivite;
      eff.eligibiliteFprnm = T.eligibiliteActivite;
      nbLogements = 0;
    } else if (override.typologieCategorie === "annexe") {
      eff.typologie = "Annexe (non habitée)";
      eff.typologieSource = "déclaré par vous";
      eff.obligationsTypologie = p.annexeMaxM2
        ? `Annexe : creation limitee a ${p.annexeMaxM2} m2 d'emprise au sol au terrain naturel (une fois depuis l'approbation du PPRi).`
        : "Annexe : creation limitee en emprise au sol, voir reglement du PPRi.";
      eff.diagnostic = T.diagnosticAnnexe;
      eff.eligibiliteFprnm = T.eligibiliteIndeterminee;
      nbLogements = 0;
    }
    if (nbLogements !== null) eff.nbLogements = String(nbLogements);

    // Recalcul de la zone refuge (mêmes règles que docs/METHODOLOGIE.md §4 :
    // hébergement collectif de plus de 2 logements, quelle que soit la zone).
    const n = eff.nbLogements != null ? parseInt(eff.nbLogements, 10) : null;
    if (n && n > 2) {
      if (eff.etagePresent === "Oui") {
        eff.zoneRefuge = `OBLIGATOIRE (hébergement collectif, ${n} logements). Aménagement possible sur un niveau existant.`;
        eff.refugeCategorie = "Obligatoire - avec etage existant";
      } else if (eff.etagePresent === "Non") {
        eff.zoneRefuge =
          `OBLIGATOIRE (hébergement collectif, ${n} logements). ATTENTION : pas d'étage existant ` +
          `(rez-de-chaussée seul), travaux structurels nécessaires (création/surélévation) pour ` +
          `disposer d'une zone refuge.`;
        eff.refugeCategorie = "Obligatoire - sans etage existant";
      } else {
        eff.zoneRefuge =
          `Obligation de zone refuge probable (hébergement collectif, ${n} logements), mais présence ` +
          `d'un étage inconnue : précisez-la ci-dessus pour connaître les travaux éventuellement nécessaires.`;
        eff.refugeCategorie = "Obligatoire - à préciser";
      }
    } else {
      eff.zoneRefuge = "Non requise (bâtiment non concerné par l'obligation hébergement collectif >2 logements)";
      eff.refugeCategorie = "Non requise";
    }

    return eff;
  }

  function renderCorrectionBlock(p, override) {
    const etage = override && override.etagePresent;
    const typo = override && override.typologieCategorie;
    const nbLog = (override && override.nbLogements) || 3;
    const radio = (value, label) => `
      <label class="radio-row">
        <input type="radio" name="correction-etage" value="${value}" ${etage === value ? "checked" : ""}>
        ${escapeHtml(label)}
      </label>`;
    return `
      <details class="correction-block" ${override ? "open" : ""}>
        <summary>✏️ Une erreur ? Corrigez-la pour voir vos obligations</summary>
        <div class="correction-body">
          <p class="text-muted">
            Les données publiques (IGN BD TOPO, BDNB) peuvent se tromper à
            l'échelle d'un bâtiment précis. Si vous le connaissez, indiquez-le
            ici : l'outil recalcule aussitôt la zone refuge et les obligations
            ci-dessous à partir de votre réponse.
          </p>
          <form id="correction-form">
            <fieldset>
              <legend>Ce bâtiment a-t-il un étage ?</legend>
              ${radio("Oui", "Oui")}
              ${radio("Non", "Non, rez-de-chaussée seul")}
              ${radio("", "Je ne sais pas (estimation automatique)")}
            </fieldset>
            <fieldset>
              <legend>Quel type de bâtiment ?</legend>
              <select id="correction-typologie" name="correction-typologie">
                <option value="">Je ne sais pas (typologie automatique)</option>
                <option value="individuelle" ${typo === "individuelle" ? "selected" : ""}>Maison individuelle</option>
                <option value="collectif" ${typo === "collectif" ? "selected" : ""}>Logement collectif (plusieurs logements)</option>
                <option value="activite" ${typo === "activite" ? "selected" : ""}>Local d'activité économique</option>
                <option value="annexe" ${typo === "annexe" ? "selected" : ""}>Annexe non habitée (garage, abri, remise...)</option>
              </select>
            </fieldset>
            <fieldset id="correction-logements-field" ${typo === "collectif" ? "" : "hidden"}>
              <label>Nombre de logements
                <input type="number" id="correction-nb-logements" min="2" max="999" value="${escapeHtml(String(nbLog))}">
              </label>
            </fieldset>
            <div class="correction-actions">
              <button type="submit" class="btn primary">Appliquer ma correction</button>
              ${override ? `<button type="button" id="correction-reset" class="btn">Réinitialiser</button>` : ""}
            </div>
            <p class="text-muted correction-note">
              Enregistré uniquement sur cet appareil, jamais envoyé ni
              partagé. Ne remplace pas une vérification officielle.
            </p>
          </form>
        </div>
      </details>
    `;
  }

  function wireCorrectionBlock(p) {
    const form = panelBody.querySelector("#correction-form");
    if (!form) return;
    const typologieSelect = form.querySelector("#correction-typologie");
    const logementsField = form.querySelector("#correction-logements-field");
    typologieSelect.addEventListener("change", () => {
      logementsField.hidden = typologieSelect.value !== "collectif";
    });
    form.addEventListener("submit", (evt) => {
      evt.preventDefault();
      const checked = form.querySelector('input[name="correction-etage"]:checked');
      const nbLogementsInput = form.querySelector("#correction-nb-logements");
      saveOverride(p.id, {
        etagePresent: (checked && checked.value) || null,
        typologieCategorie: typologieSelect.value || null,
        nbLogements: typologieSelect.value === "collectif" ? nbLogementsInput.value : null,
      });
      renderBuildingPanel(p);
    });
    const resetBtn = form.querySelector("#correction-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        clearOverride(p.id);
        renderBuildingPanel(p);
      });
    }
  }

  function renderBuildingPanel(p) {
    panelCloseBtn.hidden = false;

    if (!p.concerne) {
      panelZoneDot.style.background = "var(--zone-hors)";
      panelTitle.textContent = "Bâtiment hors zonage PPRi";
      panelSubtitle.textContent = "Marcaissonne-Sauneseillonne";
      panelBody.innerHTML = `
        <div class="intro-block">
          <p>
            Ce bâtiment n'est <strong>pas situé dans une zone réglementée</strong>
            par le Plan de Prévention des Risques naturels d'inondation (PPRi)
            « Marcaissonne-Sauneseillonne » sur Quint-Fonsegrives.
          </p>
          <p class="text-muted">
            Cela ne signifie pas une absence totale de risque (ruissellement,
            autres cours d'eau, aléas non cartographiés à cette échelle...).
            Pour une vue complète des risques à cette adresse, consultez
            <a href="https://www.georisques.gouv.fr/" target="_blank" rel="noopener">Géorisques</a>.
          </p>
        </div>
      `;
      return;
    }

    const override = getOverride(p.id);
    const eff = applyOverride(p, override);

    panelZoneDot.style.background = eff.zoneColor;
    panelTitle.textContent = CONFIG.zoneShortNames[eff.zoneCode]
      ? `Zone ${CONFIG.zoneShortNames[eff.zoneCode]}`
      : "Zone réglementée";
    panelSubtitle.textContent = eff.zoneLabel || "";

    const sections = [];

    // --- Résumé (badge de zone uniquement ; le régime est détaillé plus bas
    //     dans « Règles de construction et travaux ») ---
    sections.push(`
      <div class="intro-block">
        ${badge(CONFIG.zoneShortNames[eff.zoneCode] || eff.zoneCode, eff.zoneColor)}
        ${eff.overridden ? `<p class="correction-active-note">✏️ Affichage basé sur votre déclaration ci-dessous.</p>` : ""}
      </div>
    `);

    // --- Type de bâtiment (typologie + caractéristiques) ---
    {
      const typoSrc = eff.typologieSource ? `Source : ${eff.typologieSource}` : "Source : BD TOPO®";
      const chips = [];
      if (eff.etagePresent) {
        chips.push(`<div class="figure-chip"><strong>${escapeHtml(eff.etagePresent)}</strong>étage présent</div>`);
      }
      if (hasValue(eff.nbLogements)) {
        chips.push(`<div class="figure-chip"><strong>${escapeHtml(String(eff.nbLogements))}</strong>logement(s)</div>`);
      }
      if (hasValue(eff.hauteurM)) {
        chips.push(`<div class="figure-chip"><strong>${eff.hauteurM} m</strong>hauteur (BD TOPO)</div>`);
      }
      sections.push(
        section(
          "🏠",
          "Type de bâtiment",
          `<p><strong>${escapeHtml(eff.typologie || "Typologie non déterminée")}</strong></p>` +
            (chips.length ? `<div class="figure-row">${chips.join("")}</div>` : "") +
            `<p class="text-muted">${escapeHtml(typoSrc)}${eff.etageSource ? " · étage : " + escapeHtml(eff.etageSource) : ""}</p>`
        )
      );
    }

    // --- Hauteur d'eau estimée (crue de référence) ---
    // Calculée hors-ligne (TIN des cotes de crue PHE moins MNT sol LiDAR HD
    // au centroïde du bâtiment, voir docs/METHODOLOGIE.md) et déjà présente
    // dans l'export : aucun calcul côté client. Les valeurs négatives ont
    // été ramenées à 0 à l'export (terrain localement plus élevé que la
    // cote de référence) ; hauteurEauNote explique le cas échéant pourquoi.
    if (hasValue(eff.hauteurEauEstimeeM)) {
      const h = parseFloat(eff.hauteurEauEstimeeM);
      const chips = [`<div class="figure-chip"><strong>${h.toFixed(2)} m</strong>hauteur d'eau estimée</div>`];
      sections.push(
        section(
          "🌊",
          "Hauteur d'eau estimée (crue de référence)",
          `<div class="figure-row">${chips.join("")}</div>` +
            (eff.hauteurEauNote ? `<p class="text-muted">${escapeHtml(eff.hauteurEauNote)}</p>` : "") +
            `<p class="text-muted">Estimation indicative obtenue par modélisation (altimétrie LiDAR HD et
             cotes de crue historique officielles), au centroïde du bâtiment. Elle ne remplace pas une
             étude hydraulique et n'a pas de valeur réglementaire opposable.</p>`
        )
      );
    }

    // --- Correction déclarative du visiteur ---
    sections.push(renderCorrectionBlock(p, override));

    // --- Règles de construction et travaux (régime + obligations liées à la
    //     typologie + seuils de travaux sur l'existant) ---
    {
      let travauxHtml = "";
      if (eff.empriseFiable === "Oui" && (eff.annexeMaxM2 || eff.extensionHebergementM2 || eff.extensionActiviteM2)) {
        const chips = [];
        if (eff.empriseSolM2) {
          chips.push(`<div class="figure-chip"><strong>${eff.empriseSolM2} m²</strong>emprise au sol actuelle</div>`);
        }
        if (eff.annexeMaxM2) {
          chips.push(`<div class="figure-chip"><strong>${eff.annexeMaxM2} m²</strong>annexe autorisée (création)</div>`);
        }
        if (eff.extensionHebergementM2) {
          chips.push(
            `<div class="figure-chip"><strong>${eff.extensionHebergementM2} m²</strong>extension hébergement</div>`
          );
        }
        if (eff.extensionActiviteM2) {
          chips.push(
            `<div class="figure-chip"><strong>${eff.extensionActiviteM2} m²</strong>extension activité (approx.)</div>`
          );
        } else if (eff.extensionActiviteNote) {
          chips.push(`<div class="figure-chip">Extension activité : voir note</div>`);
        }
        travauxHtml =
          `<div class="figure-row">${chips.join("")}</div>` +
          (eff.extensionActiviteNote ? `<p class="text-muted">${escapeHtml(eff.extensionActiviteNote)}</p>` : "") +
          `<p class="text-muted">Seuils calculés à partir de la géométrie du bâtiment (emprise au sol réelle) ; à confirmer par un professionnel avant tout dépôt de dossier.</p>`;
      } else if (eff.empriseFiable && eff.empriseFiable.startsWith("Non")) {
        travauxHtml = `<p class="text-muted">Emprise au sol trop réduite pour un calcul de seuil fiable à partir des données disponibles (annexe, abri...). Se référer directement au règlement du PPRi.</p>`;
      }
      sections.push(
        section(
          "🏗️",
          "Règles de construction et travaux",
          `<p>${escapeHtml(eff.regime || "Consultez le règlement du PPRi pour le régime applicable à ce bâtiment.")}</p>` +
            (eff.obligationsTypologie ? `<p>${escapeHtml(eff.obligationsTypologie)}</p>` : "") +
            travauxHtml
        )
      );
    }

    // --- Mesures recommandées ou obligatoires (diagnostic + zone refuge) ---
    {
      const blocks = [];
      if (eff.diagnostic) {
        blocks.push(`<div class="measure-block"><h4>🔎 Diagnostic de vulnérabilité</h4><p>${escapeHtml(eff.diagnostic)}</p></div>`);
      }
      if (eff.zoneRefuge || eff.refugeCategorie) {
        const isObligatoire = (eff.refugeCategorie || "").startsWith("Obligatoire");
        blocks.push(
          `<div class="measure-block"><h4>🛟 Zone refuge</h4><p>${escapeHtml(eff.zoneRefuge || eff.refugeCategorie)}</p>` +
            (isObligatoire
              ? `<p class="text-muted">Une zone refuge est un niveau du bâtiment situé au-dessus des plus hautes eaux connues, permettant d'attendre les secours en cas de crue.</p>`
              : "") +
            `</div>`
        );
      }
      if (blocks.length) {
        sections.push(section("⚠️", "Mesures recommandées ou obligatoires", blocks.join("")));
      }
    }

    // --- Aides financières ---
    if (eff.eligibiliteFprnm) {
      sections.push(section("💶", "Aides financières (Fonds Barnier)", `<p>${escapeHtml(eff.eligibiliteFprnm)}</p>`));
    }

    // --- Détails techniques (repliés) ---
    // Champs bruts utiles pour un usage administratif/technique (élus,
    // techniciens, bureaux d'études) : codes et identifiants stables,
    // complémentaires du texte déjà mis en forme dans les sections
    // ci-dessus (qui restent la référence pour le contenu réglementaire).
    const techRows = [];
    if (hasValue(eff.zoneCode)) techRows.push(techRow("Code de zone (PPRi)", eff.zoneCode));
    if (hasValue(eff.zonesIntersectees)) techRows.push(techRow("Zones intersectées", eff.zonesIntersectees));
    if (hasValue(eff.refugeCategorie)) techRows.push(techRow("Catégorie zone refuge", eff.refugeCategorie));
    if (hasValue(eff.empriseFiable)) techRows.push(techRow("Fiabilité de l'emprise au sol", eff.empriseFiable));
    if (hasValue(eff.altitudeSolLidarHdM)) techRows.push(techRow("Altitude sol (LiDAR HD)", eff.altitudeSolLidarHdM + " m NGF"));
    if (hasValue(eff.coteReferencePheM)) techRows.push(techRow("Cote de référence PHE", eff.coteReferencePheM + " m NGF"));
    if (hasValue(eff.coteReferenceMethode)) techRows.push(techRow("Méthode de la cote de référence", eff.coteReferenceMethode));
    if (eff.__centroid) {
      techRows.push(
        techRow("Coordonnées (WGS84)", `${eff.__centroid.lat.toFixed(6)}, ${eff.__centroid.lng.toFixed(6)}`)
      );
    }
    if (hasValue(eff.id)) techRows.push(techRow("Identifiant BD TOPO", eff.id));

    if (techRows.length) {
      sections.push(`
        <details class="tech-details">
          <summary>Détails techniques (pour élus, techniciens, bureaux d'études)</summary>
          <dl>${techRows.join("")}</dl>
        </details>
      `);
    }

    sections.push(`
      <p class="text-muted" style="margin-top:18px;font-size:0.8rem">
        Ces informations sont calculées automatiquement à partir du règlement du
        PPRi et de données géographiques (IGN BD TOPO), le cas échéant complétées
        par votre déclaration ci-dessus. Elles n'ont pas de valeur
        réglementaire opposable : en cas de doute, contactez le service urbanisme
        de la mairie ou la DDT de la Haute-Garonne. Voir la page
        <a href="mentions-legales.html">mentions légales</a>.
      </p>
    `);

    panelBody.innerHTML = sections.join("");
    wireCorrectionBlock(p);
  }

  function section(icon, title, html) {
    return `<section class="detail-block"><h3>${icon} ${escapeHtml(title)}</h3>${html}</section>`;
  }

  function techRow(label, value) {
    return `<div class="tech-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
  }

  function showWelcomePanel() {
    panelZoneDot.style.background = "var(--color-primary)";
    panelTitle.textContent = "Mes obligations face au risque inondation";
    panelSubtitle.textContent = "Quint-Fonsegrives - PPRi Marcaissonne-Sauneseillonne";
    panelCloseBtn.hidden = true;
    panelBody.innerHTML = `
      <div class="intro-block">
        <p>
          Cliquez sur un bâtiment sur la carte, ou recherchez une adresse
          ci-dessus, pour connaître les obligations réglementaires liées au
          risque inondation qui s'appliquent à ce bâtiment.
        </p>
        <p class="text-muted">
          Cet outil s'adresse aussi bien aux habitants qu'aux gestionnaires
          d'établissements recevant du public (ERP), d'activités économiques,
          ainsi qu'aux élus et techniciens.
        </p>
        <div class="welcome-cta">
          <a class="btn primary" href="#" id="cta-locate">📍 Me localiser</a>
          <a class="btn" href="glossaire.html">📖 Glossaire</a>
          <a class="btn" href="faq.html">❓ Questions fréquentes</a>
        </div>
      </div>
    `;
    document.getElementById("cta-locate").addEventListener("click", (e) => {
      e.preventDefault();
      geolocate();
    });
  }

  /* ----------------------------------------------------------------------
   * 5. Recherche d'adresse (API Adresse - Base Adresse Nationale) & géoloc
   * -------------------------------------------------------------------- */

  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");
  let searchDebounce = null;

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 3) {
      closeSearchResults();
      return;
    }
    searchDebounce = setTimeout(() => runAddressSearch(q), 300);
  });

  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (searchInput.value.trim().length >= 3) runAddressSearch(searchInput.value.trim());
  });

  function closeSearchResults() {
    searchResults.classList.remove("open");
    searchResults.innerHTML = "";
  }

  async function runAddressSearch(q) {
    try {
      const url =
        "https://api-adresse.data.gouv.fr/search/?q=" +
        encodeURIComponent(q) +
        "&citycode=" +
        CONFIG.codeInsee +
        "&limit=5";
      const res = await fetch(url);
      if (!res.ok) throw new Error("recherche indisponible");
      const data = await res.json();
      renderSearchResults(data.features || []);
    } catch (err) {
      console.warn("Recherche d'adresse indisponible :", err);
      searchResults.innerHTML = `<div style="padding:12px;font-size:0.85rem" class="text-muted">
        Recherche indisponible pour le moment. Vous pouvez cliquer directement sur la carte.
      </div>`;
      searchResults.classList.add("open");
    }
  }

  function renderSearchResults(features) {
    if (!features.length) {
      searchResults.innerHTML = `<div style="padding:12px;font-size:0.85rem" class="text-muted">
        Aucune adresse trouvée sur la commune.
      </div>`;
      searchResults.classList.add("open");
      return;
    }
    searchResults.innerHTML = features
      .map((f, i) => `<button type="button" data-idx="${i}">${escapeHtml(f.properties.label)}</button>`)
      .join("");
    searchResults.classList.add("open");
    searchResults.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = features[Number(btn.dataset.idx)];
        goToPoint(f.geometry.coordinates[1], f.geometry.coordinates[0], f.properties.label);
        closeSearchResults();
        searchInput.value = f.properties.label;
      });
    });
  }

  function goToPoint(lat, lng, label) {
    map.flyTo([lat, lng], 18, { duration: 0.6 });
    const marker = L.marker([lat, lng], { title: label }).addTo(map);
    setTimeout(() => map.removeLayer(marker), 6000);
    tryFindBuildingAt(lat, lng);
  }

  function tryFindBuildingAt(lat, lng) {
    if (!window.turf) return;
    const pt = turf.point([lng, lat]);
    const data = window.__appData;
    if (!data) return;
    const collections = [data.batZone, data.batHors];
    for (const fc of collections) {
      for (const feature of fc.features) {
        try {
          if (turf.booleanPointInPolygon(pt, feature)) {
            const layerMatch = findLeafletLayerById(feature.properties.id);
            if (layerMatch) {
              selectBuilding(layerMatch.layer, layerMatch.feature);
            }
            return;
          }
        } catch (e) {
          /* géométrie invalide isolée : on ignore et continue */
        }
      }
    }
  }

  function findLeafletLayerById(id) {
    let found = null;
    [layers.batiments, layers.horsZone].forEach((group) => {
      group.eachLayer((sub) => {
        sub.eachLayer &&
          sub.eachLayer((leaf) => {
            if (leaf.feature && leaf.feature.properties.id === id) {
              found = { layer: leaf, feature: leaf.feature };
            }
          });
      });
    });
    return found;
  }

  function geolocate() {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        goToPoint(pos.coords.latitude, pos.coords.longitude, "Ma position");
      },
      () => {
        alert("Impossible d'accéder à votre position. Vérifiez les autorisations de localisation.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  document.getElementById("locate-btn").addEventListener("click", geolocate);

  /* ----------------------------------------------------------------------
   * 6. Légende & bascule des couches
   *
   * La légende est un simple bouton + panneau déroulant en HTML statique
   * (et non un contrôle Leaflet) : elle reste ainsi toujours à côté de la
   * recherche, sans jamais recouvrir le panneau d'information ni la carte,
   * quelle que soit la taille d'écran.
   * -------------------------------------------------------------------- */

  const legendToggle = document.getElementById("legend-toggle");
  const legendBox = document.getElementById("legend-box");

  function setLegendOpen(open) {
    legendBox.classList.toggle("open", open);
    legendToggle.setAttribute("aria-expanded", String(open));
    legendToggle.setAttribute("aria-pressed", String(open));
  }

  legendToggle.addEventListener("click", () => {
    setLegendOpen(!legendBox.classList.contains("open"));
  });

  document.addEventListener("click", (e) => {
    if (!legendBox.classList.contains("open")) return;
    if (e.target === legendToggle || legendBox.contains(e.target)) return;
    setLegendOpen(false);
  });

  const horsToggle = document.getElementById("toggle-horszone");
  const erpToggle = document.getElementById("toggle-erp");
  horsToggle.addEventListener("change", () => {
    if (horsToggle.checked) map.addLayer(layers.horsZone);
    else map.removeLayer(layers.horsZone);
  });
  erpToggle.addEventListener("change", () => {
    if (erpToggle.checked) map.addLayer(layers.erp);
    else map.removeLayer(layers.erp);
  });

  const hauteurEauToggle = document.getElementById("toggle-hauteur-eau");
  if (hauteurEauToggle) {
    hauteurEauToggle.addEventListener("change", () => {
      if (hauteurEauToggle.checked) map.addLayer(layers.hauteurEau);
      else map.removeLayer(layers.hauteurEau);
    });
  }

  /* ----------------------------------------------------------------------
   * 7. Tableau de bord communal (élus, techniciens)
   *
   * Agrégats calculés côté client à partir des GeoJSON déjà chargés (aucune
   * source de données supplémentaire, aucun recalcul serveur). Chaque
   * donnée est une tuile cliquable : elle surligne sur la carte les
   * bâtiments/ERP correspondants et estompe les autres, en réutilisant
   * defaultStyleCache pour revenir au style d'origine à la réinitialisation
   * (même mécanisme que la sélection d'un bâtiment, cf. §4).
   * -------------------------------------------------------------------- */

  const DASHBOARD_HIGHLIGHT_FILL = "#d81b60";
  const DASHBOARD_HIGHLIGHT_STROKE = "#880e4f";

  const DASHBOARD_TILES = [
    {
      id: "erp-en-zone",
      group: "Établissements recevant du public (ERP)",
      layerKey: "erp",
      label: "ERP en zone réglementée PPRi",
      predicate: (p) => p.concerne === true,
    },
    {
      id: "erp-sensibles",
      group: "Établissements recevant du public (ERP)",
      layerKey: "erp",
      label: "… dont établissements sensibles ou stratégiques",
      sub: true,
      predicate: (p) => p.concerne === true && /^Établissement/.test(p.classeVulnerabilite || ""),
    },
    {
      id: "refuge-obligatoire",
      group: "Zone refuge",
      layerKey: "batiments",
      label: "Bâtiments avec obligation de zone refuge",
      predicate: (p) => (p.zoneRefuge || "").startsWith("OBLIGATOIRE"),
    },
    {
      id: "refuge-sans-etage",
      group: "Zone refuge",
      layerKey: "batiments",
      label: "⚠️ … dont sans étage existant (travaux structurels nécessaires)",
      sub: true,
      predicate: (p) => (p.zoneRefuge || "").includes("ATTENTION"),
    },
    {
      id: "typologie-bdnb",
      group: "Typologie et fiabilité des données",
      layerKey: "batiments",
      label: "Typologie complétée via la BDNB (à vérifier terrain)",
      predicate: (p) => !!p.typologieSource,
    },
    {
      id: "typologie-indeterminee",
      group: "Typologie et fiabilité des données",
      layerKey: "batiments",
      label: "Typologie encore indéterminée",
      predicate: (p) => (p.typologie || "").startsWith("Typologie indéterminée"),
    },
    {
      id: "emprise-non-fiable",
      group: "Typologie et fiabilité des données",
      layerKey: "batiments",
      label: "Emprise trop réduite pour un seuil de travaux fiable",
      predicate: (p) => (p.empriseFiable || "").startsWith("Non"),
    },
    {
      id: "fprnm-indetermine",
      group: "Éligibilité Fonds Barnier (FPRNM)",
      layerKey: "batiments",
      label: "Éligibilité non déterminée",
      predicate: (p) => (p.eligibiliteFprnm || "").startsWith("Non déterminé"),
    },
  ];

  const ZONE_CSS_VAR = {
    Bi: "--zone-bleue",
    Ji: "--zone-jaune",
    Ri: "--zone-rouge",
    GHi: "--zone-grise-hachuree",
    Pi: "--zone-pourpre",
  };

  const dashboardToggle = document.getElementById("dashboard-toggle");
  const dashboardBox = document.getElementById("dashboard-box");
  const dashboardGroups = document.getElementById("dashboard-groups");
  const dashboardActiveFilter = document.getElementById("dashboard-active-filter");
  const dashboardActiveFilterLabel = document.getElementById("dashboard-active-filter-label");
  const dashboardResetBtn = document.getElementById("dashboard-reset-btn");

  const dashboardTileIndex = new Map();
  let dashboardActiveTileId = null;
  let dashboardActiveLayerKey = null;

  // Repères temporaires (« radar ») affichés au moment du clic sur une
  // tuile : à l'échelle communale, un bâtiment surligné reste un minuscule
  // polygone, difficile à repérer d'un coup d'œil. Un cercle de taille
  // fixe en pixels (donc toujours visible, quel que soit le zoom), qui
  // clignote quelques secondes puis disparaît, attire l'œil sans polluer
  // durablement la carte (le bâtiment reste surligné en continu, lui).
  const dashboardBeacons = L.layerGroup().addTo(map);
  let dashboardBeaconTimers = [];

  function clearDashboardBeacons() {
    dashboardBeaconTimers.forEach((t) => clearTimeout(t));
    dashboardBeaconTimers = [];
    dashboardBeacons.clearLayers();
  }

  function spawnDashboardBeacon(latlng) {
    const beacon = L.circleMarker(latlng, {
      radius: 16,
      color: DASHBOARD_HIGHLIGHT_STROKE,
      weight: 2,
      fillColor: DASHBOARD_HIGHLIGHT_FILL,
      fillOpacity: 0.5,
      opacity: 0.9,
      interactive: false,
      className: "dashboard-beacon",
    }).addTo(dashboardBeacons);
    dashboardBeaconTimers.push(setTimeout(() => dashboardBeacons.removeLayer(beacon), 2600));
  }

  // Les ERP sont déjà des points (contrairement aux bâtiments) : on fait
  // clignoter le marqueur lui-même plutôt que de superposer un repère.
  function pulseMarker(leaf) {
    if (!leaf._path) return;
    leaf._path.classList.remove("dashboard-beacon");
    // Force un reflow pour pouvoir relancer l'animation CSS si elle vient
    // déjà de jouer sur ce même élément (ex. deux clics rapprochés).
    void leaf._path.offsetWidth;
    leaf._path.classList.add("dashboard-beacon");
  }

  function setDashboardOpen(open) {
    dashboardBox.classList.toggle("open", open);
    dashboardToggle.setAttribute("aria-expanded", String(open));
    dashboardToggle.setAttribute("aria-pressed", String(open));
  }

  dashboardToggle.addEventListener("click", () => {
    setDashboardOpen(!dashboardBox.classList.contains("open"));
  });

  document.addEventListener("click", (e) => {
    if (!dashboardBox.classList.contains("open")) return;
    if (e.target === dashboardToggle || dashboardBox.contains(e.target)) return;
    setDashboardOpen(false);
  });

  function eachFeatureLayer(layerGroup, fn) {
    layerGroup.eachLayer((geoLayer) => {
      if (geoLayer.eachLayer) geoLayer.eachLayer(fn);
    });
  }

  function countMatches(features, predicate) {
    let n = 0;
    for (const f of features) if (predicate(f.properties)) n += 1;
    return n;
  }

  function tileHtml(id, label, count, sub) {
    return `
      <button type="button" class="dashboard-tile${sub ? " sub" : ""}" data-tile-id="${id}" aria-pressed="false">
        <span class="dashboard-tile-count">${count}</span>
        <span class="dashboard-tile-label">${escapeHtml(label)}</span>
      </button>
    `;
  }

  function initDashboard() {
    const data = window.__appData;
    if (!data) return;

    const groupsHtml = [];
    const seenGroups = new Set();

    DASHBOARD_TILES.forEach((tile) => {
      dashboardTileIndex.set(tile.id, tile);
      if (seenGroups.has(tile.group)) return;
      seenGroups.add(tile.group);
      const tilesOfGroup = DASHBOARD_TILES.filter((t) => t.group === tile.group);
      const rows = tilesOfGroup
        .map((t) => {
          const features = t.layerKey === "erp" ? data.erp.features : data.batZone.features;
          return tileHtml(t.id, t.label, countMatches(features, t.predicate), t.sub);
        })
        .join("");
      groupsHtml.push(`<div class="dashboard-group"><h4>${escapeHtml(tile.group)}</h4>${rows}</div>`);
    });

    // Répartition par zone réglementaire : générée depuis CONFIG.zoneOrder
    // plutôt que déclarée dans DASHBOARD_TILES (une tuile par zone).
    const zoneRows = CONFIG.zoneOrder
      .map((zoneCode) => {
        const tileId = `zone-${zoneCode}`;
        dashboardTileIndex.set(tileId, {
          id: tileId,
          layerKey: "batiments",
          predicate: (p) => p.zoneCode === zoneCode,
        });
        const count = countMatches(data.batZone.features, (p) => p.zoneCode === zoneCode);
        return `
          <button type="button" class="dashboard-tile dashboard-tile-zone" data-tile-id="${tileId}" aria-pressed="false">
            <span class="legend-swatch" style="background:var(${ZONE_CSS_VAR[zoneCode]})"></span>
            <span class="dashboard-tile-label">${escapeHtml(CONFIG.zoneShortNames[zoneCode])}</span>
            <span class="dashboard-tile-count">${count}</span>
          </button>
        `;
      })
      .join("");
    groupsHtml.push(`<div class="dashboard-group"><h4>Bâtiments par zone réglementaire</h4>${zoneRows}</div>`);

    dashboardGroups.innerHTML = groupsHtml.join("");
    dashboardGroups.querySelectorAll(".dashboard-tile").forEach((btn) => {
      btn.addEventListener("click", () => toggleDashboardFilter(btn.dataset.tileId));
    });
  }

  function toggleDashboardFilter(tileId) {
    if (dashboardActiveTileId === tileId) {
      clearDashboardFilter();
      return;
    }
    const tile = dashboardTileIndex.get(tileId);
    if (!tile) return;
    applyDashboardFilter(tile);
  }

  function restoreLayerStyles(layerKey) {
    eachFeatureLayer(layers[layerKey], (leaf) => {
      const original = defaultStyleCache.get(leaf);
      if (original) leaf.setStyle(original);
      if (leaf.setRadius) leaf.setRadius(7);
    });
  }

  function applyDashboardFilter(tile) {
    clearSelection();
    clearDashboardBeacons();
    if (dashboardActiveLayerKey && dashboardActiveLayerKey !== tile.layerKey) {
      restoreLayerStyles(dashboardActiveLayerKey);
    }

    // Un filtre doit toujours être visible : si la couche ERP a été
    // masquée depuis la légende, on la réaffiche (les bâtiments n'ont pas
    // ce problème, ils n'ont pas de case à cocher dédiée).
    if (tile.layerKey === "erp" && !map.hasLayer(layers.erp)) {
      map.addLayer(layers.erp);
      erpToggle.checked = true;
    }

    let matchCount = 0;
    let combined = L.latLngBounds([]);
    const matched = [];
    eachFeatureLayer(layers[tile.layerKey], (leaf) => {
      if (tile.predicate(leaf.feature.properties)) {
        matchCount += 1;
        leaf.setStyle({
          color: DASHBOARD_HIGHLIGHT_STROKE,
          weight: 2,
          fillColor: DASHBOARD_HIGHLIGHT_FILL,
          fillOpacity: 0.9,
          opacity: 1,
        });
        if (leaf.setRadius) leaf.setRadius(9);
        if (leaf.bringToFront) leaf.bringToFront();
        if (leaf.getBounds) {
          const bounds = leaf.getBounds();
          combined.extend(bounds);
          matched.push({ centroid: bounds.getCenter() });
        } else {
          combined.extend(leaf.getLatLng());
          matched.push({ marker: leaf });
        }
      } else {
        leaf.setStyle({ opacity: 0.12, fillOpacity: 0.06 });
        if (leaf.setRadius) leaf.setRadius(5);
      }
    });

    dashboardActiveTileId = tile.id;
    dashboardActiveLayerKey = tile.layerKey;

    dashboardGroups.querySelectorAll(".dashboard-tile").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.tileId === tile.id));
    });

    dashboardActiveFilterLabel.textContent =
      matchCount > 1 ? `${matchCount} éléments surlignés sur la carte` : `${matchCount} élément surligné sur la carte`;
    dashboardActiveFilter.hidden = false;

    // Le clignotement démarre une fois la carte stabilisée sur les
    // éléments trouvés (sinon les repères se dessinent pendant le
    // recentrage et paraissent décalés). Sans recentrage nécessaire
    // (bounds déjà invalides ou vue inchangée), on le déclenche tout de
    // suite.
    const spawnBeacons = () => {
      matched.forEach((m) => (m.centroid ? spawnDashboardBeacon(m.centroid) : pulseMarker(m.marker)));
    };
    if (combined.isValid()) {
      map.once("moveend", spawnBeacons);
      map.flyToBounds(combined, { padding: [48, 48], maxZoom: 17, duration: 0.6 });
    } else {
      spawnBeacons();
    }
  }

  function clearDashboardFilter() {
    if (dashboardActiveLayerKey) restoreLayerStyles(dashboardActiveLayerKey);
    clearDashboardBeacons();
    dashboardActiveTileId = null;
    dashboardActiveLayerKey = null;
    dashboardGroups.querySelectorAll(".dashboard-tile").forEach((btn) => btn.setAttribute("aria-pressed", "false"));
    dashboardActiveFilter.hidden = true;
  }

  dashboardResetBtn.addEventListener("click", clearDashboardFilter);

  document.addEventListener("app:data-ready", initDashboard);

  /* ----------------------------------------------------------------------
   * Menu mobile
   * -------------------------------------------------------------------- */
  const menuToggle = document.getElementById("menu-toggle");
  const mobileNav = document.getElementById("mobile-nav");
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
  }

  /* ----------------------------------------------------------------------
   * Démarrage
   * -------------------------------------------------------------------- */
  showWelcomePanel();
  init();
})();
