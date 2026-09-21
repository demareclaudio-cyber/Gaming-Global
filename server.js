/**
* Gaming Global - Servidor Unificado con Caché RAM (TTL 12h) y Sincronización Dual TMDb / OMDb
*/
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Caché en RAM con TTL de 12 horas (43200 segundos) para acelerar solicitudes y proteger cuotas
const mediaCache = new NodeCache({ stdTTL: 43200, checkperiod: 600 });

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "Demareclaudio@gmail.com";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'datos_chat.json');
const CONFIG_FILE = path.join(__dirname, 'config_plataforma.json');
const VERIFIED_LANG_FILE = path.join(__dirname, 'verified_languages.json');

function initLocalStorageFiles() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const initialData = {
                messages: [],
                ratings: {},
                reports: [],
                progress: {},
                permissions: { globalWriteAllowed: true }
            };
            fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        }
        if (!fs.existsSync(VERIFIED_LANG_FILE)) {
            fs.writeFileSync(VERIFIED_LANG_FILE, JSON.stringify({}, null, 2), 'utf8');
        }
    } catch (err) {}
}

function readLocalStorageData() {
    try {
        if (!fs.existsSync(DATA_FILE)) initLocalStorageFiles();
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        return { messages: [], ratings: [], reports: [], progress: {}, permissions: { globalWriteAllowed: true } };
    }
}

function writeLocalStorageData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {}
}

function loadProxyConfig() {
    let fileServers = [];
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            fileServers = parsed.servidores || parsed.servers || [];
        }
    } catch (e) {}

    return {
        tmdb_api_key: process.env.TMDB_API_KEY || "",
        omdb_api_key: process.env.OMDB_API_KEY || "",
        tmdb_bearer_token: process.env.TMDB_BEARER_TOKEN || "",
        servers: fileServers
    };
}

initLocalStorageFiles();

app.get('/api/init', (req, res) => {
    try {
        const config = loadProxyConfig();
        let verifiedLangs = {};
        try {
            if (fs.existsSync(VERIFIED_LANG_FILE)) {
                verifiedLangs = JSON.parse(fs.readFileSync(VERIFIED_LANG_FILE, 'utf8'));
            }
        } catch(e) {}
        res.json({ servers: config.servers || [], verifiedLangs });
    } catch (e) {
        res.json({ servers: [], verifiedLangs: {} });
    }
});

app.post('/api/admin/test-mirror', async (req, res) => {
    const { mirrorUrl } = req.body;
    if (!mirrorUrl) return res.json({ success: false, active: false });
    try {
        const response = await axios.get(mirrorUrl, {
            timeout: 3000,
            validateStatus: () => true,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (response.status >= 200 && response.status < 500) {
            return res.json({ success: true, active: true });
        }
        return res.json({ success: true, active: false });
    } catch (err) {
        return res.json({ success: true, active: false });
    }
});

app.get('/api/admin/config', (req, res) => {
    try {
        const config = loadProxyConfig();
        res.json({ success: true, config: { servers: config.servers } });
    } catch(e) {
        res.status(500).json({ success: false, error: 'No se pudo cargar la configuración.' });
    }
});

app.post('/api/admin/config', (req, res) => {
    try {
        const { servers } = req.body;
        if (!servers || !Array.isArray(servers)) {
            return res.status(400).json({ success: false, error: 'Formato de servidores inválido.' });
        }
        let currentData = {};
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                currentData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            }
        } catch(err) {}

        currentData.servidores = servers;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentData, null, 2), 'utf8');
        mediaCache.flushAll();
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, error: 'Error al guardar la configuración.' });
    }
});

app.post('/api/admin/verify-lang', (req, res) => {
    try {
        const { itemId, isSpanishReady } = req.body;
        if (!itemId) return res.status(400).json({ success: false, error: 'ID inválido.' });
       
        let verifiedLangs = {};
        try {
            if (fs.existsSync(VERIFIED_LANG_FILE)) {
                verifiedLangs = JSON.parse(fs.readFileSync(VERIFIED_LANG_FILE, 'utf8'));
            }
        } catch(e) {}

        verifiedLangs[itemId] = isSpanishReady;
        fs.writeFileSync(VERIFIED_LANG_FILE, JSON.stringify(verifiedLangs, null, 2), 'utf8');
        io.emit('lang_sync_update', { itemId, isSpanishReady });
        res.json({ success: true, verifiedLangs });
    } catch(e) {
        res.status(500).json({ success: false, error: 'Error al actualizar idioma.' });
    }
});

app.get('/api/admin/status-check', async (req, res) => {
    const config = loadProxyConfig();
    let tmdbStatus = { active: false, message: 'Fallo de conexión o API Key ausente' };
    let omdbStatus = { active: false, message: 'Fallo de conexión o API Key ausente' };

    if (config.tmdb_api_key) {
        try {
            const tmdbRes = await axios.get('https://api.themoviedb.org/3/configuration', {
                params: { api_key: config.tmdb_api_key },
                timeout: 5000
            });
            if (tmdbRes.status === 200) tmdbStatus = { active: true, message: 'Conectado y Operativo' };
        } catch (e) {}
    }

    if (config.omdb_api_key) {
        try {
            const omdbRes = await axios.get(`https://www.omdbapi.com/?apikey=${config.omdb_api_key}&i=tt3896198`, {
                timeout: 5000
            });
            if (omdbRes.status === 200 && omdbRes.data.Response === 'True') {
                omdbStatus = { active: true, message: 'Conectado y Operativo' };
            }
        } catch (e) {}
    }

    res.json({ tmdb: tmdbStatus, omdb: omdbStatus });
});

app.get('/api/proxy/*', async (req, res) => {
    const endpoint = req.params[0];
    const cacheKey = `proxy_${endpoint}_${JSON.stringify(req.query)}`;

    if (mediaCache.has(cacheKey)) {
        return res.json(mediaCache.get(cacheKey));
    }

    try {
        const config = loadProxyConfig();
        if (!config.tmdb_api_key) {
            return res.status(500).json({ error: 'API Key de TMDb no configurada en el servidor.' });
        }

        const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, {
            params: { ...req.query, api_key: config.tmdb_api_key, language: req.query.language || 'es-MX' },
            timeout: 30000
        });

        let responseData = tmdbResponse.data;

        if (endpoint.startsWith('movie/') || endpoint.startsWith('tv/')) {
            let imdbId = responseData.imdb_id;

            if (!imdbId && endpoint.startsWith('tv/')) {
                const parts = endpoint.split('/');
                const tvId = parts[1];
                if (tvId) {
                    try {
                        const extRes = await axios.get(`https://api.themoviedb.org/3/tv/${tvId}/external_ids`, {
                            params: { api_key: config.tmdb_api_key },
                            timeout: 5000
                        });
                        if (extRes.data && extRes.data.imdb_id) {
                            imdbId = extRes.data.imdb_id;
                            responseData.imdb_id = imdbId;
                        }
                    } catch (err) {}
                }
            }

            if (imdbId && config.omdb_api_key) {
                try {
                    const omdbRes = await axios.get(`https://www.omdbapi.com/`, {
                        params: { apikey: config.omdb_api_key, i: imdbId },
                        timeout: 4000
                    });
                    if (omdbRes.data && omdbRes.data.Response === 'True') {
                        responseData.omdb_rating = omdbRes.data.imdbRating || "N/A";
                        responseData.omdb_votes = omdbRes.data.imdbVotes || "N/A";
                        responseData.omdb_awards = omdbRes.data.Awards || "N/A";
                    } else {
                        responseData.omdb_rating = "N/A";
                    }
                } catch (omdbErr) {
                    responseData.omdb_rating = "N/A";
                }
            } else {
                responseData.omdb_rating = "N/A";
            }
        }

        mediaCache.set(cacheKey, responseData);
        return res.json(responseData);
    } catch (error) {
        return res.status(500).json({ error: 'Error al conectar con la API de TMDb.' });
    }
});

app.get('/api/omdb/*', async (req, res) => {
    try {
        const config = loadProxyConfig();
        if (!config.omdb_api_key) {
            return res.status(200).json({ Response: "False", Error: "OMDb Key ausente" });
        }
        const response = await axios.get(`https://www.omdbapi.com/`, {
            params: { ...req.query, apikey: config.omdb_api_key },
            timeout: 5000
        });
        return res.json(response.data);
    } catch (error) {
        return res.status(200).json({ Response: "False", Error: "Inactiva" });
    }
});

io.on('connection', (socket) => {
    const currentData = readLocalStorageData();
    socket.emit('chat_history', currentData.messages);
    socket.emit('admin_alert', { message: 'Conectado a Gaming Global', writeAllowed: currentData.permissions.globalWriteAllowed });

    socket.on('send_message', (data) => {
        const dataStorage = readLocalStorageData();
        if (!data || !data.text) return;
        const newMessage = { user: String(data.user || 'Usuario'), text: String(data.text).substring(0, 200), timestamp: Date.now() };
        dataStorage.messages.push(newMessage);
        if (dataStorage.messages.length > 200) dataStorage.messages.shift();
        writeLocalStorageData(dataStorage);
        io.emit('new_message', newMessage);
    });

    socket.on('sync_progress_cloud', (data) => {
        if (!data || !data.userId || !data.itemId) return;
        const dataStorage = readLocalStorageData();
        if (!dataStorage.progress) dataStorage.progress = {};
        if (!dataStorage.progress[data.userId]) dataStorage.progress[data.userId] = {};
       
        dataStorage.progress[data.userId][data.itemId] = {
            currentTime: data.currentTime,
            duration: data.duration,
            season: data.season || 1,
            episode: data.episode || 1,
            updatedAt: Date.now()
        };
        writeLocalStorageData(dataStorage);
    });

    socket.on('get_progress_cloud', (data) => {
        if (!data || !data.userId) return;
        const dataStorage = readLocalStorageData();
        const userProgress = (dataStorage.progress && dataStorage.progress[data.userId]) || {};
        socket.emit('user_progress_sync', userProgress);
    });

    socket.on('admin_toggle_write', (data) => {
        const dataStorage = readLocalStorageData();
        dataStorage.permissions.globalWriteAllowed = data.writeAllowed;
        writeLocalStorageData(dataStorage);
        io.emit('admin_alert', { type: 'permission_change', writeAllowed: data.writeAllowed, message: data.writeAllowed ? 'El administrador habilitó la escritura en el chat.' : 'El administrador bloqueó temporalmente el chat.' });
    });
});

server.listen(PORT, () => {
    console.log(`Gaming Global Servidor operando en el puerto ${PORT}`);
});

 
