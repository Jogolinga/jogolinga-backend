// ===================================================================
// server.js - SERVEUR COMPLET AVEC FIX AUTHENTIFICATION ADMIN
// ===================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const compression = require('compression');

// Import des services
const authService = require('./services/authService');
const subscriptionService = require('./services/subscriptionService');
const audioService = require('./services/audioService');

const app = express();
const PORT = process.env.PORT || 3001;

console.log('🚀 Démarrage du serveur...');
console.log('🌍 Environment:', process.env.NODE_ENV);
console.log('🔧 Port:', PORT);

// ===================================================================
// VÉRIFICATION DES VARIABLES D'ENVIRONNEMENT
// ===================================================================

const requiredEnvVars = [
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Variables d\'environnement manquantes:', missingVars);
  process.exit(1);
} else {
  console.log('✅ Variables d\'environnement vérifiées');
}

// ===================================================================
// CONFIGURATION CORS
// ===================================================================

const allowedOrigins = [
  'https://jogolinga-frontend.vercel.app',
  'https://jogolinga-frontend-git-main-your-username.vercel.app',
  'https://jogolinga-frontend-preview.vercel.app',
  'https://*.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN
].filter(Boolean);

console.log('🌐 Origins autorisées:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    // Autoriser les requêtes sans origin (applications mobiles, etc.)
    if (!origin) return callback(null, true);
    
    // Vérifier si l'origin est autorisée
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const pattern = allowedOrigin.replace('*', '.*');
        return new RegExp(pattern).test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn('❌ Origin non autorisée:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With'
  ]
};

// ===================================================================
// MIDDLEWARES GLOBAUX
// ===================================================================

// Sécurité
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors(corsOptions));

// Compression
app.use(compression());

// Parsing JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limite chaque IP à 100 requêtes par windowMs
  message: {
    error: 'Trop de requêtes depuis cette IP, réessayez dans 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Rate limiting spécial pour l'authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Trop de tentatives d\'authentification, réessayez dans 15 minutes.'
  }
});

// Middleware de logging pour debug
app.use((req, res, next) => {
  if (req.path.includes('/api/auth')) {
    console.log(`🔍 AUTH REQUEST: ${req.method} ${req.path}`);
    console.log('🔍 Origin:', req.get('Origin'));
    console.log('🔍 User-Agent:', req.get('User-Agent'));
  }
  next();
});

// ===================================================================
// ROUTES DE SANTÉ
// ===================================================================

app.get('/', (req, res) => {
  res.json({
    message: 'Jogolinga Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ===================================================================
// 🔧 ROUTE DE TEST AUTH SERVICE (TEMPORAIRE)
// ===================================================================

app.get('/api/test-auth-service', async (req, res) => {
  try {
    console.log('🧪 Test authService...');
    
    // Test de la méthode
    if (typeof authService.authenticateWithGoogle !== 'function') {
      throw new Error('authService.authenticateWithGoogle n\'est pas une fonction');
    }
    
    console.log('✅ authService.authenticateWithGoogle existe');
    console.log('✅ authService type:', typeof authService);
    console.log('✅ authService methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(authService)));
    
    res.json({
      success: true,
      message: 'authService est correctement configuré',
      hasAuthenticateWithGoogle: typeof authService.authenticateWithGoogle === 'function',
      authServiceType: typeof authService,
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(authService))
    });
    
  } catch (error) {
    console.error('❌ Test authService échoué:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ===================================================================
// ROUTES D'AUTHENTIFICATION
// ===================================================================

// 🔧 ROUTE GOOGLE AUTH CORRIGÉE
app.post('/api/auth/google', authLimiter, [
  body('googleToken').notEmpty().withMessage('Token Google requis'),
  body('googleToken').isLength({ min: 100 }).withMessage('Token Google invalide')
], async (req, res) => {
  try {
    console.log('🔐 Tentative de connexion Google');
    console.log('🌐 Origin de la requête:', req.get('Origin'));
    
    // Validation des entrées
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation échouée:', errors.array());
      return res.status(400).json({ 
        success: false,
        error: 'Données invalides', 
        details: errors.array() 
      });
    }

    const { googleToken } = req.body;
    console.log('🎫 Token Google reçu (longueur):', googleToken.length);
    console.log('🎫 Token Google preview:', googleToken.substring(0, 50) + '...');
    
    // 🔧 FIX PRINCIPAL: Appeler la méthode correctement
    console.log('📞 Appel authService.authenticateWithGoogle...');
    
    if (typeof authService.authenticateWithGoogle !== 'function') {
      console.error('❌ authService.authenticateWithGoogle n\'est pas une fonction');
      throw new Error('Service d\'authentification non disponible');
    }
    
    const result = await authService.authenticateWithGoogle(googleToken);
    
    console.log('✅ Résultat authService reçu:', {
      success: result.success,
      hasToken: !!result.token,
      hasUser: !!result.user,
      userEmail: result.user?.email,
      isAdmin: result.user?.isAdmin
    });

    // 🔧 VALIDATION: S'assurer que le résultat a le bon format
    if (!result || typeof result !== 'object') {
      console.error('❌ Résultat authService invalide (pas un objet):', typeof result);
      throw new Error('Format de réponse invalide');
    }
    
    if (!result.success || !result.token || !result.user) {
      console.error('❌ Format de réponse authService incomplet:', {
        hasSuccess: !!result.success,
        hasToken: !!result.token,
        hasUser: !!result.user
      });
      return res.status(500).json({
        success: false,
        error: 'Erreur interne de format de réponse'
      });
    }
    
    console.log('✅ Connexion Google réussie pour:', result.user.email, result.user.isAdmin ? '(ADMIN)' : '(USER)');
    
    // 🔧 IMPORTANT: Retourner directement le résultat (déjà au bon format)
    res.json(result);
    
  } catch (error) {
    console.error('❌ Erreur authentification complète:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // 🔧 IMPORTANT: Format d'erreur cohérent
    res.status(401).json({ 
      success: false,
      error: 'Authentification échouée',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Vérification de token
app.post('/api/auth/verify', authService.verifyToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

// ===================================================================
// ROUTES D'ABONNEMENT
// ===================================================================

// Vérifier le statut d'abonnement
app.get('/api/subscription/verify', authService.verifyToken, async (req, res) => {
  try {
    const subscription = await subscriptionService.verifyUserSubscription(req.user.id);
    res.json(subscription);
  } catch (error) {
    console.error('❌ Erreur vérification abonnement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Vérifier l'accès à une fonctionnalité
app.post('/api/subscription/check-access', authService.verifyToken, async (req, res) => {
  try {
    const { feature } = req.body;
    const access = await subscriptionService.checkFeatureAccess(req.user.id, feature);
    res.json(access);
  } catch (error) {
    console.error('❌ Erreur vérification accès:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================================================================
// ROUTES DE PAIEMENT
// ===================================================================

// Créer une session de paiement
app.post('/api/payments/create-checkout-session', authService.verifyToken, async (req, res) => {
  try {
    const { planId, priceId } = req.body;
    const userEmail = req.user.email;
    
    const sessionId = await subscriptionService.createCheckoutSession({
      userId: req.user.id,
      userEmail: userEmail,
      planId: planId,
      priceId: priceId
    });
    
    res.json({ sessionId });
  } catch (error) {
    console.error('❌ Erreur création session paiement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Vérifier un paiement
app.get('/api/payments/verify-payment', authService.verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.query;
    const result = await subscriptionService.verifyPayment(sessionId, req.user.id);
    res.json(result);
  } catch (error) {
    console.error('❌ Erreur vérification paiement:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================================================================
// ROUTES ADMIN
// ===================================================================

// Vérifier l'accès admin
app.get('/api/admin/check-access', authService.verifyToken, async (req, res) => {
  try {
    const isAdmin = req.tokenData?.isAdmin || 
                   req.user?.is_admin || 
                   authService.isAdminEmail(req.user?.email);

    console.log(`🔍 Vérification accès admin pour ${req.user?.email}:`, isAdmin);

    res.json({
      isAdmin,
      adminFeatures: isAdmin ? [
        'user_management',
        'subscription_stats', 
        'payment_history',
        'system_config',
        'admin_dashboard'
      ] : [],
      user: {
        email: req.user?.email,
        isAdmin
      }
    });

  } catch (error) {
    console.error('❌ Erreur vérification admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Statistiques admin
app.get('/api/admin/stats', authService.verifyToken, authService.requireAdmin, async (req, res) => {
  try {
    console.log('📊 Récupération statistiques admin par:', req.user.email);

    // Statistiques utilisateurs
    const userStats = await authService.getAuthStats();
    
    // Statistiques abonnements
    const subscriptionStats = await subscriptionService.getSubscriptionStats();

    const stats = {
      users: userStats,
      subscriptions: subscriptionStats,
      system: {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        adminUser: req.user.email
      }
    };

    console.log('✅ Statistiques admin générées pour:', req.user.email);
    res.json(stats);

  } catch (error) {
    console.error('❌ Erreur récupération statistiques admin:', error);
    res.status(500).json({ 
      error: 'Erreur récupération des statistiques',
      details: error.message 
    });
  }
});

// ===================================================================
// ROUTES AUDIO
// ===================================================================

// Rechercher des audios
app.get('/api/audio/search', async (req, res) => {
  try {
    const { languageCode, category, word, sentence, limit, offset } = req.query;
    
    const results = await audioService.searchAudio({
      languageCode,
      category,
      word,
      sentence,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0
    });
    
    res.json(results);
  } catch (error) {
    console.error('❌ Erreur recherche audio:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtenir l'audio d'un mot
app.get('/api/audio/word/:languageCode/:word', async (req, res) => {
  try {
    const { languageCode, word } = req.params;
    const audio = await audioService.getWordAudio(languageCode, word);
    
    if (audio) {
      res.json(audio);
    } else {
      res.status(404).json({ error: 'Audio non trouvé' });
    }
  } catch (error) {
    console.error('❌ Erreur récupération audio mot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Statistiques audio
app.get('/api/audio/stats', async (req, res) => {
  try {
    const stats = await audioService.getAudioStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Erreur statistiques audio:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================================================================
// ROUTES DE PROGRESSION
// ===================================================================

// Sauvegarder la progression
app.post('/api/progress/save', authService.verifyToken, async (req, res) => {
  try {
    const { languageCode, progressData, totalXP, completedCategories } = req.body;
    
    const result = await subscriptionService.saveUserProgress({
      userId: req.user.id,
      languageCode,
      progressData,
      totalXP,
      completedCategories
    });
    
    res.json({ success: result });
  } catch (error) {
    console.error('❌ Erreur sauvegarde progression:', error);
    res.status(500).json({ error: error.message });
  }
});

// Charger la progression
app.get('/api/progress/:languageCode', authService.verifyToken, async (req, res) => {
  try {
    const { languageCode } = req.params;
    
    const progress = await subscriptionService.getUserProgress(req.user.id, languageCode);
    
    if (progress) {
      res.json(progress);
    } else {
      res.status(404).json({ error: 'Progression non trouvée' });
    }
  } catch (error) {
    console.error('❌ Erreur chargement progression:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================================================================
// WEBHOOKS STRIPE
// ===================================================================

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    
    // Validation du webhook Stripe
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    
    console.log('🎣 Webhook Stripe reçu:', event.type);
    
    // Traitement des événements
    switch (event.type) {
      case 'customer.subscription.updated':
        await subscriptionService.handleSubscriptionUpdate(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await subscriptionService.handleSubscriptionCancellation(event.data.object);
        break;
        
      case 'payment_intent.succeeded':
        await subscriptionService.handleSuccessfulPayment(event.data.object);
        break;
        
      default:
        console.log('⚠️ Événement Stripe non géré:', event.type);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('❌ Erreur webhook Stripe:', error);
    res.status(400).json({ error: error.message });
  }
});

// ===================================================================
// GESTION D'ERREURS
// ===================================================================

// Gestionnaire d'erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl,
    method: req.method
  });
});

// Gestionnaire d'erreurs global
app.use((error, req, res, next) => {
  console.error('❌ Erreur serveur:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(error.status || 500).json({
    error: error.message || 'Erreur serveur interne',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Gestion des signaux de fermeture
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM reçu, arrêt du serveur...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT reçu, arrêt du serveur...');
  process.exit(0);
});

// ===================================================================
// DÉMARRAGE DU SERVEUR
// ===================================================================

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log(`🌍 URL de base: http://localhost:${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🧪 Test authService: http://localhost:${PORT}/api/test-auth-service`);
  console.log('📝 Routes disponibles:');
  console.log('   - POST /api/auth/google');
  console.log('   - GET  /api/subscription/verify');
  console.log('   - GET  /api/admin/check-access');
  console.log('   - GET  /api/audio/search');
  console.log('🚀 Serveur prêt !');
});

module.exports = app;
