const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

/* 🧠 L'HÔTEL DES IA : On stocke un moteur par joueur */
const sessionsIA = new Map();

/* Fonction pour démarrer ou redémarrer une session GNU Go spécifique */
function demarrerGnuGo(sessionId, level = 10, rules = 'japanese') {
  /* 1. Si ce joueur avait déjà une partie en cours, on la ferme proprement */
  if (sessionsIA.has(sessionId)) {
    const oldProcess = sessionsIA.get(sessionId);
    oldProcess.stdout.removeAllListeners('data');
    oldProcess.kill();
  }

  /* 2. On prépare les options */
  const args = ['--mode', 'gtp', '--level', level.toString()];
  if (rules === 'chinese') {
    args.push('--chinese-rules');
  } else {
    args.push('--japanese-rules');
  }

  /* 3. On lance un nouveau moteur et on le stocke avec l'ID du joueur */
  const gnugo = spawn('/usr/games/gnugo', args);
  sessionsIA.set(sessionId, gnugo);

  /* 4. SÉCURITÉ NAS : On tue l'IA après 2 heures d'inactivité pour libérer la RAM */
  setTimeout(
    () => {
      if (sessionsIA.has(sessionId)) {
        sessionsIA.get(sessionId).kill();
        sessionsIA.delete(sessionId);
        console.log(`Session ${sessionId} nettoyée pour inactivité.`);
      }
    },
    2 * 60 * 60 * 1000
  );
}

/* Fonction pour envoyer une commande à une session spécifique */
function envoyerCommandeGTP(sessionId, commande) {
  return new Promise((resolve) => {
    /* On récupère le moteur spécifique à ce joueur ! */
    const gnugo = sessionsIA.get(sessionId);

    if (!gnugo || gnugo.killed) {
      return resolve('? erreur session expiree ou introuvable');
    }

    let reponse = '';
    const onData = (data) => {
      reponse += data.toString();
      if (reponse.endsWith('\n\n')) {
        gnugo.stdout.removeListener('data', onData);
        resolve(reponse.trim());
      }
    };
    gnugo.stdout.on('data', onData);
    gnugo.stdin.write(commande + '\n');
  });
}

/* --- ROUTES API --- */

app.post('/api/reset', async (req, res) => {
  const { sessionId, handicap, komi, size, rules, level } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID manquant' });

  /* On redémarre le moteur à neuf pour cette session spécifique ! */
  demarrerGnuGo(sessionId, parseInt(level) || 10, rules || 'japanese');

  /* 1. On nettoie le plateau ET on applique la taille */
  await envoyerCommandeGTP(sessionId, `boardsize ${size || 19}`);
  await envoyerCommandeGTP(sessionId, 'clear_board');

  /* 2. On applique le Komi */
  await envoyerCommandeGTP(sessionId, `komi ${parseFloat(komi) || 6.5}`);

  /* 3. On applique le Handicap si nécessaire */
  let pierresHandicap = [];
  const h = parseInt(handicap) || 0;
  if (h >= 2 && h <= 9) {
    const rep = await envoyerCommandeGTP(sessionId, `fixed_handicap ${h}`);
    const points = rep.replace('=', '').trim().split(/\s+/);
    if (points.length > 0 && points[0] !== '') {
      pierresHandicap = points;
    }
  }

  res.json({ status: 'ok', handicapStones: pierresHandicap });
});

app.post('/api/play', async (req, res) => {
  const { sessionId, couleurJoueur, coupJoueur } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID manquant' });

  if (coupJoueur !== 'pass') {
    await envoyerCommandeGTP(sessionId, `play ${couleurJoueur} ${coupJoueur}`);
  }

  const couleurBot = couleurJoueur === 'B' ? 'W' : 'B';
  const reponseBot = await envoyerCommandeGTP(sessionId, `genmove ${couleurBot}`);
  const coupBot = reponseBot.replace('=', '').trim();

  res.json({ coup: coupBot });
});

/* --- ROUTE : CALCUL DU SCORE ET CAPTURES --- */
app.post('/api/score', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID manquant' });

  /* 1. Score final (ex: B+10.5) */
  const score = await envoyerCommandeGTP(sessionId, 'final_score');

  /* 2. Pierres capturées par Noir (prisonniers blancs) */
  const capB = await envoyerCommandeGTP(sessionId, 'captures black');

  /* 3. Pierres capturées par Blanc (prisonniers noirs) */
  const capW = await envoyerCommandeGTP(sessionId, 'captures white');

  res.json({
    score: score.replace('=', '').trim(),
    capturesBlack: capB.replace('=', '').trim(),
    capturesWhite: capW.replace('=', '').trim(),
  });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Serveur GNU Go prêt et en écoute sur le port 3000 ! (Mode Multi-Sessions)');
});
