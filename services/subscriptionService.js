// ===================================================================
// services/subscriptionService.js - SERVICE D'ABONNEMENTS SÉCURISÉ
// ===================================================================
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialisation Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class SubscriptionService {
  constructor() {
    console.log('💳 SubscriptionService initialisé');
    
    // Définition des fonctionnalités premium
    this.premiumFeatures = [
      'grammar_full',
      'sentence_construction',
      'sentence_gap',
      'exercise_unlimited',
      'offline_mode',
      'google_drive_sync',
      'advanced_stats',
      'custom_audio_upload',
      'priority_support'
    ];

    // Vérifications de configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn('⚠️ STRIPE_SECRET_KEY non configuré');
    }
    if (!process.env.SUPABASE_URL) {
      throw new Error('SUPABASE_URL non configuré');
    }
  }

  // ===================================================================
  // VÉRIFICATION D'ABONNEMENT
  // ===================================================================
  async verifyUserSubscription(userId) {
    try {
      console.log('🔍 Vérification abonnement pour userId:', userId);
      
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .single();

      // Pas d'abonnement trouvé = utilisateur gratuit
      if (error && error.code === 'PGRST116') {
        console.log('📝 Aucun abonnement trouvé, création d\'un abonnement gratuit');
        
        // Créer un abonnement gratuit par défaut
        await supabase
          .from('subscriptions')
          .insert([{
            user_id: userId,
            tier: 'free',
            status: 'active',
            created_at: new Date().toISOString()
          }]);

        return {
          isPremium: false,
          tier: 'free',
          status: 'active',
          expiresAt: null,
          billingPeriod: null,
          planId: 'free_plan'
        };
      }

      if (error) {
        console.error('❌ Erreur récupération abonnement:', error);
        throw error;
      }

      // Vérifier l'expiration
      let isActive = subscription.status === 'active';
      if (subscription.expires_at && new Date() > new Date(subscription.expires_at)) {
        isActive = false;
        console.log('⏰ Abonnement expiré');
      }

      // Si abonnement Stripe, vérifier côté Stripe
      if (subscription.stripe_subscription_id && isActive) {
        try {
          console.log('🔄 Vérification Stripe pour:', subscription.stripe_subscription_id);
          
          const stripeSubscription = await stripe.subscriptions.retrieve(
            subscription.stripe_subscription_id
          );
          
          const stripeIsActive = ['active', 'trialing'].includes(stripeSubscription.status);
          
          // Mettre à jour en base si statut différent
          if (isActive !== stripeIsActive) {
            console.log('🔄 Mise à jour statut depuis Stripe:', stripeIsActive);
            
            await supabase
              .from('subscriptions')
              .update({
                status: stripeIsActive ? 'active' : 'cancelled',
                expires_at: stripeIsActive ? 
                  new Date(stripeSubscription.current_period_end * 1000).toISOString() : 
                  new Date().toISOString()
              })
              .eq('user_id', userId);
          }
          
          isActive = stripeIsActive;
        } catch (stripeError) {
          console.error('⚠️ Erreur vérification Stripe:', stripeError.message);
          // Continuer avec les données locales en cas d'erreur Stripe
        }
      }

      const result = {
        isPremium: isActive && subscription.tier === 'premium',
        tier: isActive ? subscription.tier : 'free',
        status: isActive ? 'active' : 'expired',
        expiresAt: subscription.expires_at,
        billingPeriod: subscription.billing_period,
        planId: subscription.plan_id || (subscription.tier === 'premium' ? 'premium_plan' : 'free_plan'),
        stripeSubscriptionId: subscription.stripe_subscription_id
      };

      console.log('✅ Statut abonnement:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Erreur verifyUserSubscription:', error);
      
      // Retourner un abonnement gratuit en cas d'erreur
      return {
        isPremium: false,
        tier: 'free',
        status: 'active',
        expiresAt: null,
        billingPeriod: null,
        planId: 'free_plan'
      };
    }
  }

  // ===================================================================
  // VÉRIFICATION D'ACCÈS AUX FONCTIONNALITÉS
  // ===================================================================
  async checkFeatureAccess(userId, feature) {
    try {
      console.log(`🔑 Vérification accès feature "${feature}" pour userId:`, userId);
      
      const subscription = await this.verifyUserSubscription(userId);
      const hasAccess = !this.premiumFeatures.includes(feature) || subscription.isPremium;

      const result = {
        hasAccess,
        isPremium: subscription.isPremium,
        tier: subscription.tier,
        feature,
        reason: !hasAccess ? 'Cette fonctionnalité nécessite un abonnement Premium' : null,
        expiresAt: subscription.expiresAt
      };

      console.log('✅ Résultat accès:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Erreur checkFeatureAccess:', error);
      return {
        hasAccess: false,
        isPremium: false,
        tier: 'free',
        feature,
        reason: 'Erreur lors de la vérification des permissions'
      };
    }
  }

  // Middleware pour les fonctionnalités Premium
  requirePremium = async (req, res, next) => {
    try {
      const access = await this.checkFeatureAccess(req.user.id, 'premium_required');
      
      if (!access.hasAccess) {
        return res.status(403).json({
          error: 'Accès Premium requis',
          message: 'Cette fonctionnalité nécessite un abonnement Premium',
          currentTier: access.tier,
          upgradeUrl: `${process.env.FRONTEND_URL}/subscription`
        });
      }
      
      next();
    } catch (error) {
      console.error('❌ Erreur middleware Premium:', error);
      res.status(500).json({ error: 'Erreur de vérification des permissions' });
    }
  }

  // ===================================================================
  // GESTION STRIPE
  // ===================================================================

  // Créer une session de paiement Stripe
  async createCheckoutSession({ userId, userEmail, planId, priceId, successUrl, cancelUrl }) {
    try {
      console.log(`💳 Création session Stripe pour userId: ${userId}, planId: ${planId}`);
      
      // Vérifier que l'utilisateur existe
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        throw new Error('Utilisateur non trouvé');
      }

      // Créer la session Stripe
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price: priceId,
          quantity: 1,
        }],
        mode: 'subscription',
        success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
        customer_email: userEmail,
        client_reference_id: userId,
        metadata: {
          userId: userId,
          planId: planId
        },
        subscription_data: {
          metadata: {
            userId: userId,
            planId: planId
          }
        },
        allow_promotion_codes: true,
        billing_address_collection: 'required',
      });

      console.log('✅ Session Stripe créée:', session.id);
      return session.id;
      
    } catch (error) {
      console.error('❌ Erreur création session Stripe:', error);
      throw new Error('Impossible de créer la session de paiement: ' + error.message);
    }
  }

  // Vérifier un paiement
  async verifyPayment(sessionId, userId) {
    try {
      console.log(`💰 Vérification paiement sessionId: ${sessionId}, userId: ${userId}`);
      
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer']
      });

      // Vérifier que la session appartient bien à cet utilisateur
      if (session.client_reference_id !== userId) {
        throw new Error('Session non autorisée pour cet utilisateur');
      }

      if (session.payment_status === 'paid') {
        console.log('✅ Paiement confirmé');
        
        // Mettre à jour l'abonnement en base
        if (session.mode === 'subscription' && session.subscription) {
          const stripeSubscription = typeof session.subscription === 'string' 
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription;

          await this.updateUserSubscription(userId, {
            stripeCustomerId: session.customer.id || session.customer,
            stripeSubscriptionId: stripeSubscription.id,
            tier: 'premium',
            status: 'active',
            expiresAt: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
            planId: session.metadata?.planId || 'premium_plan',
            billingPeriod: stripeSubscription.items.data[0]?.price?.recurring?.interval || 'monthly'
          });

          console.log('✅ Abonnement mis à jour en base');
        }

        return {
          status: 'completed',
          planId: session.metadata?.planId,
          subscriptionId: session.subscription?.id || session.subscription,
          customerEmail: session.customer_email,
          amountTotal: session.amount_total ? session.amount_total / 100 : null
        };
      }

      return {
        status: 'pending',
        paymentStatus: session.payment_status,
        message: 'Paiement en attente de confirmation'
      };
      
    } catch (error) {
      console.error('❌ Erreur vérification paiement:', error);
      throw new Error('Erreur lors de la vérification du paiement: ' + error.message);
    }
  }

  // Mettre à jour l'abonnement utilisateur
  async updateUserSubscription(userId, subscriptionData) {
    try {
      console.log('🔄 Mise à jour abonnement pour userId:', userId);
      
      const { data, error } = await supabase
        .from('subscriptions')
        .upsert([{
          user_id: userId,
          stripe_customer_id: subscriptionData.stripeCustomerId,
          stripe_subscription_id: subscriptionData.stripeSubscriptionId,
          tier: subscriptionData.tier,
          status: subscriptionData.status,
          expires_at: subscriptionData.expiresAt,
          plan_id: subscriptionData.planId,
          billing_period: subscriptionData.billingPeriod,
          updated_at: new Date().toISOString()
        }], {
          onConflict: 'user_id'
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur mise à jour abonnement:', error);
        throw error;
      }
      
      console.log('✅ Abonnement mis à jour:', data);
      return data;
    } catch (error) {
      console.error('❌ Erreur updateUserSubscription:', error);
      throw error;
    }
  }

  // ===================================================================
  // GESTION PROGRESSION UTILISATEUR
  // ===================================================================

  // Sauvegarder la progression utilisateur
  async saveUserProgress({ userId, languageCode, progressData, totalXP, completedCategories }) {
    try {
      console.log(`💾 Sauvegarde progression ${languageCode} pour userId: ${userId}`);
      
      const { data, error } = await supabase
        .from('user_progress')
        .upsert([{
          user_id: userId,
          language_code: languageCode,
          progress_data: progressData,
          total_xp: totalXP || 0,
          completed_categories: completedCategories || [],
          last_synced: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }], {
          onConflict: 'user_id,language_code'
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur sauvegarde progression:', error);
        throw error;
      }
      
      console.log('✅ Progression sauvegardée');
      return data;
    } catch (error) {
      console.error('❌ Erreur saveUserProgress:', error);
      throw error;
    }
  }

  // Récupérer la progression utilisateur
  async getUserProgress(userId, languageCode) {
    try {
      console.log(`📂 Chargement progression ${languageCode} pour userId: ${userId}`);
      
      const { data, error } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('language_code', languageCode)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('❌ Erreur récupération progression:', error);
        throw error;
      }

      if (error && error.code === 'PGRST116') {
        console.log('📝 Aucune progression trouvée');
        return null;
      }
      
      console.log('✅ Progression chargée');
      return data;
    } catch (error) {
      console.error('❌ Erreur getUserProgress:', error);
      return null;
    }
  }

  // ===================================================================
  // WEBHOOKS STRIPE
  // ===================================================================

  // Gérer les mises à jour d'abonnement
  async handleSubscriptionUpdate(subscription) {
    try {
      const userId = subscription.metadata?.userId;
      if (!userId) {
        console.error('❌ UserId manquant dans les métadonnées Stripe');
        return;
      }

      console.log('🔄 Webhook: Mise à jour abonnement pour userId:', userId);

      await this.updateUserSubscription(userId, {
        stripeSubscriptionId: subscription.id,
        tier: 'premium',
        status: subscription.status === 'active' ? 'active' : 'cancelled',
        expiresAt: new Date(subscription.current_period_end * 1000).toISOString(),
        billingPeriod: subscription.items.data[0]?.price?.recurring?.interval || 'monthly',
        planId: subscription.metadata?.planId || 'premium_plan'
      });

      console.log('✅ Webhook: Abonnement mis à jour');
    } catch (error) {
      console.error('❌ Erreur webhook subscription update:', error);
    }
  }

  // Gérer l'annulation d'abonnement
  async handleSubscriptionCancellation(subscription) {
    try {
      const userId = subscription.metadata?.userId;
      if (!userId) {
        console.error('❌ UserId manquant pour annulation');
        return;
      }

      console.log('🚫 Webhook: Annulation abonnement pour userId:', userId);

      await supabase
        .from('subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('stripe_subscription_id', subscription.id);

      console.log('✅ Webhook: Abonnement annulé');
    } catch (error) {
      console.error('❌ Erreur webhook cancellation:', error);
    }
  }

  // Gérer les paiements réussis
  async handleSuccessfulPayment(paymentIntent) {
    try {
      console.log('💰 Webhook: Paiement réussi:', paymentIntent.id);
      
      // Enregistrer dans l'historique des paiements si nécessaire
      if (paymentIntent.metadata?.userId) {
        await supabase
          .from('payment_history')
          .insert([{
            user_id: paymentIntent.metadata.userId,
            stripe_payment_intent_id: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency.toUpperCase(),
            status: 'completed',
            completed_at: new Date().toISOString()
          }]);
      }
    } catch (error) {
      console.error('❌ Erreur webhook payment success:', error);
    }
  }

  // ===================================================================
  // UTILITAIRES ET STATISTIQUES
  // ===================================================================

  // Vérifier la santé de la base de données
  async checkDatabaseHealth() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .limit(1);

      return error ? 'unhealthy' : 'healthy';
    } catch (error) {
      console.error('❌ Erreur health check database:', error);
      return 'unhealthy';
    }
  }

  // Obtenir les statistiques d'abonnements
  async getSubscriptionStats() {
    try {
      const { data: subscriptions, error } = await supabase
        .from('subscriptions')
        .select('tier, status, created_at, billing_period');

      if (error) throw error;

      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const stats = {
        totalSubscriptions: subscriptions.length,
        freeUsers: subscriptions.filter(s => s.tier === 'free').length,
        premiumUsers: subscriptions.filter(s => s.tier === 'premium' && s.status === 'active').length,
        cancelledUsers: subscriptions.filter(s => s.status === 'cancelled').length,
        newSubscriptionsThisMonth: subscriptions.filter(s => 
          new Date(s.created_at) >= thisMonth && s.tier === 'premium'
        ).length,
        monthlySubscriptions: subscriptions.filter(s => 
          s.billing_period === 'monthly' && s.status === 'active'
        ).length,
        yearlySubscriptions: subscriptions.filter(s => 
          s.billing_period === 'yearly' && s.status === 'active'
        ).length
      };

      // Calculer le taux de conversion
      if (stats.totalSubscriptions > 0) {
        stats.conversionRate = Math.round((stats.premiumUsers / stats.totalSubscriptions) * 100);
      } else {
        stats.conversionRate = 0;
      }

      return stats;
    } catch (error) {
      console.error('❌ Erreur statistiques abonnements:', error);
      return {
        totalSubscriptions: 0,
        freeUsers: 0,
        premiumUsers: 0,
        cancelledUsers: 0,
        newSubscriptionsThisMonth: 0,
        monthlySubscriptions: 0,
        yearlySubscriptions: 0,
        conversionRate: 0
      };
    }
  }

  // Obtenir l'historique des paiements d'un utilisateur
  async getUserPaymentHistory(userId) {
    try {
      const { data: payments, error } = await supabase
        .from('payment_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return payments || [];
    } catch (error) {
      console.error('❌ Erreur historique paiements:', error);
      return [];
    }
  }

  // Annuler un abonnement (côté utilisateur)
  async cancelUserSubscription(userId) {
    try {
      console.log('🚫 Demande d\'annulation pour userId:', userId);
      
      // Récupérer l'abonnement actuel
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', userId)
        .single();

      if (error || !subscription || !subscription.stripe_subscription_id) {
        throw new Error('Aucun abonnement actif trouvé');
      }

      // Annuler l'abonnement sur Stripe (à la fin de la période)
      const cancelledSubscription = await stripe.subscriptions.update(
        subscription.stripe_subscription_id,
        {
          cancel_at_period_end: true
        }
      );

      // Mettre à jour en base
      await supabase
        .from('subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          expires_at: new Date(cancelledSubscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      console.log('✅ Abonnement programmé pour annulation');
      
      return {
        success: true,
        message: 'Abonnement annulé avec succès',
        endsAt: new Date(cancelledSubscription.current_period_end * 1000)
      };
    } catch (error) {
      console.error('❌ Erreur annulation abonnement:', error);
      throw new Error('Impossible d\'annuler l\'abonnement: ' + error.message);
    }
  }

  // Réactiver un abonnement annulé
  async reactivateUserSubscription(userId) {
    try {
      console.log('🔄 Réactivation abonnement pour userId:', userId);
      
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', userId)
        .single();

      if (error || !subscription || !subscription.stripe_subscription_id) {
        throw new Error('Aucun abonnement trouvé');
      }

      // Réactiver sur Stripe
      const reactivatedSubscription = await stripe.subscriptions.update(
        subscription.stripe_subscription_id,
        {
          cancel_at_period_end: false
        }
      );

      // Mettre à jour en base
      await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          cancelled_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      console.log('✅ Abonnement réactivé');
      
      return {
        success: true,
        message: 'Abonnement réactivé avec succès'
      };
    } catch (error) {
      console.error('❌ Erreur réactivation abonnement:', error);
      throw new Error('Impossible de réactiver l\'abonnement: ' + error.message);
    }
  }

  // Mettre à jour le mode de paiement
  async updatePaymentMethod(userId, paymentMethodId) {
    try {
      console.log('💳 Mise à jour mode de paiement pour userId:', userId);
      
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id, stripe_subscription_id')
        .eq('user_id', userId)
        .single();

      if (error || !subscription) {
        throw new Error('Abonnement non trouvé');
      }

      // Attacher le nouveau mode de paiement au client
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: subscription.stripe_customer_id,
      });

      // Définir comme mode de paiement par défaut
      await stripe.customers.update(subscription.stripe_customer_id, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      // Mettre à jour l'abonnement avec le nouveau mode de paiement
      if (subscription.stripe_subscription_id) {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          default_payment_method: paymentMethodId,
        });
      }

      console.log('✅ Mode de paiement mis à jour');
      
      return {
        success: true,
        message: 'Mode de paiement mis à jour avec succès'
      };
    } catch (error) {
      console.error('❌ Erreur mise à jour mode de paiement:', error);
      throw new Error('Impossible de mettre à jour le mode de paiement: ' + error.message);
    }
  }

  // Prévisualiser une facture
  async previewInvoice(userId, priceId) {
    try {
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id, stripe_subscription_id')
        .eq('user_id', userId)
        .single();

      if (error || !subscription) {
        throw new Error('Abonnement non trouvé');
      }

      const invoice = await stripe.invoices.retrieveUpcoming({
        customer: subscription.stripe_customer_id,
        subscription: subscription.stripe_subscription_id,
        subscription_items: [{
          id: subscription.stripe_subscription_id,
          price: priceId,
        }],
      });

      return {
        amount: invoice.amount_due,
        currency: invoice.currency,
        nextPaymentAttempt: invoice.next_payment_attempt
      };
    } catch (error) {
      console.error('❌ Erreur prévisualisation facture:', error);
      throw error;
    }
  }

  // Obtenir le portail client Stripe
  async createCustomerPortalSession(userId, returnUrl) {
    try {
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .single();

      if (error || !subscription || !subscription.stripe_customer_id) {
        throw new Error('Client Stripe non trouvé');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: returnUrl,
      });

      return session.url;
    } catch (error) {
      console.error('❌ Erreur portail client:', error);
      throw error;
    }
  }
}

// Export singleton
const subscriptionService = new SubscriptionService();
module.exports = subscriptionService;