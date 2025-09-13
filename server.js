// ===================================================================
// server.js - SERVEUR PRINCIPAL JOGOLINGA BACKEND
// ===================================================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3001;

// Vérification des variables d'environnement critiques
const requiredEnvVars = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'GOOGLE_CLIENT_ID'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Variable d'environnement manquante: ${varName}`);
    process.exit(1);
  }
});

console.log('✅ Variables d\'environnement vérifiées');

// Services
const authService = require('./services/authService');
const subscriptionService = require('./services/subscriptionService');
const audioService = require('./services/audioService');

// ===================================================================
// MIDDLEWARE DE SÉCURITÉ
// ===================================================================

// Protection générale
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://*.supabase.co"]
    }
  }
}));

// CORS sécurisé - VERSION CORRIGÉE
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://localhost:3000',
  'https://jogolinga-frontend.vercel.app',
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN
].filter(Boolean);

console.log('🔧 CORS - Origines autorisées:', allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    // Permettre les requêtes sans origin (mobile apps, postman, etc.)
    if (!origin) {
      console.log('🔓 CORS: Requête sans origin (autorisée)');
      return callback(null, true);
    }
    
    console.log('🔍 CORS: Origin reçue:', origin);
    
    if (allowedOrigins.includes(origin)) {
      console.log('✅ CORS: Origin acceptée:', origin);
      callback(null, true);
    } else {
      console.warn(`❌ CORS: Origine rejetée: ${origin}`);
      console.log('📋 CORS: Origines autorisées:', allowedOrigins);
      callback(new Error('Non autorisé par CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

// Middleware pour les preflight requests
app.options('*', (req, res) => {
  console.log('🔄 CORS: Preflight request pour:', req.path);
  res.sendStatus(200);
});

// Rate limiting global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting strict pour authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Augmenté de 5 à 10 pour les tests
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' }
});

app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);

// Middleware général
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===================================================================
// ROUTES DE SANTÉ
// ===================================================================

// Health check basique
app.get('/api/health', (req, res) => {
  console.log('🩺 Health check demandé');
  res.json({
    status: 'OK',
    message: 'JogoLinga Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()),
    version: '1.0.0'
  });
});

// Status détaillé (pour monitoring)
app.get('/api/status', async (req, res) => {
  try {
    console.log('📊 Status détaillé demandé');
    const status = {
      server: 'healthy',
      database: await subscriptionService.checkDatabaseHealth(),
      supabase: !!process.env.SUPABASE_URL,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      google: !!process.env.GOOGLE_CLIENT_ID,
      cors: allowedOrigins,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime())
    };
    
    res.json(status);
  } catch (error) {
    console.error('❌ Erreur status:', error);
    res.status(500).json({ 
      error: 'Erreur de status',
      timestamp: new Date().toISOString()
    });
  }
});

// ===================================================================
// ROUTES D'AUTHENTIFICATION
// ===================================================================

// Connexion Google
app.post('/api/auth/google', [
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
        error: 'Données invalides', 
        details: errors.array() 
      });
    }

    const { googleToken } = req.body;
    console.log('🎫 Token Google reçu (longueur):', googleToken.length);
    
    const result = await authService.authenticateWithGoogle(googleToken);
    
    console.log('✅ Connexion Google réussie pour:', result.user.email);
    
    res.json({
      success: true,
      token: result.jwtToken,
      user: result.user
    });
  } catch (error) {
    console.error('❌ Erreur authentification:', error.message);
    res.status(401).json({ 
      error: 'Authentification échouée',
      message: 'Token Google invalide ou expiré',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Vérification du token JWT
app.get('/api/auth/verify', authService.verifyToken, (req, res) => {
  console.log('✅ Token JWT vérifié pour:', req.user.email);
  res.json({
    valid: true,
    user: req.user
  });
});

// Déconnexion
app.post('/api/auth/logout', authService.verifyToken, (req, res) => {
  console.log('🚪 Déconnexion utilisateur:', req.user.email);
  res.json({ success: true, message: 'Déconnecté avec succès' });
});

// ===================================================================
// ROUTES D'ABONNEMENT SÉCURISÉES
// ===================================================================

// Vérifier l'abonnement actuel
app.get('/api/subscription/verify', authService.verifyToken, async (req, res) => {
  try {
    console.log('🔍 Vérification abonnement pour:', req.user.email);
    const subscription = await subscriptionService.verifyUserSubscription(req.user.id);
    res.json(subscription);
  } catch (error) {
    console.error('❌ Erreur vérification abonnement:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la vérification' });
  }
});

// Vérifier l'accès à une fonctionnalité
app.post('/api/subscription/check-access', [
  authService.verifyToken,
  body('feature').notEmpty().withMessage('Feature requis')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: errors.array() 
      });
    }

    const { feature } = req.body;
    console.log(`🔑 Vérification accès feature "${feature}" pour:`, req.user.email);
    
    const access = await subscriptionService.checkFeatureAccess(req.user.id, feature);
    res.json(access);
  } catch (error) {
    console.error('❌ Erreur vérification accès:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ===================================================================
// ROUTES DE PAIEMENT STRIPE (SÉCURISÉES)
// ===================================================================

// Créer une session de checkout
app.post('/api/payments/create-checkout-session', [
  authService.verifyToken,
  body('planId').notEmpty().withMessage('Plan ID requis'),
  body('priceId').notEmpty().withMessage('Price ID requis')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Données invalides', 
        details: errors.array() 
      });
    }

    const { planId, priceId } = req.body;
    console.log(`💳 Création session Stripe pour ${req.user.email}, plan: ${planId}`);

    const sessionId = await subscriptionService.createCheckoutSession({
      userId: req.user.id,
      userEmail: req.user.email,
      planId,
      priceId,
      successUrl: `${process.env.FRONTEND_URL}/payment-success`,
      cancelUrl: `${process.env.FRONTEND_URL}/subscription`
    });

    console.log('✅ Session Stripe créée:', sessionId);
    res.json({ sessionId });
  } catch (error) {
    console.error('❌ Erreur création session:', error);
    res.status(500).json({ error: 'Impossible de créer la session de paiement' });
  }
});

// Vérifier un paiement
app.get('/api/payments/verify-payment', authService.verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.query;
    console.log(`💰 Vérification paiement session: ${sessionId}`);
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID requis' });
    }

    const result = await subscriptionService.verifyPayment(sessionId, req.user.id);
    console.log('✅ Paiement vérifié:', result.status);
    res.json(result);
  } catch (error) {
    console.error('❌ Erreur vérification paiement:', error);
    res.status(500).json({ error: 'Erreur lors de la vérification du paiement' });
  }
});

// ===================================================================
// ROUTES AUDIO SÉCURISÉES
// ===================================================================

// Rechercher des audios
app.post('/api/audio/search', [
  authService.verifyToken,
  body('languageCode').optional().isLength({ min: 2, max: 3 }),
  body('category').optional().isLength({ min: 1, max: 50 }),
  body('word').optional().isLength({ min: 1, max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Paramètres de recherche invalides', 
        details: errors.array() 
      });
    }

    const { languageCode, category, word } = req.body;
    console.log(`🎵 Recherche audio: ${languageCode}/${category}/${word || 'all'}`);
    
    const results = await audioService.searchAudio({ languageCode, category, word });
    
    console.log(`✅ Trouvé ${results.length} audios`);
    res.json({ results });
  } catch (error) {
    console.error('❌ Erreur recherche audio:', error);
    res.status(500).json({ error: 'Erreur lors de la recherche audio' });
  }
});

// Statistiques audio
app.get('/api/audio/stats', authService.verifyToken, async (req, res) => {
  try {
    console.log('📊 Récupération statistiques audio');
    const stats = await audioService.getAudioStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Erreur statistiques audio:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

// ===================================================================
// ROUTES DE PROGRESSION UTILISATEUR
// ===================================================================

// Sauvegarder la progression
app.post('/api/progress/save', [
  authService.verifyToken,
  body('languageCode').notEmpty().withMessage('Code langue requis'),
  body('progressData').isObject().withMessage('Données de progression requises')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Données de progression invalides', 
        details: errors.array() 
      });
    }

    const { languageCode, progressData, totalXP, completedCategories } = req.body;
    console.log(`💾 Sauvegarde progression ${languageCode} pour:`, req.user.email);
    
    const result = await subscriptionService.saveUserProgress({
      userId: req.user.id,
      languageCode,
      progressData,
      totalXP: totalXP || 0,
      completedCategories: completedCategories || []
    });

    console.log('✅ Progression sauvegardée');
    res.json({ 
      success: true, 
      saved: true,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Erreur sauvegarde progression:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// Charger la progression
app.get('/api/progress/:languageCode', authService.verifyToken, async (req, res) => {
  try {
    const { languageCode } = req.params;
    
    if (!languageCode || languageCode.length < 2) {
      return res.status(400).json({ error: 'Code langue invalide' });
    }

    console.log(`📂 Chargement progression ${languageCode} pour:`, req.user.email);
    const progress = await subscriptionService.getUserProgress(req.user.id, languageCode);
    res.json(progress || null);
  } catch (error) {
    console.error('❌ Erreur chargement progression:', error);
    res.status(500).json({ error: 'Erreur lors du chargement' });
  }
});

// ===================================================================
// ROUTE DE TEST POUR DEBUG CORS
// ===================================================================

// Route de test simple pour debug CORS
app.get('/api/test', (req, res) => {
  console.log('🧪 Route de test appelée');
  console.log('🌐 Origin:', req.get('Origin'));
  console.log('🔍 Headers:', req.headers);
  
  res.json({
    message: 'Test CORS réussi !',
    origin: req.get('Origin'),
    timestamp: new Date().toISOString(),
    headers: req.headers
  });
});

// ===================================================================
// WEBHOOKS STRIPE (sans authentification)
// ===================================================================

// Webhook Stripe (endpoint raw pour signature)
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    console.log('🪝 Webhook Stripe reçu');
    
    // Vérification signature Stripe
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('❌ Signature webhook invalide:', err.message);
      return res.status(400).send(`Webhook signature error: ${err.message}`);
    }

    // Traiter l'événement
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('💳 Paiement complété:', event.data.object.id);
        // Traiter le paiement
        break;
      case 'customer.subscription.updated':
        console.log('🔄 Abonnement mis à jour:', event.data.object.id);
        await subscriptionService.handleSubscriptionUpdate(event.data.object);
        break;
      case 'customer.subscription.deleted':
        console.log('❌ Abonnement annulé:', event.data.object.id);
        await subscriptionService.handleSubscriptionCancellation(event.data.object);
        break;
      default:
        console.log(`⚠️ Événement webhook non géré: ${event.type}`);
    }

    res.json({received: true});
  } catch (error) {
    console.error('❌ Erreur webhook:', error);
    res.status(500).json({error: 'Erreur traitement webhook'});
  }
});

// ===================================================================
// ROUTES 404 ET GESTION D'ERREURS
// ===================================================================

// 404 Handler
app.use((req, res) => {
  console.log(`❓ Route non trouvée: ${req.method} ${req.path} depuis ${req.get('Origin')}`);
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'GET /api/health',
      'GET /api/status', 
      'POST /api/auth/google',
      'GET /api/auth/verify',
      'GET /api/test'
    ]
  });
});

// Error Handler Global
app.use((error, req, res, next) => {
  console.error('💥 Erreur serveur:', error.message);
  console.error('📍 Stack:', error.stack);
  
  // CORS errors
  if (error.message.includes('CORS')) {
    console.error('🚫 Erreur CORS détectée pour origin:', req.get('Origin'));
    return res.status(403).json({
      error: 'Accès CORS refusé',
      message: 'Origine non autorisée',
      origin: req.get('Origin'),
      allowedOrigins: allowedOrigins
    });
  }
  
  // Ne pas exposer les détails d'erreur en production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(error.status || 500).json({
    error: 'Erreur interne du serveur',
    message: isDevelopment ? error.message : 'Une erreur est survenue',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: error.stack })
  });
});

// ===================================================================
// DÉMARRAGE DU SERVEUR
// ===================================================================

const server = app.listen(PORT, () => {
  console.log('\n🚀 ===================================');
  console.log('🎵 JogoLinga Backend démarré !');
  console.log('🚀 ===================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡ Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configuré' : '❌ Manquant'}`);
  console.log(`🗄️  Supabase: ${process.env.SUPABASE_URL ? '✅ Configuré' : '❌ Manquant'}`);
  console.log(`🔑 JWT: ${process.env.JWT_SECRET ? '✅ Configuré' : '❌ Manquant'}`);
  console.log(`🔐 Google: ${process.env.GOOGLE_CLIENT_ID ? '✅ Configuré' : '❌ Manquant'}`);
  console.log(`🌐 CORS Origins:`, allowedOrigins);
  console.log(`🎯 Frontend URL: ${process.env.FRONTEND_URL || 'Non défini'}`);
  console.log('=====================================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
