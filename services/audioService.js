// ===================================================================
// services/audioService.js - SERVICE AUDIO COMPLET AVEC SUPABASE
// ===================================================================
const { createClient } = require('@supabase/supabase-js');

// Initialisation Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class AudioService {
  constructor() {
    console.log('🎵 AudioService initialisé');
    
    this.audioBucket = 'jogolinga-audio';
    
    // Vérifications de configuration
    if (!process.env.SUPABASE_URL) {
      throw new Error('SUPABASE_URL non configuré');
    }
  }

  // ===================================================================
  // RECHERCHE ET RÉCUPÉRATION D'AUDIOS
  // ===================================================================

  // Rechercher des audios avec filtres
  async searchAudio({ languageCode, category, word, sentence, limit = 100, offset = 0 }) {
    try {
      console.log(`🔍 Recherche audio: ${languageCode || 'all'}/${category || 'all'}/${word || sentence || 'all'}`);
      
      let query = supabase
        .from('audio_files')
        .select('*');

      // Appliquer les filtres
      if (languageCode) {
        query = query.eq('language_code', languageCode);
      }
      if (category) {
        query = query.eq('category', category);
      }
      if (word) {
        query = query.ilike('word', `%${word.toLowerCase()}%`);
      }
      if (sentence) {
        query = query.ilike('sentence', `%${sentence}%`);
      }

      // Pagination et ordre
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('❌ Erreur recherche audio:', error);
        throw error;
      }

      // Ajouter les URLs publiques
      const results = (data || []).map(audio => ({
        ...audio,
        public_url: this.getPublicUrl(audio.file_path),
        download_url: this.getDownloadUrl(audio.file_path)
      }));

      console.log(`✅ Trouvé ${results.length} audios`);
      return results;
      
    } catch (error) {
      console.error('❌ Erreur searchAudio:', error);
      return [];
    }
  }

  // Obtenir l'URL publique d'un fichier audio
  getPublicUrl(filePath) {
    try {
      const { data } = supabase.storage
        .from(this.audioBucket)
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error('❌ Erreur URL publique:', filePath, error);
      return null;
    }
  }

  // Obtenir l'URL de téléchargement d'un fichier audio
  getDownloadUrl(filePath) {
    try {
      const { data } = supabase.storage
        .from(this.audioBucket)
        .getPublicUrl(filePath, {
          download: true
        });

      return data.publicUrl;
    } catch (error) {
      console.error('❌ Erreur URL téléchargement:', filePath, error);
      return null;
    }
  }

  // Obtenir l'audio d'un mot spécifique
  async getWordAudio(languageCode, word) {
    try {
      console.log(`🎵 Recherche audio pour mot: ${languageCode}/${word}`);
      
      const results = await this.searchAudio({ 
        languageCode, 
        word: word.toLowerCase().trim(),
        limit: 1
      });

      if (results.length > 0) {
        console.log('✅ Audio trouvé pour le mot:', word);
        return results[0];
      }

      console.log('⚠️ Aucun audio trouvé pour le mot:', word);
      return null;
    } catch (error) {
      console.error('❌ Erreur getWordAudio:', error);
      return null;
    }
  }

  // Obtenir l'audio d'une phrase spécifique
  async getSentenceAudio(languageCode, sentence) {
    try {
      console.log(`🎵 Recherche audio pour phrase: ${languageCode}/${sentence}`);
      
      const results = await this.searchAudio({ 
        languageCode, 
        sentence: sentence.trim(),
        limit: 1
      });

      if (results.length > 0) {
        console.log('✅ Audio trouvé pour la phrase');
        return results[0];
      }

      console.log('⚠️ Aucun audio trouvé pour la phrase');
      return null;
    } catch (error) {
      console.error('❌ Erreur getSentenceAudio:', error);
      return null;
    }
  }

  // Obtenir tous les audios d'une catégorie
  async getCategoryAudios(languageCode, category) {
    try {
      console.log(`📂 Récupération audios catégorie: ${languageCode}/${category}`);
      
      const results = await this.searchAudio({ 
        languageCode, 
        category,
        limit: 1000 // Grande limite pour récupérer tous les audios de la catégorie
      });

      console.log(`✅ ${results.length} audios trouvés dans la catégorie ${category}`);
      return results;
    } catch (error) {
      console.error('❌ Erreur getCategoryAudios:', error);
      return [];
    }
  }

  // ===================================================================
  // GESTION DES MÉTADONNÉES AUDIO
  // ===================================================================

  // Ajouter un nouveau fichier audio (métadonnées)
  async addAudioFile({ 
    languageCode, 
    category, 
    subcategory, 
    word, 
    sentence, 
    filePath, 
    fileSize, 
    duration, 
    speakerInfo,
    quality = 'medium'
  }) {
    try {
      console.log(`📝 Ajout métadonnées audio: ${filePath}`);
      
      const { data, error } = await supabase
        .from('audio_files')
        .insert([{
          language_code: languageCode,
          category: category,
          subcategory: subcategory,
          word: word ? word.toLowerCase() : null,
          sentence: sentence,
          file_path: filePath,
          file_size: fileSize,
          duration_seconds: duration,
          speaker_info: speakerInfo,
          quality: quality,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur ajout audio:', error);
        throw error;
      }
      
      console.log('✅ Métadonnées audio ajoutées:', data.id);
      return {
        ...data,
        public_url: this.getPublicUrl(data.file_path)
      };
    } catch (error) {
      console.error('❌ Erreur addAudioFile:', error);
      throw error;
    }
  }

  // Mettre à jour les métadonnées d'un audio
  async updateAudioFile(audioId, updateData) {
    try {
      console.log(`🔄 Mise à jour audio: ${audioId}`);
      
      const { data, error } = await supabase
        .from('audio_files')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', audioId)
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur mise à jour audio:', error);
        throw error;
      }
      
      console.log('✅ Audio mis à jour');
      return {
        ...data,
        public_url: this.getPublicUrl(data.file_path)
      };
    } catch (error) {
      console.error('❌ Erreur updateAudioFile:', error);
      throw error;
    }
  }

  // Supprimer un fichier audio complet (fichier + métadonnées)
  async deleteAudioFile(audioId) {
    try {
      console.log(`🗑️ Suppression audio: ${audioId}`);
      
      // Récupérer les infos du fichier
      const { data: audio, error: fetchError } = await supabase
        .from('audio_files')
        .select('*')
        .eq('id', audioId)
        .single();

      if (fetchError) {
        console.error('❌ Audio non trouvé:', fetchError);
        throw fetchError;
      }

      // Supprimer le fichier physique du storage
      const { error: storageError } = await supabase.storage
        .from(this.audioBucket)
        .remove([audio.file_path]);

      if (storageError) {
        console.warn('⚠️ Erreur suppression fichier storage:', storageError);
        // Continuer même si la suppression du fichier échoue
      }

      // Supprimer les métadonnées de la base de données
      const { error: dbError } = await supabase
        .from('audio_files')
        .delete()
        .eq('id', audioId);

      if (dbError) {
        console.error('❌ Erreur suppression métadonnées:', dbError);
        throw dbError;
      }

      console.log('✅ Audio supprimé complètement');
      return true;
    } catch (error) {
      console.error('❌ Erreur deleteAudioFile:', error);
      throw error;
    }
  }

  // ===================================================================
  // UPLOAD ET GESTION DES FICHIERS
  // ===================================================================

  // Upload d'un fichier audio vers Supabase Storage
  async uploadAudioFile(file, filePath) {
    try {
      console.log(`📤 Upload audio: ${filePath}`);
      
      const { data, error } = await supabase.storage
        .from(this.audioBucket)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false // Ne pas écraser si le fichier existe
        });

      if (error) {
        console.error('❌ Erreur upload:', error);
        throw error;
      }
      
      console.log('✅ Fichier uploadé:', data.path);
      return data.path;
    } catch (error) {
      console.error('❌ Erreur uploadAudioFile:', error);
      throw error;
    }
  }

  // Vérifier si un fichier existe dans le storage
  async fileExists(filePath) {
    try {
      const { data, error } = await supabase.storage
        .from(this.audioBucket)
        .list(filePath.split('/').slice(0, -1).join('/'), {
          limit: 1000
        });

      if (error) return false;
      
      const fileName = filePath.split('/').pop();
      return data.some(file => file.name === fileName);
    } catch (error) {
      console.error('❌ Erreur vérification fichier:', error);
      return false;
    }
  }

  // Obtenir les informations d'un fichier
  async getFileInfo(filePath) {
    try {
      const { data, error } = await supabase.storage
        .from(this.audioBucket)
        .list(filePath.split('/').slice(0, -1).join('/'), {
          limit: 1000
        });

      if (error) throw error;
      
      const fileName = filePath.split('/').pop();
      const fileInfo = data.find(file => file.name === fileName);
      
      return fileInfo || null;
    } catch (error) {
      console.error('❌ Erreur info fichier:', error);
      return null;
    }
  }

  // ===================================================================
  // STATISTIQUES ET ANALYTICS
  // ===================================================================

  // Obtenir les statistiques générales des audios
  async getAudioStats() {
    try {
      console.log('📊 Récupération statistiques audio');
      
      const { data, error } = await supabase
        .from('audio_files')
        .select('language_code, category, file_size, duration_seconds, quality, created_at');

      if (error) {
        console.error('❌ Erreur statistiques audio:', error);
        throw error;
      }

      // Calculer les statistiques
      const stats = {
        totalFiles: data.length,
        totalSize: data.reduce((sum, item) => sum + (item.file_size || 0), 0),
        totalDuration: data.reduce((sum, item) => sum + (item.duration_seconds || 0), 0),
        averageFileSize: data.length > 0 ? Math.round(data.reduce((sum, item) => sum + (item.file_size || 0), 0) / data.length) : 0,
        averageDuration: data.length > 0 ? Math.round(data.reduce((sum, item) => sum + (item.duration_seconds || 0), 0) / data.length) : 0,
        byLanguage: {},
        byCategory: {},
        byQuality: {},
        recentUploads: 0
      };

      // Calculer les répartitions
      data.forEach(item => {
        // Par langue
        stats.byLanguage[item.language_code] = (stats.byLanguage[item.language_code] || 0) + 1;
        
        // Par catégorie
        stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
        
        // Par qualité
        stats.byQuality[item.quality] = (stats.byQuality[item.quality] || 0) + 1;
        
        // Uploads récents (derniers 7 jours)
        const uploadDate = new Date(item.created_at);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (uploadDate >= weekAgo) {
          stats.recentUploads++;
        }
      });

      console.log('✅ Statistiques calculées');
      return stats;
    } catch (error) {
      console.error('❌ Erreur getAudioStats:', error);
      return {
        totalFiles: 0,
        totalSize: 0,
        totalDuration: 0,
        averageFileSize: 0,
        averageDuration: 0,
        byLanguage: {},
        byCategory: {},
        byQuality: {},
        recentUploads: 0
      };
    }
  }

  // Obtenir les statistiques d'une langue spécifique
  async getLanguageStats(languageCode) {
    try {
      console.log(`📊 Statistiques pour la langue: ${languageCode}`);
      
      const { data, error } = await supabase
        .from('audio_files')
        .select('category, file_size, duration_seconds, created_at')
        .eq('language_code', languageCode);

      if (error) throw error;

      const stats = {
        totalFiles: data.length,
        totalSize: data.reduce((sum, item) => sum + (item.file_size || 0), 0),
        totalDuration: data.reduce((sum, item) => sum + (item.duration_seconds || 0), 0),
        byCategory: {},
        recentFiles: data.filter(item => {
          const uploadDate = new Date(item.created_at);
          const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          return uploadDate >= weekAgo;
        }).length
      };

      // Répartition par catégorie
      data.forEach(item => {
        stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('❌ Erreur statistiques langue:', error);
      return {
        totalFiles: 0,
        totalSize: 0,
        totalDuration: 0,
        byCategory: {},
        recentFiles: 0
      };
    }
  }

  // ===================================================================
  // UTILITAIRES
  // ===================================================================

  // Lister toutes les langues disponibles
  async getAvailableLanguages() {
    try {
      const { data, error } = await supabase
        .from('audio_files')
        .select('language_code')
        .group('language_code');

      if (error) throw error;

      const languages = [...new Set(data.map(item => item.language_code))];
      console.log('✅ Langues disponibles:', languages);
      return languages;
    } catch (error) {
      console.error('❌ Erreur langues disponibles:', error);
      return [];
    }
  }

  // Lister toutes les catégories d'une langue
  async getLanguageCategories(languageCode) {
    try {
      const { data, error } = await supabase
        .from('audio_files')
        .select('category')
        .eq('language_code', languageCode);

      if (error) throw error;

      const categories = [...new Set(data.map(item => item.category))];
      console.log(`✅ Catégories pour ${languageCode}:`, categories);
      return categories;
    } catch (error) {
      console.error('❌ Erreur catégories langue:', error);
      return [];
    }
  }

  // Recherche avancée avec filtres multiples
  async advancedSearch(filters) {
    try {
      console.log('🔍 Recherche avancée:', filters);
      
      let query = supabase.from('audio_files').select('*');

      // Appliquer tous les filtres
      Object.entries(filters).forEach(([key, value]) => {
        if (value && key !== 'limit' && key !== 'offset') {
          if (key === 'word' || key === 'sentence') {
            query = query.ilike(key, `%${value}%`);
          } else if (key === 'file_size_min') {
            query = query.gte('file_size', value);
          } else if (key === 'file_size_max') {
            query = query.lte('file_size', value);
          } else if (key === 'duration_min') {
            query = query.gte('duration_seconds', value);
          } else if (key === 'duration_max') {
            query = query.lte('duration_seconds', value);
          } else {
            query = query.eq(key, value);
          }
        }
      });

      // Pagination
      const limit = filters.limit || 50;
      const offset = filters.offset || 0;

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const results = (data || []).map(audio => ({
        ...audio,
        public_url: this.getPublicUrl(audio.file_path)
      }));

      console.log(`✅ Recherche avancée: ${results.length} résultats trouvés`);
      return results;
    } catch (error) {
      console.error('❌ Erreur recherche avancée:', error);
      return [];
    }
  }

  // Vérifier l'intégrité des fichiers audio
  async checkAudioIntegrity() {
    try {
      console.log('🔍 Vérification intégrité des fichiers audio');
      
      const { data: audioFiles, error } = await supabase
        .from('audio_files')
        .select('id, file_path');

      if (error) throw error;

      const results = {
        total: audioFiles.length,
        existing: 0,
        missing: 0,
        missingFiles: []
      };

      // Vérifier chaque fichier
      for (const audio of audioFiles) {
        const exists = await this.fileExists(audio.file_path);
        if (exists) {
          results.existing++;
        } else {
          results.missing++;
          results.missingFiles.push({
            id: audio.id,
            path: audio.file_path
          });
        }
      }

      console.log('✅ Vérification terminée:', results);
      return results;
    } catch (error) {
      console.error('❌ Erreur vérification intégrité:', error);
      return {
        total: 0,
        existing: 0,
        missing: 0,
        missingFiles: []
      };
    }
  }

  // Nettoyer les métadonnées orphelines
  async cleanOrphanedMetadata() {
    try {
      console.log('🧹 Nettoyage métadonnées orphelines');
      
      const { data: audioFiles, error } = await supabase
        .from('audio_files')
        .select('id, file_path');

      if (error) throw error;

      const orphanedIds = [];

      // Vérifier chaque fichier
      for (const audio of audioFiles) {
        const exists = await this.fileExists(audio.file_path);
        if (!exists) {
          orphanedIds.push(audio.id);
        }
      }

      if (orphanedIds.length > 0) {
        console.log(`🗑️ Suppression de ${orphanedIds.length} métadonnées orphelines`);
        
        const { error: deleteError } = await supabase
          .from('audio_files')
          .delete()
          .in('id', orphanedIds);

        if (deleteError) throw deleteError;
      }

      console.log('✅ Nettoyage terminé');
      return {
        cleaned: orphanedIds.length,
        orphanedIds
      };
    } catch (error) {
      console.error('❌ Erreur nettoyage:', error);
      return {
        cleaned: 0,
        orphanedIds: []
      };
    }
  }

  // Obtenir l'usage du storage
  async getStorageUsage() {
    try {
      console.log('📊 Calcul usage storage');
      
      const { data: files, error } = await supabase.storage
        .from(this.audioBucket)
        .list('', {
          limit: 1000,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) throw error;

      let totalSize = 0;
      let fileCount = 0;

      // Calculer récursivement la taille
      const calculateFolderSize = async (prefix = '') => {
        const { data: folderFiles, error: folderError } = await supabase.storage
          .from(this.audioBucket)
          .list(prefix, {
            limit: 1000
          });

        if (folderError) return;

        for (const file of folderFiles) {
          if (file.metadata && file.metadata.size) {
            totalSize += file.metadata.size;
            fileCount++;
          } else if (!file.metadata) {
            // C'est un dossier, calculer récursivement
            await calculateFolderSize(prefix ? `${prefix}/${file.name}` : file.name);
          }
        }
      };

      await calculateFolderSize();

      return {
        totalFiles: fileCount,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        totalSizeGB: Math.round(totalSize / 1024 / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      console.error('❌ Erreur calcul usage storage:', error);
      return {
        totalFiles: 0,
        totalSizeBytes: 0,
        totalSizeMB: 0,
        totalSizeGB: 0
      };
    }
  }

  // Obtenir les audios les plus populaires (basé sur une future table de logs)
  async getPopularAudios(limit = 10) {
    try {
      // Pour l'instant, retourner les plus récents
      // Dans le futur, on pourrait avoir une table audio_plays pour tracker la popularité
      const { data, error } = await supabase
        .from('audio_files')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(audio => ({
        ...audio,
        public_url: this.getPublicUrl(audio.file_path)
      }));
    } catch (error) {
      console.error('❌ Erreur audios populaires:', error);
      return [];
    }
  }

  // Générer un rapport d'analyse des audios
  async generateAnalyticsReport() {
    try {
      console.log('📊 Génération rapport analytics');
      
      const [
        generalStats,
        storageUsage,
        availableLanguages,
        integrityCheck
      ] = await Promise.all([
        this.getAudioStats(),
        this.getStorageUsage(),
        this.getAvailableLanguages(),
        this.checkAudioIntegrity()
      ]);

      const report = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalFiles: generalStats.totalFiles,
          totalSizeMB: storageUsage.totalSizeMB,
          languages: availableLanguages.length,
          categories: Object.keys(generalStats.byCategory).length,
          integrityScore: integrityCheck.total > 0 ? 
            Math.round((integrityCheck.existing / integrityCheck.total) * 100) : 100
        },
        details: {
          generalStats,
          storageUsage,
          availableLanguages,
          integrityCheck
        },
        recommendations: []
      };

      // Ajouter des recommandations
      if (integrityCheck.missing > 0) {
        report.recommendations.push({
          type: 'warning',
          message: `${integrityCheck.missing} fichiers manquants détectés`,
          action: 'Nettoyer les métadonnées orphelines'
        });
      }

      if (storageUsage.totalSizeMB > 800) { // Proche de 1GB
        report.recommendations.push({
          type: 'info',
          message: 'Approche de la limite gratuite Supabase (1GB)',
          action: 'Considérer l\'optimisation des fichiers audio'
        });
      }

      if (generalStats.byQuality && generalStats.byQuality.low > generalStats.totalFiles * 0.5) {
        report.recommendations.push({
          type: 'suggestion',
          message: 'Beaucoup de fichiers en qualité faible',
          action: 'Améliorer la qualité audio pour une meilleure expérience utilisateur'
        });
      }

      console.log('✅ Rapport généré');
      return report;
    } catch (error) {
      console.error('❌ Erreur génération rapport:', error);
      return {
        generatedAt: new Date().toISOString(),
        summary: {
          totalFiles: 0,
          totalSizeMB: 0,
          languages: 0,
          categories: 0,
          integrityScore: 0
        },
        details: null,
        recommendations: [{
          type: 'error',
          message: 'Erreur lors de la génération du rapport',
          action: 'Vérifier la connexion à la base de données'
        }]
      };
    }
  }

  // ===================================================================
  // MÉTHODES DE MIGRATION ET MAINTENANCE
  // ===================================================================

  // Migrer un batch de fichiers vers Supabase
  async migrateBatchToSupabase(audioFiles) {
    try {
      console.log(`📦 Migration de ${audioFiles.length} fichiers audio`);
      
      const results = {
        success: 0,
        failed: 0,
        errors: []
      };

      for (const audioFile of audioFiles) {
        try {
          // Upload du fichier
          const uploadPath = await this.uploadAudioFile(audioFile.buffer, audioFile.path);
          
          // Ajouter les métadonnées
          await this.addAudioFile({
            languageCode: audioFile.languageCode,
            category: audioFile.category,
            subcategory: audioFile.subcategory,
            word: audioFile.word,
            sentence: audioFile.sentence,
            filePath: uploadPath,
            fileSize: audioFile.size,
            duration: audioFile.duration,
            quality: audioFile.quality || 'medium'
          });

          results.success++;
          console.log(`✅ Migré: ${audioFile.path}`);
          
        } catch (error) {
          results.failed++;
          results.errors.push({
            file: audioFile.path,
            error: error.message
          });
          console.error(`❌ Échec migration: ${audioFile.path}`, error.message);
        }
      }

      console.log(`📊 Migration terminée: ${results.success} réussies, ${results.failed} échecs`);
      return results;
    } catch (error) {
      console.error('❌ Erreur migration batch:', error);
      throw error;
    }
  }

  // Synchroniser les métadonnées avec les fichiers existants
  async syncMetadataWithFiles() {
    try {
      console.log('🔄 Synchronisation métadonnées avec fichiers');
      
      // Lister tous les fichiers du storage
      const { data: storageFiles, error: storageError } = await supabase.storage
        .from(this.audioBucket)
        .list('', { limit: 1000 });

      if (storageError) throw storageError;

      // Récupérer toutes les métadonnées
      const { data: metadataFiles, error: metadataError } = await supabase
        .from('audio_files')
        .select('file_path');

      if (metadataError) throw metadataError;

      const metadataPaths = new Set(metadataFiles.map(f => f.file_path));
      const missingMetadata = [];

      // Parcourir récursivement tous les fichiers du storage
      const processFolder = async (prefix = '') => {
        const { data: folderFiles, error } = await supabase.storage
          .from(this.audioBucket)
          .list(prefix, { limit: 1000 });

        if (error) return;

        for (const file of folderFiles) {
          const fullPath = prefix ? `${prefix}/${file.name}` : file.name;

          if (file.metadata) {
            // C'est un fichier
            if (!metadataPaths.has(fullPath) && file.name.endsWith('.mp3')) {
              missingMetadata.push({
                path: fullPath,
                size: file.metadata.size,
                lastModified: file.metadata.lastModified
              });
            }
          } else {
            // C'est un dossier, traiter récursivement
            await processFolder(fullPath);
          }
        }
      };

      await processFolder();

      console.log(`📊 ${missingMetadata.length} fichiers sans métadonnées trouvés`);
      
      // Créer les métadonnées manquantes
      let created = 0;
      for (const file of missingMetadata) {
        try {
          const pathParts = file.path.split('/');
          const fileName = pathParts[pathParts.length - 1].replace('.mp3', '');
          
          await this.addAudioFile({
            languageCode: pathParts[0] || 'unknown',
            category: pathParts[1] || 'uncategorized',
            subcategory: pathParts[2] || null,
            word: fileName.toLowerCase(),
            sentence: null,
            filePath: file.path,
            fileSize: file.size,
            quality: 'medium'
          });
          
          created++;
        } catch (error) {
          console.warn(`⚠️ Erreur création métadonnées pour ${file.path}:`, error.message);
        }
      }

      console.log(`✅ Synchronisation terminée: ${created} métadonnées créées`);
      return {
        filesChecked: storageFiles.length,
        missingMetadata: missingMetadata.length,
        metadataCreated: created
      };
    } catch (error) {
      console.error('❌ Erreur synchronisation:', error);
      return {
        filesChecked: 0,
        missingMetadata: 0,
        metadataCreated: 0
      };
    }
  }

  // Optimiser les fichiers audio (compression, format)
  async optimizeAudioFiles(options = {}) {
    try {
      console.log('⚡ Optimisation des fichiers audio');
      
      const {
        maxSizeKB = 500, // 500KB max par fichier
        targetQuality = 'medium',
        dryRun = true // Ne pas modifier les fichiers par défaut
      } = options;

      // Récupérer tous les fichiers audio
      const { data: audioFiles, error } = await supabase
        .from('audio_files')
        .select('*')
        .gt('file_size', maxSizeKB * 1024); // Fichiers plus gros que la limite

      if (error) throw error;

      const results = {
        candidatesFound: audioFiles.length,
        optimized: 0,
        spaceSaved: 0,
        errors: []
      };

      console.log(`📊 ${audioFiles.length} fichiers candidats à l'optimisation`);

      if (dryRun) {
        console.log('🔍 Mode analyse seulement (dryRun=true)');
        
        let totalSavings = 0;
        audioFiles.forEach(file => {
          const currentSize = file.file_size;
          const estimatedOptimizedSize = Math.max(currentSize * 0.6, 50 * 1024); // 60% du poids ou 50KB min
          totalSavings += (currentSize - estimatedOptimizedSize);
        });

        results.estimatedSpaceSavings = totalSavings;
        console.log(`💾 Économies d'espace estimées: ${Math.round(totalSavings / 1024 / 1024)} MB`);
      }

      // En mode réel, on pourrait implémenter l'optimisation avec une lib comme ffmpeg
      // Mais pour l'instant, on reste en mode analyse

      return results;
    } catch (error) {
      console.error('❌ Erreur optimisation:', error);
      return {
        candidatesFound: 0,
        optimized: 0,
        spaceSaved: 0,
        errors: [error.message]
      };
    }
  }

  // Créer une sauvegarde des métadonnées
  async backupMetadata() {
    try {
      console.log('💾 Création sauvegarde métadonnées');
      
      const { data: allAudioFiles, error } = await supabase
        .from('audio_files')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const backup = {
        createdAt: new Date().toISOString(),
        version: '1.0',
        totalFiles: allAudioFiles.length,
        audioFiles: allAudioFiles
      };

      // Sauvegarder dans Supabase Storage
      const backupFileName = `backup_metadata_${new Date().toISOString().split('T')[0]}.json`;
      const backupPath = `backups/${backupFileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(this.audioBucket)
        .upload(backupPath, JSON.stringify(backup, null, 2), {
          contentType: 'application/json',
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      console.log(`✅ Sauvegarde créée: ${backupPath}`);
      return {
        success: true,
        backupPath: backupPath,
        fileCount: allAudioFiles.length,
        publicUrl: this.getPublicUrl(backupPath)
      };
    } catch (error) {
      console.error('❌ Erreur sauvegarde:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Restaurer les métadonnées depuis une sauvegarde
  async restoreMetadata(backupPath) {
    try {
      console.log(`🔄 Restauration métadonnées depuis: ${backupPath}`);
      
      // Télécharger le fichier de sauvegarde
      const { data: backupData, error: downloadError } = await supabase.storage
        .from(this.audioBucket)
        .download(backupPath);

      if (downloadError) throw downloadError;

      const backupText = await backupData.text();
      const backup = JSON.parse(backupText);

      console.log(`📦 Sauvegarde trouvée: ${backup.totalFiles} fichiers (${backup.createdAt})`);

      // Nettoyer les métadonnées existantes
      const { error: deleteError } = await supabase
        .from('audio_files')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Supprimer tout

      if (deleteError) {
        console.warn('⚠️ Erreur nettoyage métadonnées:', deleteError);
      }

      // Restaurer les métadonnées
      const batchSize = 100;
      let restored = 0;

      for (let i = 0; i < backup.audioFiles.length; i += batchSize) {
        const batch = backup.audioFiles.slice(i, i + batchSize);
        
        // Préparer les données pour l'insertion (supprimer les IDs pour régénération)
        const insertData = batch.map(file => ({
          language_code: file.language_code,
          category: file.category,
          subcategory: file.subcategory,
          word: file.word,
          sentence: file.sentence,
          file_path: file.file_path,
          file_size: file.file_size,
          duration_seconds: file.duration_seconds,
          speaker_info: file.speaker_info,
          quality: file.quality,
          created_at: file.created_at
        }));

        const { error: insertError } = await supabase
          .from('audio_files')
          .insert(insertData);

        if (insertError) {
          console.error('❌ Erreur insertion batch:', insertError);
        } else {
          restored += batch.length;
        }
      }

      console.log(`✅ Restauration terminée: ${restored} métadonnées restaurées`);
      return {
        success: true,
        restoredCount: restored,
        backupDate: backup.createdAt
      };
    } catch (error) {
      console.error('❌ Erreur restauration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton
const audioService = new AudioService();
module.exports = audioService;