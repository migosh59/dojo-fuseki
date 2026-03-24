const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

/* On lance GNU Go en tâche de fond */
/* Note: Adapte le chemin si nécessaire, par exemple 'gnugo' ou '/usr/games/gnugo' selon ton conteneur */
const gnugo = spawn('/usr/games/gnugo', ['--mode', 'gtp', '--level', '10']);

function envoyerCommandeGTP(commande) {
  return new Promise((resolve) => {
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
  const handicap = parseInt(req.body.handicap) || 0;
  const komi = parseFloat(req.body.komi) || 6.5;
  const size = parseInt(req.body.size) || 19; /* NOUVEAU : Récupération de la taille */

  /* 1. On nettoie le plateau ET on applique la taille */
  await envoyerCommandeGTP(`boardsize ${size}`);
  await envoyerCommandeGTP('clear_board');

  /* 2. On applique le Komi */
  await envoyerCommandeGTP(`komi ${komi}`);

  /* 3. On applique le Handicap si nécessaire */
  let pierresHandicap = [];
  if (handicap >= 2 && handicap <= 9) {
    const rep = await envoyerCommandeGTP(`fixed_handicap ${handicap}`);
    const points = rep.replace('=', '').trim().split(/\s+/);
    if (points.length > 0 && points[0] !== '') {
      pierresHandicap = points;
    }
  }

  res.json({ status: 'ok', handicapStones: pierresHandicap });
});

app.post('/api/play', async (req, res) => {
  const { couleurJoueur, coupJoueur } = req.body;

  if (coupJoueur !== 'pass') {
    await envoyerCommandeGTP(`play ${couleurJoueur} ${coupJoueur}`);
  }

  const couleurBot = couleurJoueur === 'B' ? 'W' : 'B';
  const reponseBot = await envoyerCommandeGTP(`genmove ${couleurBot}`);
  const coupBot = reponseBot.replace('=', '').trim();

  res.json({ coup: coupBot });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Serveur GNU Go prêt et en écoute sur le port 3000 !');
});

/* --- NOUVELLE ROUTE : CALCUL DU SCORE ET CAPTURES --- */
app.post('/api/score', async (req, res) => {
  /* 1. Score final (ex: B+10.5) */
  const score = await envoyerCommandeGTP('final_score');

  /* 2. Pierres capturées par Noir (prisonniers blancs) */
  const capB = await envoyerCommandeGTP('captures black');

  /* 3. Pierres capturées par Blanc (prisonniers noirs) */
  const capW = await envoyerCommandeGTP('captures white');

  res.json({
    score: score.replace('=', '').trim(),
    capturesBlack: capB.replace('=', '').trim(),
    capturesWhite: capW.replace('=', '').trim(),
  });
});
