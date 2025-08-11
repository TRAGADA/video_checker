const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration CORS
app.use(cors());
app.use(express.json());

// Servir les fichiers statiques (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Configuration Multer pour gérer les uploads en mémoire
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 150 * 1024 * 1024 // 150MB max
    },
    fileFilter: (req, file, cb) => {
        // Vérifier les types de fichiers autorisés
        const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
        const allowedExtensions = ['.mp4', '.mov', '.avi'];
        const fileExtension = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error('Type de fichier non supporté'), false);
        }
    }
});

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route pour analyser les vidéos
app.post('/analyze-video', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier vidéo fourni' });
    }

    // Créer un fichier temporaire unique en mémoire
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.${getFileExtension(req.file.originalname)}`;
    const tempFilePath = path.join(__dirname, 'temp', tempFileName);
    
    try {
        // Créer le dossier temp s'il n'existe pas
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Écrire temporairement le fichier pour FFmpeg
        fs.writeFileSync(tempFilePath, req.file.buffer);

        // Analyser la vidéo avec FFmpeg
        const videoInfo = await analyzeVideoWithFFmpeg(tempFilePath);
        
        // Supprimer immédiatement le fichier temporaire
        fs.unlinkSync(tempFilePath);
        console.log(`✅ Temporary file deleted: ${tempFileName}`);
        
        // Ajouter les informations du fichier
        const fullVideoInfo = {
            ...videoInfo,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype
        };

        // Valider selon les critères du concours
        const validationResults = validateVideoSpecs(fullVideoInfo);

        res.json({
            success: true,
            videoInfo: fullVideoInfo,
            validation: validationResults
        });

    } catch (error) {
        // S'assurer que le fichier temp est supprimé même en cas d'erreur
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`🗑️ Temporary file cleaned up after error: ${tempFileName}`);
        }
        
        console.error('Erreur analyse vidéo:', error);
        res.status(500).json({ 
            error: 'Erreur lors de l\'analyse de la vidéo',
            details: error.message 
        });
    }
});

// Fonction pour analyser la vidéo avec FFmpeg
function analyzeVideoWithFFmpeg(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(new Error(`Erreur FFprobe: ${err.message}`));
                return;
            }

            try {
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                
                if (!videoStream) {
                    reject(new Error('Aucun flux vidéo trouvé'));
                    return;
                }

                // Extraction des métadonnées précises
                const duration = parseFloat(metadata.format.duration);
                const frameRate = eval(videoStream.r_frame_rate); // Conversion de "24/1" vers 24
                const frameCount = parseInt(videoStream.nb_frames) || Math.round(duration * frameRate);
                
                const videoInfo = {
                    duration: Math.round(duration * 100) / 100, // Arrondi à 2 décimales
                    width: videoStream.width,
                    height: videoStream.height,
                    frameRate: Math.round(frameRate * 100) / 100, // Frame rate exact
                    frameCount: frameCount, // Nombre exact de frames
                    codec: videoStream.codec_name,
                    profile: videoStream.profile || null,
                    bitRate: parseInt(metadata.format.bit_rate) || null,
                    format: metadata.format.format_name
                };

                resolve(videoInfo);
            } catch (parseError) {
                reject(new Error(`Erreur parsing métadonnées: ${parseError.message}`));
            }
        });
    });
}

// Fonction de validation selon les critères du concours
function validateVideoSpecs(videoInfo) {
    const criteria = {
        resolutions: [
            { width: 1920, height: 810 },
            { width: 3840, height: 1620 }
        ],
        frameRate: 24,
        frameCount: 144,
        duration: 6,
        maxFileSize: 100 * 1024 * 1024, // 100MB
        allowedFormats: ['mp4', 'mov', 'quicktime'],
        allowedCodecs: ['h264', 'hevc', 'h265']
    };

    const results = {
        fileSize: {
            valid: videoInfo.fileSize <= criteria.maxFileSize,
            value: formatFileSize(videoInfo.fileSize),
            requirement: "< 100MB",
            exact: true
        },
        format: {
            valid: criteria.allowedFormats.some(format => 
                videoInfo.format.toLowerCase().includes(format) ||
                videoInfo.mimeType.includes(format)
            ),
            value: getFormatName(videoInfo.format, videoInfo.mimeType),
            requirement: "MP4 or MOV",
            exact: true
        },
        resolution: {
            valid: criteria.resolutions.some(res => 
                res.width === videoInfo.width && res.height === videoInfo.height
            ),
            value: `${videoInfo.width}×${videoInfo.height}`,
            requirement: "1920×810 or 3840×1620",
            exact: true
        },
        frameRate: {
            valid: Math.abs(videoInfo.frameRate - criteria.frameRate) <= 0.1,
            value: `${videoInfo.frameRate} fps`,
            requirement: "24 fps",
            exact: true
        },
        frameCount: {
            valid: Math.abs(videoInfo.frameCount - criteria.frameCount) <= 2,
            value: videoInfo.frameCount,
            requirement: "144 frames",
            exact: true
        },
        codec: {
            valid: criteria.allowedCodecs.some(codec => {
                const lowerVideoCodec = videoInfo.codec.toLowerCase();
                const lowerCriteriaCodec = codec.toLowerCase();
                const isValid = lowerVideoCodec.includes(lowerCriteriaCodec) || 
                               lowerVideoCodec.includes('avc') ||  // H.264 alternative name
                               lowerVideoCodec.includes('hevc');  // H.265 alternative name
                
                console.log(`🔍 Codec validation: "${videoInfo.codec}" -> ${isValid ? 'VALID' : 'INVALID'}`);
                return isValid;
            }),
            value: getCodecName(videoInfo.codec),
            requirement: "H.264 or H.265",
            exact: true
        }
    };

    // Calcul du résultat global
    results.overall = Object.keys(results).every(key => 
        key === 'overall' || results[key].valid
    );

    return results;
}

// Fonctions utilitaires
function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFormatName(format, mimeType) {
    if (format.toLowerCase().includes('mp4') || mimeType.includes('mp4')) return 'MP4';
    if (format.toLowerCase().includes('mov') || format.toLowerCase().includes('quicktime') || mimeType.includes('quicktime')) return 'MOV';
    return format.toUpperCase();
}

function getCodecName(codec) {
    const codecMap = {
        'h264': 'H.264',
        'avc': 'H.264',
        'avc1': 'H.264',
        'hevc': 'H.265',
        'h265': 'H.265',
        'hev1': 'H.265',
        'hvc1': 'H.265'
    };
    
    const lowerCodec = codec.toLowerCase();
    for (const [key, value] of Object.entries(codecMap)) {
        if (lowerCodec.includes(key)) return value;
    }
    return codec.toUpperCase();
}

// Nettoyage périodique du dossier temp (au cas où)
setInterval(() => {
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            
            // Supprimer les fichiers de plus de 5 minutes
            if (now - stats.mtime.getTime() > 5 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log(`Fichier temporaire supprimé: ${file}`);
            }
        });
    }
}, 60000); // Vérification chaque minute

// Gestionnaire d'erreur pour multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Fichier trop volumineux (max 150MB)' });
        }
    }
    res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
    console.log(`🎬 Serveur de vérification vidéo démarré sur http://localhost:${PORT}`);
    console.log(`📁 Dossier de travail: ${__dirname}`);
    console.log(`🔧 Assurez-vous que FFmpeg est installé sur le système`);
});

module.exports = app;
