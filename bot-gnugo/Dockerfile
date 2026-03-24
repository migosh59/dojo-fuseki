# On part d'une image Linux légère avec Node.js préinstallé
FROM node:18-bullseye-slim

# On installe GNU Go depuis les paquets Debian
RUN apt-get update && apt-get install -y gnugo && rm -rf /var/lib/apt/lists/*

# On définit le dossier de travail dans le conteneur
WORKDIR /app

# On copie notre script serveur
COPY server.js .

# On initialise Node et on installe Express et Cors
RUN npm init -y && npm install express cors

# On expose le port 3000 pour pouvoir lui parler
EXPOSE 3000

# La commande qui s'exécutera au démarrage de la boîte
CMD ["node", "server.js"]