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
  /* On récupère tes paramètres (avec des valeurs par défaut au cas où) */
  const handicap = parseInt(req.body.handicap) || 0;
  const komi = parseFloat(req.body.komi) || 6.5;

  /* 1. On nettoie le plateau */
  await envoyerCommandeGTP('boardsize 19');
  await envoyerCommandeGTP('clear_board');

  /* 2. On applique le Komi */
  await envoyerCommandeGTP(`komi ${komi}`);

  /* 3. On applique le Handicap si nécessaire */
  let pierresHandicap = [];
  if (handicap >= 2 && handicap <= 9) {
    const rep = await envoyerCommandeGTP(`fixed_handicap ${handicap}`);
    /* La réponse ressemble à "= D4 Q16 D16", on nettoie pour avoir un tableau ['D4', 'Q16', 'D16'] */
    const points = rep.replace('=', '').trim().split(/\s+/);
    if (points.length > 0 && points[0] !== '') {
      pierresHandicap = points;
    }
  }

  /* On renvoie le feu vert à Migaki avec la liste des pierres placées ! */
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
