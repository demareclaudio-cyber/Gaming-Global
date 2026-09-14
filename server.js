const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

const ADMIN_EMAIL = "Demareclaudio@gmail.com";
const GOOGLE_CLIENT_ID = "1015792719046-lh3aihi3ha0tbcjt6h1jrj2vjgohhqd5.apps.googleusercontent.com";
const googleAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_FILE = path.join(__dirname, 'config_plataforma.json');
const DATA_FILE = path.join(__dirname, 'datos_chat.json');

function initPlatformConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            const initialConfig = {
                tmdb_api_key: process.env.TMDB_KEY || '3afb09305f5df52b80137e5ce2455858',
                omdb_api_key: process.env.OMDB_KEY || '861e019d',
                monetag_url: 'https://omg10.com/4/11446133',
                servers: [
                    { id: "sv_1", name: "Servidor Latino (LatAm)", domain: "vidsrc.icu" },
                    { id: "sv_2", name: "PelisLatino HD", domain: "embed.rgshows.me" },
                    { id: "sv_3", name: "Castellano / Latino", domain: "vidsrc.su" },
                    { id: "sv_4", name: "Stream Español", domain: "PLAYER.CUEVANA.BIZ" },
                    { id: "sv_5", name: "Multi-Audio Server", domain: "2embed.cc" },
                    { id: "sv_6", name: "VidSrc To (Español Latino/ES)", domain: "vidsrc.to" },
                    { id: "sv_7", name: "VidSrc Net (Español)", domain: "vidsrc.net" },
                    { id: "sv_8", name: "VidSrc Pro", domain: "vidsrc.pro" },
                    { id: "sv_9", name: "Embed Su", domain: "vidsrcme.su" }
                ]
            };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), 'utf8');
        }
    } catch (err) {
        console.error('Error al inicializar config_plataforma.json:', err.message);
    }
}

function getPlatformConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            initPlatformConfig();
        }
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.tmdb_api_key = process.env.TMDB_KEY || parsed.tmdb_api_key;
        parsed.omdb_api_key = process.env.OMDB_KEY || parsed.omdb_api_key;
        return parsed;
    } catch (err) {
        return {
            tmdb_api_key: '3afb09305f5df52b80137e5ce2455858',
            omdb_api_key: '861e019d',
            servers: [
                { id: "sv_1", name: "Servidor Latino (LatAm)", domain: "vidsrc.icu" },
                { id: "sv_2", name: "PelisLatino HD", domain: "embed.rgshows.me" },
                { id: "sv_3", name: "Castellano / Latino", domain: "vidsrc.su" },
                { id: "sv_4", name: "Stream Español", domain: "PLAYER.CUEVANA.BIZ" },
                { id: "sv_5", name: "Multi-Audio Server", domain: "2embed.cc" },
                { id: "sv_6", name: "VidSrc To", domain: "vidsrc.to" },
                { id: "sv_7", name: "VidSrc Net", domain: "vidsrc.net" },
                { id: "sv_8", name: "VidSrc Pro", domain: "vidsrc.pro" },
                { id: "sv_9", name: "Embed Su", domain: "vidsrcme.su" }
            ]
        };
    }
}

function initLocalStorageFiles() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const initialData = {
                messages: [],
                ratings: {},
                reports: [],
                permissions: { globalWriteAllowed: true }
            };
            fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        }
    } catch (err) {
        console.error('Error al inicializar datos del chat:', err.message);
    }
}

function readLocalStorageData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            initLocalStorageFiles();
        }
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        return { messages: [], ratings: {}, reports: [], permissions: { globalWriteAllowed: true } };
    }
}

function writeLocalStorageData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Error al escribir datos locales:', err.message);
    }
}

initPlatformConfig();
initLocalStorageFiles();

const apiCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedData(key) {
    if (apiCache.has(key)) {
        const cached = apiCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
        apiCache.delete(key);
    }
    return null;
}

function setCachedData(key, data) {
    apiCache.set(key, { data, timestamp: Date.now() });
    if (apiCache.size > 5000) {
        const firstKey = apiCache.keys().next().value;
        apiCache.delete(firstKey);
    }
}

app.get('/api/init', (req, res) => {
    const config = getPlatformConfig();
    const anonymousServers = config.servers.map(s => ({
        id: s.id,
        name: s.name
    }));
    res.json({ servers: anonymousServers });
});

app.get('/api/stream', (req, res) => {
    const { serverId, id, type, season, episode } = req.query;
    const config = getPlatformConfig();
    const serverObj = config.servers.find(s => s.id === serverId) || config.servers[0];

    let streamUrl = "";
    const sDomain = serverObj.domain || "vidsrc.to";

    // Configuración universal con soporte para servidores en español y respaldos
    if (type === 'tv') {
        const s = season || 1;
        const ep = episode || 1;
        if (sDomain.includes('2embed')) {
            streamUrl = `https://${sDomain}/embed/tv/${id}/${s}/${ep}?lang=es&audio=latino`;
        } else if (sDomain.includes('cuevana') || sDomain.includes('rgshows')) {
            streamUrl = `https://${sDomain}/video/${id}/${s}/${ep}`;
        } else if (sDomain.includes('vidsrc')) {
            streamUrl = `https://${sDomain}/embed/tv/${id}/${s}/${ep}?lang=es&ds_lang=es`;
        } else {
            streamUrl = `https://${sDomain}/embed/tv/${id}/${s}/${ep}?ds_lang=es&lang=es`;
        }
    } else {
        if (sDomain.includes('2embed')) {
            streamUrl = `https://${sDomain}/embed/movie/${id}?lang=es&audio=latino`;
        } else if (sDomain.includes('cuevana') || sDomain.includes('rgshows')) {
            streamUrl = `https://${sDomain}/video/${id}`;
        } else if (sDomain.includes('vidsrc')) {
            streamUrl = `https://${sDomain}/embed/movie/${id}?lang=es&ds_lang=es`;
        } else {
            streamUrl = `https://${sDomain}/embed/movie/${id}?ds_lang=es&lang=es`;
        }
    }

    res.json({ url: streamUrl });
});

app.get('/api/admin/config', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    try {
        const ticket = await googleAuthClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();

        if (payload.email && payload.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
            const config = getPlatformConfig();
            return res.json({ success: true, config });
        } else {
            return res.status(403).json({ error: 'Acceso no autorizado. Se requiere rol de Administrador.' });
        }
    } catch (err) {
        return res.status(401).json({ error: 'Token de Google inválido o expirado.', details: err.message });
    }
});

app.get('/api/proxy/*', async (req, res) => {
    const endpoint = req.params[0];
    const cacheKey = `${endpoint}_${JSON.stringify(req.query)}`;
  
    const cached = getCachedData(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    const config = getPlatformConfig();

    try {
        const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, {
            params: {
                ...req.query,
                api_key: config.tmdb_api_key,
                language: req.query.language || 'es-ES'
            },
            timeout: 10000
        });

        setCachedData(cacheKey, response.data);
        return res.json(response.data);
    } catch (error) {
        console.warn('TMDB Timeout o error de red, activando respaldo OMDb:', error.message);
        try {
            const queryTitle = req.query.query || req.query.title || 'movie';
            const omdbRes = await axios.get(`https://www.omdbapi.com/?apikey=${config.omdb_api_key}&t=${encodeURIComponent(queryTitle)}`, { timeout: 5000 });
         
            if (omdbRes.data && omdbRes.data.Response === 'True') {
                const transformed = {
                    results: [{
                        id: 999999,
                        title: omdbRes.data.Title,
                        name: omdbRes.data.Title,
                        overview: omdbRes.data.Plot,
                        poster_path: omdbRes.data.Poster !== 'N/A' ? omdbRes.data.Poster : null,
                        media_type: 'movie'
                    }]
                };
                setCachedData(cacheKey, transformed);
                return res.json(transformed);
            }
        } catch (omdbErr) {
            console.error('Error crítico en OMDb Backup:', omdbErr.message);
        }

        return res.status(500).json({
            error: 'Error al conectar con la API de TMDB y respaldo OMDb.',
            details: error.message
        });
    }
});

io.on('connection', (socket) => {
    const clientToken = socket.handshake.auth && socket.handshake.auth.token;
    let userEmail = "";

    if (clientToken && clientToken.includes('@')) {
        userEmail = clientToken;
    }

    const currentData = readLocalStorageData();
    socket.emit('chat_history', currentData.messages);
    socket.emit('admin_alert', { message: 'Conectado al servidor seguro de Mini Netflix', writeAllowed: currentData.permissions.globalWriteAllowed });

    socket.on('send_message', (data) => {
        try {
            const dataStorage = readLocalStorageData();
            if (!dataStorage.permissions.globalWriteAllowed && userEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
                return socket.emit('admin_alert', { message: 'El administrador ha bloqueado la escritura global.' });
            }

            if (!data || !data.text) return;
            const sanitizedText = String(data.text).substring(0, 200);
            const sanitizedUser = String(data.user || 'Usuario').substring(0, 50);

            const newMessage = { user: sanitizedUser, text: sanitizedText, timestamp: Date.now() };
         
            dataStorage.messages.push(newMessage);
            if (dataStorage.messages.length > 200) {
                dataStorage.messages.shift();
            }

            writeLocalStorageData(dataStorage);
            io.emit('new_message', newMessage);
        } catch (err) {
            console.error('Error al procesar mensaje de chat:', err.message);
        }
    });

    socket.on('disconnect', () => {
        socket.removeAllListeners();
    });
});

server.listen(PORT, () => {
    console.log(`Servidor de Mini Netflix corriendo en el puerto ${PORT}`);
});

 
