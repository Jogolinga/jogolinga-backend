// ===================================================================
// services/authService.js - SERVICE D'AUTHENTIFICATION BACKEND SÉCURISÉ
// ===================================================================


const ADMIN_EMAILS = [
  'badji.denany@gmail.com'
];

const isAdminEmail = (email) => {
  return ADMIN_EMAILS.includes(email?.toLowerCase());
};

console.log('👑 Configuration Admin Backend - Emails autorisés:', ADMIN_EMAILS);

// 🔧 DANS LA CLASSE AuthService, MODIFIER LA MÉTHODE authenticateWithGoogle
// Trouvez votre méthode existante et remplacez la section après "// 3. Générer le JWT" par :

// 3. 🆕 NOUVEAU: Vérifier si c'est un admin et configurer Premium automatiquement
const isAdmin = isAdminEmail(user.email);

if (isAdmin) {
  console.log('👑 Admin détecté, configuration Premium automatique pour:', user.email);
  await this.setupAdminPremiumSubscription(user);
}

// 4. Générer le JWT avec statut admin
const jwtToken = jwt.sign(
  { 
    userId: user.id, 
    email: user.email,
    googleId: user.google_id,
    isAdmin: isAdmin, // 🔧 IMPORTANT: Inclure le statut admin
    iat: Math.floor(Date.now() / 1000)
  },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

console.log('✅ Authentification réussie:', user.email, isAdmin ? '(ADMIN)' : '(USER)');

return {
  success: true,
  token: jwtToken,
  user: {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    isAdmin: isAdmin, // 🔧 IMPORTANT: Inclure dans la réponse
    createdAt: user.created_at,
    lastLogin: user.last_login || new Date().toISOString()
  }
};

// 🆕 AJOUTER CETTE NOUVELLE MÉTHODE DANS LA CLASSE AuthService
async setupAdminPremiumSubscription(user) {
  try {
    console.log('👑 Configuration abonnement Premium admin pour:', user.email);

    // Chercher un abonnement existant
    let { data: existingSubscription, error: findError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const adminSubscriptionData = {
      user_id: user.id,
      tier: 'premium',
      status: 'active',
      plan_id: 'premium_admin',
      billing_period: 'permanent',
      starts_at: new Date().toISOString(),
      expires_at: null, // Pas d'expiration pour les admins
      payment_id: 'admin_premium_permanent',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (findError && findError.code !== 'PGRST116') {
      console.error('❌ Erreur recherche abonnement:', findError);
      // Continuer quand même, on va créer l'abonnement
    }

    if (!existingSubscription || findError) {
      // Créer un nouvel abonnement admin
      const { data: newSubscription, error: createError } = await supabase
        .from('subscriptions')
        .insert([adminSubscriptionData])
        .select()
        .single();

      if (createError) {
        console.error('❌ Erreur création abonnement admin:', createError);
        // Si la table n'existe pas, créer quand même localement
        return;
      }

      console.log('✅ Abonnement Premium Admin créé:', newSubscription.plan_id);
    } else {
      // Mettre à jour l'abonnement existant
      const { data: updatedSubscription, error: updateError } = await supabase
        .from('subscriptions')
        .update({
          tier: 'premium',
          status: 'active',
          plan_id: 'premium_admin',
          billing_period: 'permanent',
          expires_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingSubscription.id)
        .select()
        .single();

      if (updateError) {
        console.error('❌ Erreur mise à jour abonnement admin:', updateError);
        return;
      }

      console.log('✅ Abonnement mis à jour vers Premium Admin:', updatedSubscription.plan_id);
    }

  } catch (error) {
    console.error('❌ Erreur configuration abonnement admin:', error);
    // Ne pas faire échouer l'authentification si l'abonnement échoue
  }
}

// 🔧 AJOUTER MIDDLEWARE ADMIN (à la fin de la classe)
static requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    const isAdmin = req.tokenData?.isAdmin || 
                   req.user?.is_admin || 
                   isAdminEmail(req.user?.email);

    if (!isAdmin) {
      return res.status(403).json({ 
        error: 'Accès administrateur requis',
        userEmail: req.user.email 
      });
    }

    console.log('✅ Accès admin autorisé pour:', req.user.email);
    req.isAdmin = true;
    next();
  } catch (error) {
    console.error('❌ Erreur vérification admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');

// Initialisation Supabase avec service key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY preview:", process.env.SUPABASE_SERVICE_KEY?.substring(0,10) + "...");


// Client Google OAuth
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class AuthService {
  constructor() {
    console.log('🔐 AuthService backend initialisé');
    
    // Debug des variables d'environnement
    console.log('🔍 Configuration Auth Service:', {
      hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasJwtSecret: !!process.env.JWT_SECRET,
      googleClientIdPreview: process.env.GOOGLE_CLIENT_ID ? 
        process.env.GOOGLE_CLIENT_ID.substring(0, 20) + '...' : 'MISSING'
    });
    
    // Vérifications de configuration
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET non configuré');
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error('GOOGLE_CLIENT_ID non configuré');
    }
    if (!process.env.SUPABASE_URL) {
      throw new Error('SUPABASE_URL non configuré');
    }
  }

  // ===================================================================
  // AUTHENTIFICATION AVEC GOOGLE (LA FONCTION MANQUANTE)
  // ===================================================================
  async authenticateWithGoogle(googleToken) {
    try {
      console.log('🔍 Vérification token Google...');
      console.log('Token reçu (preview):', googleToken.substring(0, 50) + '...');
      
      // 1. Vérifier le token Google avec tolérance
      const ticket = await googleClient.verifyIdToken({
        idToken: googleToken,
        audience: process.env.GOOGLE_CLIENT_ID,
        clockTolerance: 60 // 60 secondes de tolérance pour l'horloge
      });
      
      const googleUser = ticket.getPayload();
      if (!googleUser) {
        throw new Error('Token Google invalide - payload vide');
      }

      console.log('✅ Payload Google reçu:', {
        sub: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
        aud: googleUser.aud,
        iss: googleUser.iss,
        exp: new Date(googleUser.exp * 1000),
        iat: new Date(googleUser.iat * 1000)
      });

      // 2. Chercher l'utilisateur existant
      console.log('🔍 Recherche utilisateur en base...');
      let { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('google_id', googleUser.sub)
        .single();

      let user;
      
      if (fetchError && fetchError.code === 'PGRST116') {
        // Utilisateur n'existe pas, le créer
        console.log('👤 Création nouvel utilisateur:', googleUser.email);
        
        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert([{
            google_id: googleUser.sub,
            email: googleUser.email,
            name: googleUser.name,
            picture: googleUser.picture,
            created_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (createError) {
          console.error('❌ Erreur création utilisateur:', createError);
          throw new Error('Impossible de créer l\'utilisateur: ' + createError.message);
        }

        // Créer abonnement gratuit par défaut
        const { error: subscriptionError } = await supabase
          .from('subscriptions')
          .insert([{
            user_id: newUser.id,
            tier: 'free',
            status: 'active',
            created_at: new Date().toISOString()
          }]);

        if (subscriptionError) {
          console.warn('⚠️ Erreur création abonnement (non critique):', subscriptionError);
        }

        user = newUser;
        console.log('✅ Utilisateur créé avec abonnement gratuit');
        
      } else if (fetchError) {
        console.error('❌ Erreur récupération utilisateur:', fetchError);
        throw new Error('Erreur base de données: ' + fetchError.message);
      } else {
        // Utilisateur existe, mettre à jour les infos
        console.log('🔄 Mise à jour utilisateur existant:', existingUser.email);
        
        const { data: updatedUser, error: updateError } = await supabase
          .from('users')
          .update({
            name: googleUser.name,
            picture: googleUser.picture,
            last_login: new Date().toISOString()
          })
          .eq('id', existingUser.id)
          .select()
          .single();

        if (updateError) {
          console.error('❌ Erreur mise à jour utilisateur:', updateError);
          // Continuer avec les données existantes
          user = existingUser;
        } else {
          user = updatedUser;
        }
      }

      // 3. Générer JWT
      console.log('🎫 Génération JWT...');
      const jwtToken = jwt.sign(
        { 
          userId: user.id, 
          email: user.email,
          googleId: user.google_id,
          iat: Math.floor(Date.now() / 1000)
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' } // Token valide 7 jours
      );

      console.log('✅ JWT généré pour:', user.email);

      return {
        jwtToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          createdAt: user.created_at,
          lastLogin: user.last_login || user.created_at
        }
      };
      
    } catch (error) {
      console.error('❌ Erreur authentification Google:', error);
      
      // Erreurs spécifiques Google
      if (error.message.includes('Token used too early')) {
        throw new Error('Token Google utilisé trop tôt, réessayez dans quelques secondes');
      }
      if (error.message.includes('Invalid token signature')) {
        throw new Error('Signature du token Google invalide');
      }
      if (error.message.includes('Wrong number of segments')) {
        throw new Error('Format du token Google invalide');
      }
      if (error.message.includes('audience')) {
        throw new Error('Client ID Google invalide');
      }
      
      throw new Error('Authentification échouée: ' + error.message);
    }
  }

  // ===================================================================
  // MIDDLEWARE DE VÉRIFICATION JWT
  // ===================================================================
  verifyToken = async (req, res, next) => {
    try {
      // 1. Extraire le token
      const authHeader = req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Token d\'authentification requis',
          code: 'NO_TOKEN'
        });
      }

      const token = authHeader.replace('Bearer ', '');
      
      // 2. Vérifier le JWT
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        if (jwtError.name === 'TokenExpiredError') {
          return res.status(401).json({ 
            error: 'Token expiré, reconnectez-vous',
            code: 'TOKEN_EXPIRED'
          });
        }
        if (jwtError.name === 'JsonWebTokenError') {
          return res.status(401).json({ 
            error: 'Token invalide',
            code: 'INVALID_TOKEN'
          });
        }
        throw jwtError;
      }
      
      // 3. Vérifier que l'utilisateur existe toujours
      const { data: user, error } = await supabase
        .from('users')
        .select('id, email, name, picture, created_at, last_login')
        .eq('id', decoded.userId)
        .single();

      if (error || !user) {
        return res.status(401).json({ 
          error: 'Utilisateur non trouvé',
          code: 'USER_NOT_FOUND'
        });
      }

      // 4. Ajouter les infos utilisateur à la requête
      req.user = user;
      req.tokenData = decoded;
      
      next();
    } catch (error) {
      console.error('❌ Erreur vérification token:', error);
      res.status(401).json({ 
        error: 'Token invalide',
        code: 'TOKEN_ERROR'
      });
    }
  }

  // ===================================================================
  // UTILITAIRES
  // ===================================================================

  // Obtenir un utilisateur par ID
  async getUserById(userId) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('❌ Erreur récupération utilisateur:', error);
        return null;
      }
      
      return user;
    } catch (error) {
      console.error('❌ Erreur getUserById:', error);
      return null;
    }
  }

  // Mettre à jour le profil utilisateur
  async updateUserProfile(userId, profileData) {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          ...profileData,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur mise à jour profil:', error);
        throw error;
      }
      
      console.log('✅ Profil mis à jour pour:', data.email);
      return data;
    } catch (error) {
      console.error('❌ Erreur updateUserProfile:', error);
      throw error;
    }
  }

  // Générer un nouveau JWT pour un utilisateur
  async generateNewToken(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('Utilisateur non trouvé');
      }

      const jwtToken = jwt.sign(
        { 
          userId: user.id, 
          email: user.email,
          googleId: user.google_id,
          iat: Math.floor(Date.now() / 1000)
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return jwtToken;
    } catch (error) {
      console.error('❌ Erreur génération token:', error);
      throw error;
    }
  }

  // Vérifier si un token est valide (sans middleware)
  async isTokenValid(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await this.getUserById(decoded.userId);
      return !!user;
    } catch (error) {
      return false;
    }
  }

  // Test de connexion Supabase
  async testSupabaseConnection() {
    try {
      console.log('🔍 Test connexion Supabase...');
      const { data, error } = await supabase
        .from('users')
        .select('count')
        .limit(1);
      
      if (error) {
        console.error('❌ Erreur connexion Supabase:', error.message);
        return false;
      } else {
        console.log('✅ Connexion Supabase OK');
        return true;
      }
    } catch (err) {
      console.error('❌ Supabase inaccessible:', err.message);
      return false;
    }
  }

  // Obtenir les statistiques d'authentification
 // Remplacer la méthode getAuthStats() dans authService.js par :

async getAuthStats() {
  try {
    // CORRECTION: Récupérer les données utilisateurs
    const { data: users, error, count } = await supabase
      .from('users')
      .select('created_at, last_login', { count: 'exact' });

    if (error) {
      console.error('❌ Erreur récupération statistiques:', error.message);
      return {
        totalUsers: 0,
        newUsersToday: 0,
        newUsersThisWeek: 0,
        newUsersThisMonth: 0,
        activeUsersToday: 0,
        activeUsersThisWeek: 0
      };
    }

    console.log('✅ Statistiques récupérées, total users:', count);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    return {
      totalUsers: count || 0,
      newUsersToday: users ? users.filter(u => new Date(u.created_at) >= today).length : 0,
      newUsersThisWeek: users ? users.filter(u => new Date(u.created_at) >= thisWeek).length : 0,
      newUsersThisMonth: users ? users.filter(u => new Date(u.created_at) >= thisMonth).length : 0,
      activeUsersToday: users ? users.filter(u => u.last_login && new Date(u.last_login) >= today).length : 0,
      activeUsersThisWeek: users ? users.filter(u => u.last_login && new Date(u.last_login) >= thisWeek).length : 0
    };
  } catch (error) {
    console.error('❌ Erreur statistiques auth:', error);
    return {
      totalUsers: 0,
      newUsersToday: 0,
      newUsersThisWeek: 0,
      newUsersThisMonth: 0,
      activeUsersToday: 0,
      activeUsersThisWeek: 0
    };
  }
}
}

// Export singleton
const authService = new AuthService();

// Test de connexion au démarrage
authService.testSupabaseConnection();

module.exports = {
  ...module.exports, // Garder les exports existants
  isAdminEmail,
  requireAdmin: AuthService.requireAdmin
};

module.exports = authService;
