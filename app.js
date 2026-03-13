/* =============================================
   THÈME CLAIR / SOMBRE — init immédiate
============================================= */
(function () {
  const saved = localStorage.getItem('migaki_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

/* =============================================
   TAILLE DU GOBAN — dynamique
============================================= */
function calculerTailleGoban() {
  if (document.body.classList.contains('mode-presentation')) {
    return Math.floor(
      Math.min(window.innerHeight * 0.92, window.innerWidth * 0.95)
    );
  }
  if (window.innerWidth < 900) {
    // Mobile/tablette : toute la largeur dispo, hauteur limitée à 60% du viewport
    return Math.min(
      window.innerWidth - 28,
      Math.floor(window.innerHeight * 0.6)
    );
  }
  // Desktop : sidebar = 320px + gap 18px + paddings 36px = ~374px
  const largeurDispo = window.innerWidth - 374;
  // Hauteur : viewport - header (~70px) - contrôles (~95px) - marges (~36px)
  const hauteurDispo = window.innerHeight - 70 - 95 - 36;
  return Math.floor(Math.min(largeurDispo, hauteurDispo, 900));
}

let tailleGobanActuelle = 500;

function ajusterGoban() {
  const nouvelle = Math.max(280, calculerTailleGoban());
  if (Math.abs(nouvelle - tailleGobanActuelle) > 10) {
    tailleGobanActuelle = nouvelle;
    goban.setWidth(tailleGobanActuelle);
  }
}

window.addEventListener('resize', ajusterGoban);

/* =============================================
   SON — pierre sur le goban (Web Audio API)
============================================= */
let audioCtx = null;
let sonActif = localStorage.getItem('fuseki_son') !== 'off';

function getAudioCtx() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function jouerSonPierre(couleur) {
  if (!sonActif) return;
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    // Bruit blanc court filtré = claquement mat de pierre
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Filtre passe-haut : pierre noire plus claquante, blanche plus douce
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = couleur === WGo.B ? 1800 : 1200;
    filter.Q.value = 0.8;

    // Enveloppe d'amplitude : attaque immédiate, déclin rapide
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.08);
  } catch (e) {
    /* silencieux si Web Audio non dispo */
  }
}

/* =============================================
   RÉCUPÉRATION DES ÉLÉMENTS HTML
============================================= */
const fileInput = document.getElementById('sgf-file');
const btnModePresentation = document.getElementById('btn-mode-presentation');
const btnQuitterPresentation = document.getElementById(
  'btn-quitter-presentation'
);
const btnSolution = document.getElementById('btn-solution');
const btnReset = document.getElementById('btn-reset');
const selectEl = document.getElementById('select-couleur-joueur');
const menuFichier = document.getElementById('menu-fichier');
const actionsExercice = document.getElementById('actions-exercice');
const boardContainer = document.getElementById('goban');
const colonneDroite = document.getElementById('colonne-droite');
const gobanWrapper = document.getElementById('goban-wrapper');

const infoVariation = document.getElementById('info-variation');
const infoNom = document.getElementById('info-nom');
const infoComment = document.getElementById('info-comment');
const commentaireSgf = document.getElementById('commentaire-sgf');

const messageFin = document.getElementById('message-fin');
const titreFin = document.getElementById('titre-fin');
const sousTitreFin = document.getElementById('sous-titre-fin');
const finIcone = document.getElementById('fin-icone');
const btnSuivante = document.getElementById('btn-suivante');
const fileNameDisplay = document.getElementById('file-name-display');

/* =============================================
   ÉTAT GLOBAL
============================================= */
let goban = new WGo.Board(boardContainer, {
  width: 500,
  size: 19,
  background: '',
});
let kifu = null;
let noeudCourant = null;
let modeExerciceActif = false;
let modePresentationActif = false;
let compteurErreurs = 0;
let abandonSequence = false;
let compteurSolution = 1;
let variationCourante = null;

let couleurJoueur = WGo.B;
let couleurOrdi = WGo.W;

let toutesLesVariations = [];
let donneesSauvegardees = {};
let timerPresentation = null;
let indexVariationActuelle = 0;
let indexCoupActuel = 0;

/* =============================================
   MOTEUR DE JEU + MARQUEUR CR
============================================= */
let moteurJeu = null;
let dernierMarqueurCR = null;
let enModeSolution = false;

function reinitialiserMoteur() {
  moteurJeu = new WGo.Game(19, 'KO');
  dernierMarqueurCR = null;
  enModeSolution = false;
}

function jouerCoupAvecCaptures(x, y, couleur) {
  if (!moteurJeu) return;
  if (dernierMarqueurCR) {
    goban.removeObject(dernierMarqueurCR);
    dernierMarqueurCR = null;
  }
  const resultat = moteurJeu.play(x, y, couleur);
  if (typeof resultat === 'number') {
    goban.addObject({ x, y, c: couleur });
  } else {
    goban.addObject({ x, y, c: couleur });
    if (resultat && resultat.length > 0)
      for (const cap of resultat) goban.removeObjectsAt(cap.x, cap.y);
  }
  if (!enModeSolution) {
    dernierMarqueurCR = { type: 'CR', x, y };
    goban.addObject(dernierMarqueurCR);
  }
  jouerSonPierre(couleur);
}

function placerPierreSetup(x, y, couleur) {
  moteurJeu.addStone(x, y, couleur);
  goban.addObject({ x, y, c: couleur });
}

/* =============================================
   TOAST NOTIFICATIONS
============================================= */
function afficherToast(texte, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = texte;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 1400);
}

/* =============================================
   COMPTEUR DE VIES
============================================= */
function mettreAJourVies() {
  for (let i = 1; i <= 3; i++) {
    const vie = document.getElementById(`vie-${i}`);
    if (i <= 3 - compteurErreurs) vie.classList.remove('perdue');
    else vie.classList.add('perdue');
  }
}

function animerPerteVie() {
  const vie = document.getElementById(`vie-${compteurErreurs}`);
  if (vie) {
    vie.classList.add('flash');
    setTimeout(() => vie.classList.remove('flash'), 400);
  }
  gobanWrapper.classList.add('shake');
  setTimeout(() => gobanWrapper.classList.remove('shake'), 400);
}

/* =============================================
   COMMENTAIRES SGF
============================================= */
function afficherCommentaire(noeud) {
  const c = noeud && noeud.comment;
  if (c && c.trim() && modeExerciceActif) {
    commentaireSgf.style.display = 'block';
    commentaireSgf.innerText = c.trim();
  } else {
    commentaireSgf.style.display = 'none';
    commentaireSgf.innerText = '';
  }
}

/* =============================================
   MÉMOIRE (LOCALSTORAGE)
============================================= */
function genererSignature(variation) {
  let sig = '';
  for (const n of variation)
    if (n.move) sig += n.move.c + ':' + n.move.x + ',' + n.move.y + '|';
  return sig;
}

function sauvegarderDonnees() {
  localStorage.setItem('fuseki_data', JSON.stringify(donneesSauvegardees));
}

function chargerDonnees() {
  const data = localStorage.getItem('fuseki_data');
  donneesSauvegardees = data ? JSON.parse(data) : {};
}

function sauvegarderVariationServeur(sig) {
  const data = donneesSauvegardees[sig];
  if (!data) return;
  window.dispatchEvent(
    new CustomEvent('sauvegarder-variation', {
      detail: {
        sig,
        statut: data.statut,
        nom: data.nom,
        commentaire: data.commentaire || '',
      },
    })
  );
}

/* =============================================
   STATISTIQUES ET TABLEAU
============================================= */
function mettreAJourStatistiques() {
  const total = toutesLesVariations.length;
  if (total === 0) return;
  let nbGris = 0,
    nbOrange = 0,
    nbRouge = 0,
    nbVert = 0;
  for (const v of toutesLesVariations) {
    const s = donneesSauvegardees[genererSignature(v)].statut;
    if (s === 'Parfait') nbVert++;
    else if (s === 'Erreurs') nbOrange++;
    else if (s === 'Echec') nbRouge++;
    else nbGris++;
  }
  document.getElementById('stat-gris').innerText =
    Math.round((nbGris / total) * 100) + '%';
  document.getElementById('stat-orange').innerText =
    Math.round((nbOrange / total) * 100) + '%';
  document.getElementById('stat-rouge').innerText =
    Math.round((nbRouge / total) * 100) + '%';
  document.getElementById('stat-vert').innerText =
    Math.round((nbVert / total) * 100) + '%';
  document.getElementById('prog-vert').style.width =
    (nbVert / total) * 100 + '%';
  document.getElementById('prog-orange').style.width =
    (nbOrange / total) * 100 + '%';
  document.getElementById('prog-rouge').style.width =
    (nbRouge / total) * 100 + '%';
}

function afficherTableau() {
  const tbody = document.querySelector('#table-variations tbody');
  tbody.innerHTML = '';
  document.getElementById('nb-variations').innerText =
    toutesLesVariations.length + ' séquences';
  const sigCourante = variationCourante
    ? genererSignature(variationCourante)
    : null;

  for (let i = 0; i < toutesLesVariations.length; i++) {
    const variation = toutesLesVariations[i];
    const sig = genererSignature(variation);
    const data = donneesSauvegardees[sig];
    const tr = document.createElement('tr');

    /* On ne révèle la variation en cours que si l'exercice est terminé ou en mode visu */
    if (sig === sigCourante && !modeExerciceActif) {
      tr.classList.add('active-row');
    }

    const tdStatut = document.createElement('td');
    tdStatut.className = 'td-statut';
    if (data.statut === 'Parfait') tdStatut.innerText = '🟢';
    else if (data.statut === 'Erreurs') tdStatut.innerText = '🟠';
    else if (data.statut === 'Echec') tdStatut.innerText = '🔴';
    else tdStatut.innerText = '⚪';
    tr.appendChild(tdStatut);

    const tdNom = document.createElement('td');
    const inputNom = document.createElement('input');
    inputNom.type = 'text';
    inputNom.className = 'nom-edit';
    inputNom.value = data.nom;

    /* Fonction de sauvegarde centralisée pour le champ texte */
    const validerNouveauNom = function () {
      if (donneesSauvegardees[sig].nom !== inputNom.value) {
        donneesSauvegardees[sig].nom = inputNom.value;
        sauvegarderDonnees();
        if (infoNom.getAttribute('data-sig') === sig) {
          infoNom.innerText = inputNom.value;
        }
        /* On envoie au serveur ! */
        sauvegarderVariationServeur(sig);
      }
    };

    /* Se déclenche quand on clique en dehors du champ ou qu'on fait Entrée */
    inputNom.addEventListener('change', validerNouveauNom);

    /* On force la validation si on appuie spécifiquement sur la touche Entrée */
    inputNom.addEventListener('keyup', function (e) {
      if (e.key === 'Enter') {
        inputNom.blur(); /* Retire le focus, ce qui déclenche l'animation visuelle et la sauvegarde */
      }
    });

    tdNom.appendChild(inputNom);

    const tdVisu = document.createElement('td');
    tdVisu.className = 'td-visu';
    const btnVisu = document.createElement('button');
    btnVisu.innerText = '👁';
    btnVisu.title = window.t ? window.t('btn_visualiser_title') : 'Visualiser';
    btnVisu.setAttribute('aria-label', btnVisu.title);
    btnVisu.className = 'btn-visu';
    btnVisu.addEventListener('click', () => visualiserVariation(variation));
    tdVisu.appendChild(btnVisu);
    tr.appendChild(tdVisu);

    tbody.appendChild(tr);
  }
}

/* =============================================
   UTILITAIRES
============================================= */
function redimensionnerGoban(taille) {
  tailleGobanActuelle = taille;
  goban.setWidth(taille);
}

function arreterTout() {
  if (timerPresentation) {
    clearTimeout(timerPresentation);
    timerPresentation = null;
  }
  modePresentationActif = false;
  modeExerciceActif = false;
  goban.removeAllObjects();
  messageFin.style.display = 'none';
  actionsExercice.style.display = 'none';
  commentaireSgf.style.display = 'none';
  gobanWrapper.classList.remove('ordi-pense');
}

function extraireVariations(noeud, chemin) {
  const nouveau = chemin.slice();
  if (noeud.move) nouveau.push(noeud);
  if (noeud.children.length === 0) {
    if (nouveau.length > 0) toutesLesVariations.push(nouveau);
    return;
  }
  for (const enfant of noeud.children) extraireVariations(enfant, nouveau);
}

/* =============================================
   ALGORITHME 80 / 15 / 5
============================================= */
function choisirVariation() {
  const poolGris = [],
    poolOrangeRouge = [],
    poolVert = [];
  for (let i = 0; i < toutesLesVariations.length; i++) {
    const s =
      donneesSauvegardees[genererSignature(toutesLesVariations[i])].statut;
    if (s === 'Non exploré') poolGris.push(i);
    else if (s === 'Erreurs' || s === 'Echec') poolOrangeRouge.push(i);
    else if (s === 'Parfait') poolVert.push(i);
  }
  const j = Math.random();
  let pool;
  if (j < 0.8 && poolGris.length > 0) pool = poolGris;
  else if (j < 0.95 && poolOrangeRouge.length > 0) pool = poolOrangeRouge;
  else if (poolVert.length > 0) pool = poolVert;
  else if (poolGris.length > 0) pool = poolGris;
  else pool = poolOrangeRouge;
  return toutesLesVariations[pool[Math.floor(Math.random() * pool.length)]];
}

/* =============================================
   MODE PRÉSENTATION
============================================= */
function animerProchainCoup() {
  if (!modePresentationActif) return;
  const variation = toutesLesVariations[indexVariationActuelle];
  if (indexCoupActuel === 0) {
    const sig = genererSignature(variation);
    const data = donneesSauvegardees[sig];
    infoNom.innerText = data.nom;
    infoComment.innerText = data.commentaire ? `« ${data.commentaire} »` : '';
    infoNom.setAttribute('data-sig', sig);
    reinitialiserMoteur();
    if (kifu.root.setup)
      for (const s of kifu.root.setup) placerPierreSetup(s.x, s.y, s.c);
  }
  if (indexCoupActuel < variation.length) {
    const noeud = variation[indexCoupActuel];
    jouerCoupAvecCaptures(noeud.move.x, noeud.move.y, noeud.move.c);
    indexCoupActuel++;
    timerPresentation = setTimeout(animerProchainCoup, 800);
  } else {
    indexVariationActuelle = toutesLesVariations.indexOf(choisirVariation());
    indexCoupActuel = 0;
    timerPresentation = setTimeout(() => {
      if (!modePresentationActif) return;
      goban.removeAllObjects();
      animerProchainCoup();
    }, 3000);
  }
}

function lancerPresentation() {
  if (toutesLesVariations.length === 0) return; /* Sécurité anti-écran noir */
  arreterTout();
  document.body.classList.add('mode-presentation');
  redimensionnerGoban(
    Math.floor(Math.min(window.innerHeight * 0.9, window.innerWidth * 0.95))
  );
  infoVariation.style.display = 'block';
  modePresentationActif = true;
  if (toutesLesVariations.length > 0) {
    variationCourante = choisirVariation();
    indexVariationActuelle = toutesLesVariations.indexOf(variationCourante);
    indexCoupActuel = 0;
    animerProchainCoup();
  }
}

/* =============================================
   MODE EXERCICE
============================================= */
function lancerExercice() {
  arreterTout();
  document.body.classList.remove('mode-presentation');
  redimensionnerGoban(calculerTailleGoban());
  relancerSequence();
}

function relancerSequence() {
  goban.removeAllObjects();
  messageFin.style.display = 'none';
  messageFin.className = '';
  actionsExercice.style.display = 'block';
  infoVariation.style.display = 'block';
  commentaireSgf.style.display = 'none';
  gobanWrapper.classList.remove('ordi-pense');
  // On utilise window.t() pour aller chercher la traduction
  infoNom.innerText = window.t
    ? window.t('sequence_en_cours')
    : 'Séquence en cours...';
  infoComment.innerText = window.t
    ? window.t('joue_pour_decouvrir')
    : 'Joue pour découvrir la suite !';
  infoNom.setAttribute('data-sig', '');
  variationCourante = choisirVariation();
  reinitialiserMoteur();
  if (kifu.root.setup)
    for (const s of kifu.root.setup) placerPierreSetup(s.x, s.y, s.c);

  noeudCourant = kifu.root;
  modeExerciceActif = true;
  afficherCommentaire(kifu.root);
  compteurErreurs = 0;
  abandonSequence = false;
  mettreAJourVies();
  afficherTableau();
  verifierTourOrdi();
}

function verifierTourOrdi() {
  if (!modeExerciceActif || !noeudCourant || noeudCourant.children.length === 0)
    return;

  if (noeudCourant.children[0].move.c === couleurOrdi) {
    gobanWrapper.classList.add('ordi-pense');

    /* Délai de base (500ms) quand il n'y a rien à lire */
    let delai = 500;

    /* Si le coup qu'on vient de jouer contient un commentaire, on fait une pause fixe de 1.5 secondes */
    if (noeudCourant.comment && noeudCourant.comment.trim() !== '') {
      delai = 1500;
    }

    /* L'ordinateur patiente avant de jouer son coup */
    setTimeout(jouerCoupOrdi, delai);
  }
}

function jouerCoupOrdi() {
  if (!modeExerciceActif || !noeudCourant || noeudCourant.children.length === 0)
    return;
  gobanWrapper.classList.remove('ordi-pense');
  let enfantChoisi = variationCourante
    ? variationCourante.find((n) => noeudCourant.children.includes(n)) || null
    : null;
  if (!enfantChoisi) enfantChoisi = noeudCourant.children[0];
  if (enfantChoisi.move)
    jouerCoupAvecCaptures(
      enfantChoisi.move.x,
      enfantChoisi.move.y,
      couleurOrdi
    );
  noeudCourant = enfantChoisi;
  afficherCommentaire(noeudCourant);
  if (noeudCourant.children.length === 0) terminerVariation();
}

/* =============================================
   FIN DE VARIATION
============================================= */
function terminerVariation() {
  modeExerciceActif = false;
  actionsExercice.style.display = 'none';
  gobanWrapper.classList.remove('ordi-pense');

  if (abandonSequence) {
    messageFin.className = 'fin-echec';
    finIcone.innerText = '🚨';
    titreFin.innerText = window.t
      ? window.t('fin_echec_titre')
      : 'Séquence ratée';
    sousTitreFin.innerText = window.t
      ? window.t('fin_echec_sous')
      : 'Mieux la prochaine fois';
    afficherToast(
      window.t ? window.t('fin_echec_titre') : 'Séquence ratée',
      'erreur'
    );
  } else if (compteurErreurs > 0) {
    messageFin.className = 'fin-erreurs';
    finIcone.innerText = '😅';
    titreFin.innerText = window.t
      ? window.t('fin_erreurs_titre')
      : 'Terminée avec erreurs';

    /* Gestion du pluriel pour les erreurs */
    sousTitreFin.innerText =
      compteurErreurs === 1
        ? window.t
          ? window.t('toast_erreur_singulier')
          : '1 erreur commise'
        : window.t
          ? window.t('toast_erreur_pluriel', { count: compteurErreurs })
          : `${compteurErreurs} erreurs commises`;

    afficherToast(
      compteurErreurs === 1
        ? window.t
          ? window.t('toast_erreur_singulier')
          : '1 erreur'
        : window.t
          ? window.t('toast_erreur_pluriel', { count: compteurErreurs })
          : `${compteurErreurs} erreurs`,
      'warn'
    );
  } else {
    messageFin.className = 'fin-parfaite';
    finIcone.innerText = '🎉';
    titreFin.innerText = window.t ? window.t('fin_parfait_titre') : 'Perfect !';
    sousTitreFin.innerText = window.t
      ? window.t('fin_parfait_sous')
      : 'Aucune erreur — bien joué';
    afficherToast(
      window.t ? window.t('fin_parfait_titre') : 'Perfect !',
      'correct'
    );
  }
  messageFin.style.display = 'block';

  const varJouee = variationCourante;
  if (varJouee) {
    const sig = genererSignature(varJouee);
    if (abandonSequence) {
      donneesSauvegardees[sig].statut = 'Echec';
    } else if (compteurErreurs > 0) {
      donneesSauvegardees[sig].statut = 'Erreurs';
    } else if (compteurErreurs === 0) {
      donneesSauvegardees[sig].statut = 'Parfait';
    }
    sauvegarderDonnees();
    afficherTableau();
    requestAnimationFrame(() => {
      const activeRow = document.querySelector(
        '#table-variations tbody tr.active-row'
      );
      if (activeRow)
        activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    mettreAJourStatistiques();
    const data = donneesSauvegardees[sig];
    infoNom.innerText = data.nom;
    infoComment.innerText = data.commentaire ? `« ${data.commentaire} »` : '';
    infoNom.setAttribute('data-sig', sig);
  }
  // Sync Supabase
  if (varJouee) sauvegarderVariationServeur(genererSignature(varJouee));
}

/* =============================================
   GESTION DES CLICS JOUEUR
============================================= */
goban.addEventListener('click', function (x, y) {
  if (!modeExerciceActif || !noeudCourant) return;
  if (
    noeudCourant.children.length > 0 &&
    noeudCourant.children[0].move.c !== couleurJoueur
  )
    return;

  const coupValide = noeudCourant.children.find(
    (e) =>
      e.move && e.move.x === x && e.move.y === y && e.move.c === couleurJoueur
  );

  if (coupValide) {
    jouerCoupAvecCaptures(x, y, couleurJoueur);
    noeudCourant = coupValide;

    /* --- CORRECTION DU BUG DE BIFURCATION --- */
    /* Si le coup joué ne fait pas partie de la variation prévue, 
       on met à jour la variation courante pour suivre le choix du joueur ! */
    if (!variationCourante || !variationCourante.includes(noeudCourant)) {
      const variationsPossibles = toutesLesVariations.filter((v) =>
        v.includes(noeudCourant)
      );
      if (variationsPossibles.length > 0) {
        // On recible l'exercice sur l'une des variations qui passe par ce nouveau chemin
        variationCourante =
          variationsPossibles[
            Math.floor(Math.random() * variationsPossibles.length)
          ];
      }
    }
    /* ---------------------------------------- */

    afficherCommentaire(noeudCourant);
    if (noeudCourant.children.length > 0) verifierTourOrdi();
    else terminerVariation();
  } else {
    compteurErreurs++;
    animerPerteVie();
    mettreAJourVies();
    /* Toast du compteur d'erreurs */
    afficherToast(
      window.t
        ? window.t('toast_erreur_compteur', { count: compteurErreurs })
        : `Erreur ${compteurErreurs}/3`,
      'erreur'
    );
    const m = { x, y, type: 'MA' };
    goban.addObject(m);
    setTimeout(() => {
      goban.removeObject(m);
      if (compteurErreurs >= 3 && modeExerciceActif) montrerSolution();
    }, 600);
  }
});

/* =============================================
   SOLUTION ANIMÉE
============================================= */
function montrerSolution() {
  if (!modeExerciceActif) return;
  abandonSequence = true;
  modeExerciceActif = false;
  actionsExercice.style.display = 'none';
  gobanWrapper.classList.remove('ordi-pense');
  compteurSolution = 1;
  enModeSolution = true;
  if (dernierMarqueurCR) {
    goban.removeObject(dernierMarqueurCR);
    dernierMarqueurCR = null;
  }
  animerSolution();
}

function animerSolution() {
  if (noeudCourant && noeudCourant.children.length > 0) {
    let p = variationCourante
      ? variationCourante.find((n) => noeudCourant.children.includes(n))
      : null;
    if (!p) p = noeudCourant.children[0];
    if (p.move) {
      jouerCoupAvecCaptures(p.move.x, p.move.y, p.move.c);
      goban.addObject({
        x: p.move.x,
        y: p.move.y,
        type: 'LB',
        text: compteurSolution.toString(),
      });
      compteurSolution++;
    }
    noeudCourant = p;
    setTimeout(animerSolution, 600);
  } else {
    terminerVariation();
  }
}

/* =============================================
   MODE VISUALISATION
============================================= */
function visualiserVariation(variation) {
  arreterTout();
  goban.removeAllObjects();
  reinitialiserMoteur();
  if (kifu.root.setup)
    for (const s of kifu.root.setup) placerPierreSetup(s.x, s.y, s.c);

  const sig = genererSignature(variation);
  const data = donneesSauvegardees[sig];
  infoVariation.style.display = 'block';
  infoNom.innerText = '👁  ' + data.nom;
  infoComment.innerText = data.commentaire
    ? `« ${data.commentaire} »`
    : window.t
      ? window.t('visualisation_label')
      : 'Visualisation';
  infoNom.setAttribute('data-sig', sig);
  actionsExercice.style.display = 'none';
  messageFin.style.display = 'none';
  enModeSolution = true;

  let compteur = 1,
    index = 0;

  function animer() {
    if (index < variation.length) {
      const noeud = variation[index];
      jouerCoupAvecCaptures(noeud.move.x, noeud.move.y, noeud.move.c);
      goban.addObject({
        x: noeud.move.x,
        y: noeud.move.y,
        type: 'LB',
        text: compteur.toString(),
      });
      compteur++;
      index++;
      timerPresentation = setTimeout(animer, 550);
    } else {
      finIcone.innerText = '👁';
      titreFin.innerText = window.t
        ? window.t('visualisation_titre')
        : 'Visualisation terminée';
      sousTitreFin.innerText = data.nom;
      messageFin.className = 'fin-visu';
      messageFin.style.display = 'block';
    }
  }
  animer();
}

/* =============================================
   ÉCOUTEURS D'ÉVÉNEMENTS
============================================= */

/* Toggle thème */
document.addEventListener('DOMContentLoaded', () => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const btnTheme = document.getElementById('btn-theme');
  btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';

  btnTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('migaki_theme', next);
    btnTheme.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  /* Bouton son */
  const btnSon = document.getElementById('btn-son');
  btnSon.textContent = sonActif ? '🔊' : '🔇';
  if (!sonActif) btnSon.classList.add('mute');

  btnSon.addEventListener('click', () => {
    sonActif = !sonActif;
    localStorage.setItem('fuseki_son', sonActif ? 'on' : 'off');
    btnSon.textContent = sonActif ? '🔊' : '🔇';
    btnSon.classList.toggle('mute', !sonActif);
  });
  const sel = document.getElementById('select-couleur-joueur');

  sel.querySelector('.custom-select-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    sel.classList.toggle('open');
  });

  document.addEventListener('click', () => sel.classList.remove('open'));

  sel.querySelectorAll('.custom-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseInt(opt.dataset.value);
      sel
        .querySelectorAll('.custom-option')
        .forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      sel.dataset.value = opt.dataset.value;
      const isNoir = val === 1;
      sel.querySelector('.stone-icon').className =
        'stone-icon ' + (isNoir ? 'stone-noir' : 'stone-blanc');
      sel.querySelector('.stone-label').textContent = isNoir ? 'Noir' : 'Blanc';
      sel.classList.remove('open');
      couleurJoueur = val;
      couleurOrdi = -val;
      if (kifu) relancerSequence();
    });
  });
});

/* Fichier SGF */
fileInput.addEventListener('change', function () {
  if (this.files.length === 0) return;
  fileNameDisplay.innerText = this.files[0].name;
  const reader = new FileReader();
  reader.onload = (e) =>
    chargerContenuSgf(e.target.result, this.files[0].name, null, null);
  reader.readAsText(this.files[0]);
});

// Chargement SGF depuis Supabase
window.addEventListener('sgf-charge', (e) => {
  const { contenu, nom, sgfId, progression } = e.detail;
  fileNameDisplay.innerText = nom;
  chargerContenuSgf(contenu, nom, sgfId, progression);
});

function chargerContenuSgf(contenu, nom, sgfId, progressionServeur) {
  kifu = WGo.Kifu.fromSgf(contenu);
  toutesLesVariations = [];
  extraireVariations(kifu.root, []);
  chargerDonnees();

  toutesLesVariations.forEach((v, i) => {
    const sig = genererSignature(v);
    if (!donneesSauvegardees[sig])
      donneesSauvegardees[sig] = {
        nom: 'Var ' + (i + 1),
        statut: 'Non exploré',
        commentaire: '',
      };
  });

  // Fusionner avec la progression serveur si dispo
  if (progressionServeur) {
    for (const [sig, data] of Object.entries(progressionServeur)) {
      if (donneesSauvegardees[sig]) {
        donneesSauvegardees[sig].statut =
          data.statut || donneesSauvegardees[sig].statut;
        if (data.nom) donneesSauvegardees[sig].nom = data.nom;
        if (data.commentaire)
          donneesSauvegardees[sig].commentaire = data.commentaire;
      }
    }
  }

  sauvegarderDonnees();
  menuFichier.style.display = 'none';
  colonneDroite.style.display = 'flex';
  infoVariation.style.display = 'block';
  gobanWrapper.style.display = 'flex';

  /* On réactive les boutons d'action */
  btnModePresentation.disabled = false;
  btnReset.disabled = false;

  redimensionnerGoban(calculerTailleGoban());
  afficherTableau();
  mettreAJourStatistiques();
  relancerSequence();
}

btnModePresentation.addEventListener('click', lancerPresentation);
btnQuitterPresentation.addEventListener('click', lancerExercice);
btnSuivante.addEventListener('click', relancerSequence);
btnSolution.addEventListener('click', montrerSolution);

btnReset.addEventListener('click', () => {
  const messageConfirm = window.t
    ? window.t('confirm_reset')
    : 'Réinitialiser tous les statuts ?';
  if (confirm(messageConfirm)) {
    toutesLesVariations.forEach((v) => {
      donneesSauvegardees[genererSignature(v)].statut = 'Non exploré';
    });
    sauvegarderDonnees();
    afficherTableau();
    mettreAJourStatistiques();
  }

  /* =============================================
   MIGRATION LOCALSTORAGE → SUPABASE
============================================= */
  async function migrerLocalStorage() {
    const data = localStorage.getItem('fuseki_data');
    if (!data) return;
    const parsed = JSON.parse(data);
    if (Object.keys(parsed).length === 0) return;

    // Vérifier si déjà migré
    if (localStorage.getItem('fuseki_migrated')) return;

    const sgfId = window._sgfActifId;
    if (!sgfId) return;

    console.log('Migration localStorage → Supabase...');
    for (const [sig, d] of Object.entries(parsed)) {
      window.dispatchEvent(
        new CustomEvent('sauvegarder-variation', {
          detail: {
            sig,
            statut: d.statut,
            nom: d.nom,
            commentaire: d.commentaire || '',
          },
        })
      );
    }
    localStorage.setItem('fuseki_migrated', '1');
    console.log('Migration terminée');
  }
});
