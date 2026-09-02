import type { TranslationCatalog } from '.';

export const fr = {
  'notice.dictationNotActive': "La dictée n'est pas active actuellement.",
  'notice.dictationStartFailed': 'Impossible de démarrer la dictée.',
  'notice.dictationStopFailed': "Impossible d'arrêter la dictée.",
  'notice.lastUtteranceCleared': 'Effacement du dernier énoncé retenu.',
  'notice.lastUtteranceReinsertFailed': 'Impossible de réinsérer le dernier énoncé finalisé.',
  'notice.lastUtteranceReinserted': 'Réinsertion du dernier énoncé finalisé.',
  'notice.lastUtteranceUnavailable': "Aucun énoncé finalisé n'est disponible pour être réinséré.",
  'notice.llmTransformEmpty': "La transformation LLM n'a rien renvoyé à ajouter.",
  'notice.microphoneDisconnected':
    "Micro débranché. La dictée s'est arrêtée et terminera le traitement de l'audio déjà capturé. Rebranchez le microphone, puis recommencez la dictée.",
  'notice.rawTranscriptChanged':
    'Impossible de restaurer la transcription brute, car la note a été modifiée après le nettoyage.',
  'notice.rawTranscriptCleared': 'Effacement de la récupération de la transcription brute.',
  'notice.rawTranscriptCopied': 'Transcription brute copiée.',
  'notice.rawTranscriptCopyFailed': 'Impossible de copier la transcription brute.',
  'notice.rawTranscriptRestored': 'Transcription brute restaurée.',
  'notice.rawTranscriptRestoreFailed': 'Impossible de restaurer la transcription brute.',
  'notice.rawTranscriptTargetUnavailable':
    "Impossible de restaurer la transcription brute, car sa note d'origine n'est plus ouverte dans le même éditeur.",
  'notice.rawTranscriptUnavailable': "Aucune récupération de transcription brute n'est disponible.",
  'notice.sidecarHealthCheckFailed': "Échec de la vérification de l'état du Sidecar",
  'notice.sidecarReady': 'Sidecar est prêt ({version}).',
  'notice.sidecarRestarted': 'sidecar redémarré ({version}).',
  'notice.sidecarRestartFailed': 'Échec du redémarrage du Sidecar',
  'notice.sidecarRestartRequiresIdle':
    'Redémarrez le sidecar uniquement lorsque la dictée et la lecture sont inactives.',
  'notice.transcriptRecordFailed': "Impossible d'enregistrer la transcription.",
  'notice.sidecarSessionError': 'Le moteur vocal a signalé une erreur.',
  'notice.sidecarVersionDrift.actionMultiple': 'Mettre à jour les moteurs vocaux',
  'notice.sidecarVersionDrift.actionOne': 'Mettre à jour le moteur vocal',
  'notice.sidecarVersionDrift.cpu':
    'Mise à jour vers {version}, mais le moteur vocal installé est obsolète. Mettez à jour maintenant pour les garder synchronisés.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Mise à jour vers {version}, mais les moteurs vocaux CPU et CUDA installés sont obsolètes. Mettez à jour maintenant pour les garder synchronisés.',
  'notice.sidecarVersionDrift.cuda':
    'Mise à jour vers {version}, mais le moteur vocal CUDA installé est obsolète. Mettez à jour maintenant pour les garder synchronisés.',
  'notice.surfaceDesynchronized':
    "La dictée s'est arrêtée car la note a changé d'une manière que Speech Kit ne pouvait pas suivre en toute sécurité. Recommencez la dictée pour continuer.",
  'notice.targetNoteClosed':
    "La dictée s'est arrêtée car sa note cible a été fermée ou remplacée. Recommencez la dictée pour continuer.",
  'notice.targetNoteDeleted':
    "La dictée s'est arrêtée car sa note cible a été supprimée. Restaurez ou recréez la note, puis recommencez la dictée.",
  'notice.transcriptWriteFailed':
    "La dictée s'est arrêtée car Speech Kit n'a pas pu écrire en toute sécurité dans la note. Recommencez la dictée pour continuer.",
  'setup.sidecar.cpu.firstRun.body':
    "Speech Kit nécessite un téléchargement unique du moteur de transcription pour CPU depuis les versions GitHub. Une fois cette opération terminée, la transcription s'exécute localement sur votre ordinateur. Vous pourrez installer l'accélération CUDA ultérieurement depuis les paramètres.",
  'setup.sidecar.cpu.firstRun.primaryButton': 'Télécharger CPU sidecar',
  'setup.sidecar.cpu.firstRun.success': 'Speech Kit sidecar installé et démarré.',
  'setup.sidecar.cpu.firstRun.title': 'Terminer la configuration de Speech Kit',
  'setup.sidecar.cpu.install.body':
    "Téléchargez le moteur de transcription pour CPU depuis les versions GitHub. Une fois cette opération terminée, la transcription s'exécute localement sur votre ordinateur.",
  'setup.sidecar.cpu.install.primaryButton': 'Télécharger CPU sidecar',
  'setup.sidecar.cpu.install.success': 'CPU sidecar installé et démarré.',
  'setup.sidecar.cpu.install.title': 'Installer CPU sidecar',
  'setup.sidecar.cpu.reinstall.body':
    "Téléchargez à nouveau le moteur de transcription pour CPU depuis les versions GitHub. Cela remplace l'installation CPU actuelle.",
  'setup.sidecar.cpu.reinstall.primaryButton': 'Télécharger à nouveau CPU sidecar',
  'setup.sidecar.cpu.reinstall.success': 'CPU sidecar réinstallé et redémarré.',
  'setup.sidecar.cpu.reinstall.title': 'Réinstaller CPU sidecar',
  'setup.sidecar.cuda.install.primaryButton': 'Télécharger CUDA sidecar',
  'setup.sidecar.cuda.install.success': 'CUDA sidecar installé et démarré.',
  'setup.sidecar.cuda.install.title': "Installer l'accélération CUDA",
  'setup.sidecar.mac.firstRun.body':
    "Speech Kit nécessite un téléchargement unique de son moteur de transcription depuis les versions GitHub. Une fois installé, il transcrit entièrement sur votre Mac : l'audio ne quitte jamais votre machine.",
  'setup.sidecar.mac.firstRun.primaryButton': 'Télécharger sidecar',
  'setup.sidecar.mac.firstRun.success': 'Speech Kit sidecar installé et démarré.',
  'setup.sidecar.mac.firstRun.title': 'Terminer la configuration de Speech Kit',
  'setup.sidecar.mac.install.body':
    "Téléchargez le moteur de transcription depuis les versions GitHub. Une fois cette opération terminée, la transcription s'exécute localement sur votre Mac.",
  'setup.sidecar.mac.install.primaryButton': 'Télécharger sidecar',
  'setup.sidecar.mac.install.success': 'Sidecar installé et démarré.',
  'setup.sidecar.mac.install.title': 'Installer sidecar',
  'setup.sidecar.mac.reinstall.body':
    "Téléchargez à nouveau le moteur de transcription depuis les versions GitHub. Cela remplace l'installation actuelle.",
  'setup.sidecar.mac.reinstall.primaryButton': 'Télécharger à nouveau sidecar',
  'setup.sidecar.mac.reinstall.success': 'Sidecar réinstallé et redémarré.',
  'setup.sidecar.mac.reinstall.title': 'Réinstaller sidecar',
  'setup.sidecar.update.body':
    'Téléchargez le {engineLabel} actuel pour correspondre à cette version de Speech Kit. Les installations existantes sont remplacées sur place.',
  'setup.sidecar.update.engine.cpuAndCuda': 'Moteurs vocaux CPU et CUDA',
  'setup.sidecar.update.engine.cuda': 'Moteur vocal CUDA',
  'setup.sidecar.update.engine.default': 'moteur vocal',
  'setup.sidecar.update.primaryButton_one': 'Mettre à jour le moteur vocal',
  'setup.sidecar.update.primaryButton_other': 'Mettre à jour les moteurs vocaux',
  'setup.sidecar.update.success_one': 'Moteur vocal Speech Kit mis à jour et redémarré.',
  'setup.sidecar.update.success_other': 'Moteurs vocaux Speech Kit mis à jour et redémarrés.',
  'setup.sidecar.update.title_one': 'Mettre à jour le moteur vocal',
  'setup.sidecar.update.title_other': 'Mettre à jour les moteurs vocaux',
  'audio.microphone.permissionDeniedMac':
    'Autorisation du microphone refusée. Ouvrez Paramètres système → Confidentialité et sécurité → Microphone, activez Obsidian, puis redémarrez Obsidian et réessayez.',
  'audio.microphone.permissionDenied':
    "Autorisation du microphone refusée. Accordez l'accès dans les paramètres de votre système d'exploitation et réessayez.",
  'audio.microphone.notFound':
    "Aucun microphone détecté. Branchez un microphone ou un casque USB, ou activez un périphérique d'entrée dans les paramètres sonores de votre système d'exploitation, puis réessayez.",
  'audio.microphone.notReadable':
    "Le microphone n'a pas pu être ouvert. Une autre application l'utilise peut-être ou le périphérique audio est peut-être en erreur. Fermez les autres applications à l'aide du micro et réessayez.",
  'audio.systemAudio.notReady': "L'audio du système n'est pas prêt.",
  'audio.systemAudio.outdatedInstaller':
    "{message} Votre programme d'installation Obsidian est antérieur à l'autorisation audio système macOS. Téléchargez un nouveau programme d'installation depuis obsidian.md et réinstallez-le, puis réessayez.",
  'commands.toggleDictation': 'Basculer la dictée',
  'commands.startDictation': 'Démarrer la dictée',
  'commands.stopDictation': 'Arrêter la dictée',
  'commands.cancelDictation': 'Annuler la dictée',
  'commands.reinsertLastUtterance': 'Réinsérer le dernier énoncé',
  'commands.clearLastUtterance': 'Effacer le dernier énoncé',
  'commands.restoreRawTranscript': 'Restaurer la transcription brute',
  'commands.copyRawTranscript': 'Copier la transcription brute',
  'commands.clearRawRecovery': 'Effacer la récupération brute',
  'commands.checkSidecarHealth': "Vérifier l'état de santé de sidecar",
  'commands.restartSidecar': 'Redémarrer sidecar',
  'common.reset': 'Réinitialiser',
  'settings.acceleration.pending': 'en attente (sidecar pas prêt)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} indisponible)',
  'settings.acceleration.unknownReason': 'raison inconnue',
  'settings.dictationLanguage.autoDetect': 'Détection automatique',
  'settings.dictationLanguage.name': 'Langue de dictée',
  'settings.dictationLanguage.englishOnlyDesc':
    "Le modèle sélectionné, {model}, prend en charge uniquement l'anglais.",
  'settings.dictationLanguage.desc':
    'Choisissez la langue que vous parlerez. La sélection manuelle donne le nettoyage le plus prévisible. La détection automatique peut démarrer plus lentement et choisit une langue par énoncé.',
  'settings.dictationLanguage.unsupported': '{language} (non pris en charge)',
  'settings.engine.named': 'Moteur {engine}',
  'settings.groups.model': 'Modèles',
  'settings.groups.capture': 'Capturer',
  'settings.groups.transcriptOutput': 'Sortie de transcription',
  'settings.groups.llmTransformation': 'Transformation LLM',
  'settings.groups.engine': 'Moteur',
  'settings.groups.advanced': 'Avancé',
  'settings.listeningMode.alwaysOn': 'Toujours allumé',
  'settings.listeningMode.oneSentence': 'Une phrase',
  'settings.listeningMode.name': 'Mode d’écoute',
  'settings.listeningMode.desc': "Continue ou s'arrête après une phrase.",
  'settings.insertText.atCursor': 'Au curseur',
  'settings.insertText.endOfNote': 'Fin de la note',
  'settings.insertText.name': 'Insérer du texte',
  'settings.insertText.desc': 'Où le texte dicté apparaît.',
  'settings.transcriptFormatting.smartParagraphs': 'Paragraphes intelligents',
  'settings.transcriptFormatting.space': 'Espace',
  'settings.transcriptFormatting.newLine': 'Nouvelle ligne',
  'settings.transcriptFormatting.newParagraph': 'Nouveau paragraphe',
  'settings.transcriptFormatting.name': 'Formatage de la transcription',
  'settings.transcriptFormatting.desc': 'Comment les phrases sont réunies.',
  'settings.phraseFinalization.responsiveOption': 'Réactif – courtes pauses',
  'settings.phraseFinalization.balancedOption': 'Équilibré – standard',
  'settings.phraseFinalization.patientOption': 'Patient – ​​longues pauses',
  'settings.phraseFinalization.name': 'Finalisation de la phrase',
  'settings.phraseFinalization.responsive':
    'Se finalise après des pauses plus courtes pour un texte complété plus rapidement.',
  'settings.phraseFinalization.balanced':
    'Utilise la tolérance de pause standard pour les dictées quotidiennes.',
  'settings.phraseFinalization.patient':
    "Attend des pauses plus longues pour qu'une pensée soit moins susceptible d'être divisée.",
  'settings.phraseFinalization.tooltip':
    "S'applique à tous les modèles de transcription. Les mots en direct peuvent toujours être mis à jour avant que la phrase ne soit définitive. Cela modifie les limites de l'activité vocale, mais pas le style d'écriture ou la précision du modèle. Le réactif favorise la vitesse ; Le patient préfère garder les pauses dans une phrase.",
  'settings.systemAudio.name': "Inclure l'audio du système",
  'settings.systemAudio.desc':
    'Capturez également la sortie audio par défaut de cet ordinateur pour les réunions, les appels et les vidéos.',
  'settings.systemAudio.ready': "L'audio du système est prêt.",
  'settings.systemAudio.testFailed':
    'Impossible de tester le son du système. Vérifiez que le moteur vocal est installé et réessayez.',
  'settings.speakerLabels.name': 'Étiquettes de locuteur',
  'settings.speakerLabels.desc': 'Étiquetez chaque phrase par locuteur.',
  'settings.speakerLabels.streamingLimitation':
    'Les étiquettes de locuteur nécessitent un modèle par lots.',
  'settings.speakerLabels.modal.title': 'Paramètres des étiquettes de locuteur',
  'settings.speakerLabels.modal.intro':
    "Les étiquettes de locuteur sont générées sur l'appareil après chaque phrase détectée par la voix. Elles nécessitent un modèle de transcription par lots.",
  'settings.speakerLabels.maximumSpeakers.name': 'Nombre maximal de locuteurs',
  'settings.speakerLabels.maximumSpeakers.desc':
    'Automatique détermine le nombre de locuteurs. Définissez une limite uniquement si des étiquettes de locuteur supplémentaires apparaissent.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Activez les étiquettes de locuteur avant de configurer une limite de locuteurs.',
  'settings.speakerLabels.automatic': 'Automatique',
  'settings.timestamps.enable.name': 'Utiliser des horodatages',
  'settings.timestamps.enable.desc': 'Ajoutez des repères d’horodatage aux transcriptions dictées.',
  'settings.timestamps.modal.title': "Paramètres d'horodatage",
  'settings.timestamps.modal.intro':
    'Choisissez des points de repère à intervalles, des limites de phrases ou des sauts de paragraphe intelligents.',
  'settings.timestamps.clock.elapsed': 'Écoulé',
  'settings.timestamps.clock.wallClock': 'Horloge murale',
  'settings.timestamps.frequency.atIntervals': 'À intervalles',
  'settings.timestamps.frequency.everyPhrase': 'Chaque phrase',
  'settings.timestamps.frequency.atParagraphBreaks': 'Aux sauts de paragraphe',
  'settings.timestamps.sessionHeader.name': 'En-tête de session',
  'settings.timestamps.sessionHeader.desc':
    'Démarrez chaque session horodatée avec [AAAA-MM-JJ HH:MM].',
  'settings.timestamps.referenceClock.name': 'Horloge de référence',
  'settings.timestamps.referenceClock.desc':
    "Temps écoulé depuis le début de la dictée ou heure de l'horloge murale locale.",
  'settings.timestamps.frequency.name': 'Fréquence',
  'settings.timestamps.frequency.desc':
    'Choisissez la fréquence à laquelle les horodatages apparaissent.',
  'settings.timestamps.frequency.sparseDesc':
    "Ajoutez des points de repère lisibles à l'intervalle configuré.",
  'settings.timestamps.frequency.everyPhraseDesc':
    "Ajoutez un horodatage avant chaque segment chronométré par modèle lorsqu'il est disponible, sinon à chaque phrase détectée par la voix.",
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    'Définissez le formatage de la transcription sur Paragraphes intelligents pour obtenir des sauts de paragraphe.',
  'settings.timestamps.frequency.paragraphDesc':
    'Ajoutez un horodatage au début de la session et à chaque saut de paragraphe intelligent.',
  'settings.timestamps.interval.name': 'Intervalle',
  'settings.timestamps.interval.desc': "Secondes entre les repères d'horodatage ({min}-{max}).",
  'settings.timestamps.interval.inactiveDesc':
    'Utilisé uniquement lorsque la fréquence est définie sur À intervalles.',
  'settings.timestamps.interval.validation':
    'Entrez un nombre entier compris entre {min} et {max} secondes.',
  'settings.smartParagraph.modal.title': 'Paramètres de paragraphe intelligents',
  'settings.smartParagraph.modal.intro':
    "Les paragraphes intelligents transforment les pauses plus longues en sauts de ligne ou de paragraphe. Ces valeurs s'appliquent uniquement lorsque le formatage de la transcription est défini sur Paragraphes intelligents.",
  'settings.smartParagraph.lineBreakPause.name': 'Pause de saut de ligne',
  'settings.smartParagraph.lineBreakPause.desc':
    'Secondes avant un seul saut de ligne ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Pause de paragraphe',
  'settings.smartParagraph.paragraphPause.desc':
    'Secondes avant un saut de paragraphe ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Activer les fonctionnalités du LLM',
  'settings.llm.enableFeatures.desc':
    'Rendre les transformations LLM disponibles. Activez ou désactivez la transformation dans la barre latérale.',
  'settings.llm.restoreDefaults.name': 'Restaurer les valeurs par défaut de la transformation',
  'settings.llm.restoreDefaults.desc':
    'Réinitialisez le préréglage, le timing, le contexte, le nombre minimum de mots et la température. Les préréglages et modèles enregistrés sont conservés.',
  'settings.llm.restoreDefaults.button': 'Restaurer',
  'settings.llm.restoreDefaults.confirmMessage':
    'Restaurer le préréglage par défaut, le timing, le contexte, le nombre minimum de mots et la température ? Les préréglages et modèles enregistrés sont conservés.',
  'settings.llm.migratedPreset': 'Mon préréglage',
  'settings.llm.migratedPresetNumbered': 'Mon préréglage {number}',
  'settings.recoveryMemory.name': 'Conserver le texte de récupération en mémoire',
  'settings.recoveryMemory.desc':
    "Conservez le dernier instantané de texte et de note récupérable en mémoire. Rien n'est écrit sur le disque.",
  'settings.modelStoreOverride.name': 'Remplacement du dossier du magasin de modèles',
  'settings.modelStoreOverride.desc':
    'Dossier personnalisé pour les téléchargements de modèles gérés.',
  'settings.modelStoreOverride.placeholder': 'Utiliser le magasin de modèles par défaut partagé',
  'settings.runSetup.name': 'Exécuter la configuration',
  'settings.runSetup.desc': "Réexécutez l'assistant de première installation.",
  'settings.hardwareAcceleration.name': 'Accélération matérielle',
  'settings.hardwareAcceleration.desc': 'Exécutez l’inférence sur le GPU lorsqu’il est disponible.',
  'settings.hardwareAcceleration.busy':
    "Impossible de modifier l'accélération matérielle pendant la dictée ou la lecture à voix haute. Si la dictée est toujours en cours de traitement après son arrêt, exécutez « Annuler la dictée ».",
  'settings.hardwareAcceleration.on': 'Accélération matérielle activée.',
  'settings.hardwareAcceleration.off': 'Accélération matérielle désactivée.',
  'settings.noteContext.name': 'Utiliser la note comme contexte',
  'settings.noteContext.desc':
    'Pour l’anglais sélectionné manuellement, envoyez les termes distinctifs de la note ouverte afin d’améliorer l’orthographe.',
  'settings.noteContext.tooltip':
    'Envoie un glossaire de noms propres et de termes techniques comme invite initiale du moteur. Utilisé uniquement pour l’anglais sélectionné manuellement avec les moteurs prenant en charge les invites initiales.',
  'settings.microphone.name': 'Microphone',
  'settings.microphone.desc':
    "Quel microphone utiliser pour la dictée. Les modifications s'appliqueront lors de la prochaine session de dictée.",
  'settings.microphone.default': 'Microphone par défaut',
  'settings.microphone.labelUnavailable': 'Microphone (étiquette indisponible)',
  'settings.microphone.notConnected': '{microphone} (non connecté)',
  'settings.microphone.detectTooltip': 'Détecter les microphones (demande la permission)',
  'settings.microphone.allowAccessFirst':
    "Autorisez d'abord l'accès au microphone pour enregistrer cet appareil.",
  'settings.microphone.stopDictationToDetect': 'Arrêtez la dictée pour détecter les microphones.',
  'settings.microphone.unavailableRuntime':
    'L’accès au microphone n’est pas disponible dans ce runtime.',
  'settings.microphone.detectFailed':
    'Impossible de détecter les microphones. Vérifiez les paramètres audio de votre système.',
  'settings.microphone.fallbackSaveFailed':
    "Microphone enregistré indisponible. Utilisation du microphone par défaut, mais cette modification n'a pas pu être enregistrée. Sélectionnez un microphone disponible dans Paramètres avant de redémarrer Obsidian.",
  'settings.microphone.fallbackUnchanged':
    'Microphone enregistré indisponible. Utiliser le microphone par défaut pour cette session ; le réglage actuel du microphone est resté inchangé.',
  'settings.microphone.fallbackCleared':
    'Microphone enregistré indisponible. Utiliser le microphone par défaut ; la sélection enregistrée a été effacée pour les sessions futures.',
  'settings.model.notInstalled': 'Non installé',
  'settings.model.validatedExternal': 'Validé · externe',
  'settings.model.external': 'Externe',
  'settings.model.checking': 'Vérification…',
  'settings.model.unavailable': 'Indisponible',
  'settings.model.noModel': 'Aucun modèle',
  'settings.model.streaming': 'Streaming',
  'settings.model.manageModels': 'Gérer les modèles',
  'settings.model.useExternalFile': 'Utiliser un fichier externe',
  'settings.model.details': 'Détails du modèle',
  'settings.install.installingNamed': 'Installation : {name}',
  'settings.install.installingSidecar': 'Installation : {variant} sidecar',
  'settings.install.installingSidecarMac': 'Installation du sidecar',
  'settings.install.cancelling': 'Annulation...',
  'settings.install.cancel': 'Annuler',
  'settings.missingSidecar.name': 'Configurer Speech Kit',
  'settings.missingSidecar.desc':
    "Speech Kit n’est pas encore prêt. Exécutez l'assistant de configuration pour installer le moteur vocal et un modèle.",
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': 'sidecar {variant}',
  'settings.sidecar.desc': 'Moteur de transcription.',
  'settings.sidecar.cpuName': 'CPU sidecar',
  'settings.sidecar.cpuDesc': 'Moteur de transcription. Requis.',
  'settings.sidecar.gpuName': 'GPU sidecar',
  'settings.sidecar.cudaLibraryPath.name': 'Chemin de la bibliothèque CUDA',
  'settings.sidecar.cudaLibraryPath.desc':
    'Chemin de recherche de bibliothèque facultatif pour le sidecar (Flatpak, installations CUDA personnalisées).',
  'settings.sidecar.installAnyway': 'Installer quand même',
  'settings.sidecar.stopBeforeInstall':
    "Arrêtez la dictée ou la lecture à voix haute avant d'installer un sidecar : l'installation redémarre le moteur. Si la dictée est toujours en cours de traitement, exécutez « Annuler la dictée » pour l'arrêter maintenant.",
  'settings.sidecar.stopBeforeUninstall':
    'Arrêtez la dictée ou la lecture à voix haute avant de désinstaller le {sidecar}. Si la dictée est toujours en cours de traitement, exécutez « Annuler la dictée » pour l’arrêter maintenant.',
  'settings.sidecar.uninstallFailed':
    'Impossible de désinstaller le {sidecar}. Fermez les autres fenêtres de configuration et réessayez.',
  'settings.sidecar.uninstalled': 'Sidecar désinstallé.',
  'settings.sidecar.cudaUninstalled': 'CUDA sidecar désinstallé. Fonctionnant sur CPU.',
  'settings.sidecar.cpuUninstalled': 'CPU sidecar désinstallé.',
  'settings.sidecar.restartFailed':
    "Le moteur vocal n'a pas pu redémarrer. Redémarrez Obsidian avant de dicter.",
  'settings.sidecar.reinstall': 'Réinstaller',
  'settings.sidecar.uninstall': 'Désinstaller',
  'settings.sidecar.install': 'Installer',
  'plugin.name': 'Speech Kit',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.duplicate': 'Dupliquer',
  'common.free': 'Gratuit',
  'common.inherit': 'Hériter',
  'common.off': 'Désactivé',
  'common.on': 'Activé',
  'common.save': 'Enregistrer',
  'common.unavailable': 'Indisponible',
  'ribbon.idle': 'Speech Kit — démarrer la dictée',
  'ribbon.starting': 'Speech Kit — démarrage…',
  'ribbon.listening': 'Speech Kit — écoute',
  'ribbon.speechDetected': 'Speech Kit — voix détectée',
  'ribbon.error': 'Speech Kit — erreur',
  'validation.wholeNumberRange': 'Entrez un nombre entier de {min} à {max}.',
  'validation.numberRange': 'Entrez un nombre compris entre {min} et {max}.',
  'llm.managedByPreset':
    'Géré par « {preset} ». Modifiez ce préréglage pour modifier cette valeur.',
  'llm.context.title': 'Paramètres de contexte',
  'llm.context.settingsTooltip': 'Paramètres de contexte',
  'llm.context.intro':
    'Plus de contexte peut améliorer la terminologie, mais peut augmenter la latence locale ou le coût du OpenRouter.',
  'llm.context.noteLength.name': 'Longueur du contexte de note',
  'llm.context.noteLength.description':
    'Nombre maximum de caractères extraits de la note actuelle au-dessus du curseur.',
  'llm.context.previousPhrases.name': 'Phrases précédentes',
  'llm.context.previousPhrases.description':
    "Phrases dictées récentes incluses dans l'historique des conversations.",
  'llm.context.afterEachPhraseOnly':
    'Utilisé uniquement lorsque Exécuter la transformation est défini sur Après chaque phrase.',
  'llm.context.limit.name': 'Limite contextuelle',
  'llm.context.limit.description':
    'Nombre maximal de caractères combinés à partir du contexte de la note et des phrases précédentes.',
  'llm.context.useCurrentNote.name': 'Utiliser la note actuelle comme contexte',
  'llm.context.useCurrentNote.description':
    'Incluez du texte au-dessus du curseur dans chaque invite.',
  'llm.model.title': 'Paramètres du modèle',
  'llm.model.settingsTooltip': 'Paramètres du modèle',
  'llm.model.temperature.name': 'Température',
  'llm.model.temperature.description':
    "Variation d'échantillonnage. 0 est déterministe ; les valeurs plus élevées sont plus variées.",
  'llm.model.behavior.name': 'Comportement du modèle',
  'llm.model.summary.temperature': 'Température {value}',
  'llm.model.summary.timeout': "Délai d'expiration de {value}s",
  'llm.failure.authInvalid': "Clé d'API {provider} rejetée. Vérifiez les paramètres.",
  'llm.failure.rateLimited': 'Limite de débit de {provider} atteinte. Retour au texte brut.',
  'llm.failure.network': 'Erreur réseau lors de la connexion à {provider}.',
  'llm.failure.modelNotConfigured':
    'Le modèle {provider} n’est pas configuré. Choisissez-en un sous Modèle.',
  'llm.failure.unknownModel': 'Modèle {provider} introuvable. Choisissez-en un autre sous Modèle.',
  'llm.failure.unknown': 'La transformation LLM a échoué. Voir console.',
  'llm.status.selectOllamaModel': 'Sélectionnez un modèle Ollama ci-dessous.',
  'llm.status.selectOpenRouterModel': 'Sélectionnez un modèle OpenRouter ci-dessous.',
  'llm.status.ollamaNotRunning': "Ollama n'est pas en cours d'exécution.",
  'llm.status.unreachable': '{provider} est inaccessible.',
  'llm.status.authInvalid': "Clé d'API {provider} rejetée.",
  'llm.status.rateLimited': 'La limite de débit {provider} a été atteinte.',
  'llm.status.noOllamaModels': 'Aucun modèle de chat installé dans Ollama.',
  'llm.status.noModels': 'Aucun modèle {provider} utilisable trouvé.',
  'llm.status.selectedUnavailable': "Le modèle sélectionné n'est pas disponible.",
  'llm.timing.title': "Paramètres d'exécution",
  'llm.timing.settingsTooltip': 'Paramètres de synchronisation',
  'llm.timing.minimumWords.name': 'Nombre minimal de mots',
  'llm.timing.minimumWords.description':
    'Ignorez la transformation lorsque la transcription contient moins de mots que cela.',
  'llm.timing.timestamps.perUtterance':
    "Après chaque phrase, les limites de l'horodatage sont préservées.",
  'llm.timing.timestamps.batch':
    'Tout à la fois peut réécrire ou supprimer les horodatages, en fonction du préréglage.',
  'llm.timing.option.perUtterance': 'Après chaque phrase',
  'llm.timing.option.batch': "Tout à la fois à l'arrêt de la dictée",
  'llm.routing.priceTierTooltip': 'Niveau de prix approximatif',
  'llm.routing.providerModel': 'Modèle {provider}',
  'llm.routing.ollamaModelDescription': 'Choisissez un modèle de discussion local Ollama.',
  'llm.routing.selectModel': 'Sélectionnez un modèle',
  'llm.routing.refreshModels': 'Actualiser les modèles {provider}',
  'llm.routing.openRouterModel.name': 'Modèle OpenRouter',
  'llm.routing.openRouterModel.description': 'Tapez pour rechercher des modèles OpenRouter.',
  'llm.routing.testConnection': "Tester la clé d'API et le modèle",
  'llm.sidebar.eyebrow': 'Flux de travail de transcription',
  'llm.sidebar.title': 'Transformez la dictée',
  'llm.sidebar.description':
    "Choisissez la façon dont le texte parlé est mis en forme avant qu'il n'atteigne votre note.",
  'llm.sidebar.group.preset': 'Préréglage',
  'llm.sidebar.group.model': 'Modèle',
  'llm.sidebar.group.context': 'Contexte',
  'llm.sidebar.enabled.name': 'Activé',
  'llm.sidebar.enabled.description': 'Appliquez le préréglage actif au nouveau texte dicté.',
  'llm.sidebar.showOriginal.name': 'Afficher la transcription originale',
  'llm.sidebar.showOriginal.description':
    'Conservez-le dans une légende pliable sous chaque résultat transformé.',
  'llm.sidebar.runTransform.name': 'Exécuter la transformation',
  'llm.sidebar.runTransform.description':
    "S'exécute après chaque phrase ou en une seule fois lorsque vous arrêtez la dictée.",
  'llm.sidebar.runTransform.setByPreset': 'Défini par {preset} — {timing}.',
  'llm.sidebar.activePreset': 'Préréglage actif',
  'llm.sidebar.unavailable.title': 'Les fonctionnalités LLM ne sont pas disponibles',
  'llm.sidebar.unavailable.description':
    'Activez les fonctionnalités LLM dans les paramètres Speech Kit pour configurer les transformations.',
  'llm.sidebar.unavailable.summary': 'Activer les fonctionnalités LLM dans les paramètres',
  'llm.sidebar.off.title': 'Mode de transcription brute',
  'llm.sidebar.off.description':
    'La dictée insère la transcription locale brute. Activez Transformer lorsque vous souhaitez un nettoyage, une réécriture ou des résumés.',
  'llm.sidebar.off.summary': 'Transcription brute',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Nettoyer',
  'llm.preset.builtin.cleanUp.description':
    'Corrigez les artefacts de transcription, les remplissages, la ponctuation et les majuscules tout en préservant la voix et le sens.',
  'llm.preset.builtin.cleanUp.prompt':
    "Nettoyez le texte dicté. Corrigez les mots de remplissage, les faux départs, les répétitions, la ponctuation, les majuscules et les erreurs de reconnaissance évidentes. Préservez la voix et le sens du locuteur. Utilisez le contexte de référence uniquement pour l'orthographe. Écrivez dans la langue d'origine de la transcription. Ne traduisez pas sauf si l'utilisateur le demande explicitement. Renvoyez uniquement le texte nettoyé, sans préambule ni commentaire.",
  'llm.preset.builtin.professionalWriting.label': 'Écriture professionnelle',
  'llm.preset.builtin.professionalWriting.description':
    'Réécrivez dans une prose professionnelle concise et soignée tout en préservant les faits, les noms, les décisions et les termes techniques.',
  'llm.preset.builtin.professionalWriting.prompt':
    "Réécrivez le texte dicté en une prose professionnelle concise. Utilisez la voix active, sans mots de remplissage ni formulations évasives. Préservez chaque fait, nom et terme. Utilisez le contexte de référence pour l'orthographe. Écrivez dans la langue d'origine de la transcription. Ne traduisez pas sauf si l'utilisateur le demande explicitement. Renvoyez uniquement le texte réécrit, sans préambule ni commentaire.",
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Ajoutez un court résumé TLDR au-dessus de votre transcription intacte.',
  'llm.preset.builtin.tldr.prompt':
    "Rédigez un résumé TLDR de la transcription dictée : un en-tête « TLDR » suivi de 1 à 3 puces courtes couvrant les points clés. Écrivez dans la langue d'origine de la transcription. Ne traduisez jamais à moins que l'utilisateur ne demande explicitement une traduction. Ne renvoyez que le titre et les puces — ne répétez pas la transcription, pas de préambule, pas de commentaire.",
  'llm.preset.builtin.markdownFormatting.label': 'Formatage Markdown',
  'llm.preset.builtin.markdownFormatting.description':
    'Reformatez la transcription de la session sous la forme structurée Markdown avec des titres, des listes et une emphase.',
  'llm.preset.builtin.markdownFormatting.prompt':
    "Reformatez le texte dicté en Markdown bien structuré. Ajoutez des titres, des listes à puces ou numérotées, du gras, de l'emphase et des blocs de code délimités lorsque le contenu l'exige. Corrigez légèrement les mots de remplissage, les faux départs, la ponctuation et les majuscules ; préservez la formulation du locuteur ainsi que chaque fait, nom et terme. Écrivez dans la langue d'origine de la transcription. Ne traduisez pas sauf si l'utilisateur le demande explicitement. Renvoyez uniquement le Markdown, sans préambule ni commentaire.",
  'llm.preset.builtin.actionItems.label': "Éléments d'action",
  'llm.preset.builtin.actionItems.description':
    "Ajoutez une liste de contrôle d'éléments d'action sous votre transcription intacte.",
  'llm.preset.builtin.actionItems.prompt':
    "Extrayez les éléments d’action de la transcription dictée. Affichez un en-tête « Éléments d'action » suivi d'une liste de contrôle Markdown de tâches concrètes, nommant un propriétaire lorsque l'orateur en mentionne un. Si la transcription ne contient aucune action, ne renvoyez rien. Écrivez dans la langue originale de la transcription. Ne traduisez jamais à moins que l’utilisateur ne demande explicitement une traduction. Renvoyez uniquement le titre et la liste de contrôle – ne répétez pas la transcription, pas de préambule, pas de commentaire.",
  'llm.preset.timing.perUtterance': "S'exécute après chaque phrase",
  'llm.preset.timing.batch': "Fonctionne une fois à l'arrêt",
  'llm.preset.timing.either': 'Fonctionne dans les deux modes',
  'llm.preset.behavior.addAbove': 'ajoute du nouveau contenu au-dessus de la transcription',
  'llm.preset.behavior.addBelow': 'ajoute du nouveau contenu sous la transcription',
  'llm.preset.behavior.replace': 'réécrit le texte dicté',
  'llm.preset.behavior.overrides': 'remplace {fields}',
  'llm.preset.override.minimumWords': 'mots minimum',
  'llm.preset.override.temperature': 'température',
  'llm.preset.override.noteContext': 'contexte de la note',
  'llm.preset.option.perUtterance': '{preset} (après chaque phrase)',
  'llm.preset.option.batch': "{preset} (à l'arrêt)",
  'llm.preset.copySuffix': '(copie)',
  'llm.preset.copySuffixNumbered': ' (copie {number})',
  'llm.preset.validation.nameRequired': 'Entrez un nom pour ce préréglage.',
  'llm.preset.validation.nameExists': 'Un préréglage portant ce nom existe déjà.',
  'llm.preset.validation.promptRequired': 'Entrez une invite pour ce préréglage.',
  'llm.preset.validation.minimumWords':
    'Les mots minimum doivent être un nombre entier compris entre 0 et {max}.',
  'llm.preset.validation.temperature':
    'La température doit être un nombre compris entre 0 et {max}.',
  'llm.preset.validation.maximumCount':
    "Vous pouvez enregistrer jusqu'à {max} préréglages. Supprimez-en un d'abord.",
  'llm.preset.validation.builtinName':
    'Ce nom est utilisé par un préréglage intégré – choisissez un nom différent.',
  'llm.preset.manager.title': 'Gérer les préréglages',
  'llm.preset.manager.newTitle': 'Nouveau préréglage',
  'llm.preset.manager.editTitle': 'Modifier le préréglage',
  'llm.preset.manager.presets.name': 'Préréglages',
  'llm.preset.manager.presets.description':
    'Le préréglage actif est marqué. Les préréglages intégrés sont en lecture seule : dupliquez-en un pour le personnaliser.',
  'llm.preset.manager.new': 'Nouveau préréglage',
  'llm.preset.manager.searchPlaceholder': 'Rechercher des préréglages...',
  'llm.preset.manager.noMatches': 'Aucun préréglage ne correspond à votre recherche.',
  'llm.preset.manager.builtinHeading': 'Intégrés',
  'llm.preset.manager.yoursHeading': 'Vos préréglages',
  'llm.preset.manager.viewTooltip': 'Afficher le préréglage',
  'llm.preset.manager.editTooltip': 'Modifier le préréglage',
  'llm.preset.manager.duplicateTooltip': 'Dupliquer le préréglage',
  'llm.preset.manager.deleteTooltip': 'Supprimer le préréglage "{preset}"',
  'llm.preset.manager.back': '← Tous les préréglages',
  'llm.preset.editor.name': 'Nom',
  'llm.preset.editor.namePlaceholder': 'par ex. Notes de réunion',
  'llm.preset.editor.description': 'Description (facultatif)',
  'llm.preset.editor.descriptionPlaceholder': 'Quand utiliser ce préréglage',
  'llm.preset.editor.prompt': 'Invite',
  'llm.preset.editor.promptDescription': "Envoyé au modèle en tant qu'invite système.",
  'llm.preset.editor.promptSize':
    '~{tokens} jetons ({characters} caractères) — envoyés à chaque requête',
  'llm.preset.editor.timing': 'Timing',
  'llm.preset.editor.timingDescription':
    "Lorsque la transformation s'exécute. « L'un ou l'autre » suit la synchronisation de la barre latérale.",
  'llm.preset.editor.timingEither': "L'un ou l'autre (selon la barre latérale)",
  'llm.preset.editor.timingPerUtterance': 'Après chaque phrase',
  'llm.preset.editor.timingBatch': "Une fois à l'arrêt",
  'llm.preset.editor.output': 'Sortie',
  'llm.preset.editor.outputDescription':
    'Remplacer réécrit votre texte dicté. Ajouter le garde intact et insère du nouveau contenu.',
  'llm.preset.editor.outputReplace': 'Remplacer le texte',
  'llm.preset.editor.outputAddAbove': 'Ajouter au-dessus de la transcription',
  'llm.preset.editor.outputAddBelow': 'Ajouter sous la transcription',
  'llm.preset.editor.overrides': 'Remplacements',
  'llm.preset.editor.overridesDescription':
    'Laissez un champ vide pour utiliser le paramètre global.',
  'llm.preset.editor.minimumWords': 'Nombre minimal de mots',
  'llm.preset.delete.title': 'Supprimer le préréglage',
  'llm.preset.delete.message':
    'Supprimer le préréglage « {preset} » ? Cela ne peut pas être annulé.',
  'llm.preset.delete.activeFallback': '"{preset}" était actif - basculé vers Nettoyage.',
  'common.back': 'Retour',
  'common.close': 'Fermer',
  'common.done': 'Terminé',
  'common.install': 'Installer',
  'common.later': 'Plus tard',
  'common.next': 'Suivant',
  'common.remove': 'Supprimer',
  'common.tryAgain': 'Réessayer',
  'setup.ready.waitForDictation': 'Attendez la fin de la dictée en cours, puis réessayez.',
  'setup.ready.openMarkdownNote':
    'Ouvrez une note Markdown en mode édition, puis réessayez la dictée.',
  'setup.ready.completionFailed': 'Impossible de terminer la configuration. Essayer à nouveau.',
  'setup.wizard.welcomeTitle': 'Bienvenue dans Speech Kit',
  'setup.wizard.title': 'Configurer Speech Kit',
  'setup.wizard.engineReadyTitle': 'Moteur vocal prêt',
  'setup.wizard.engineReadyDesc': 'Le moteur de transcription local est installé et prêt.',
  'setup.wizard.intro':
    "Dictez des notes mains libres, directement à l'intérieur de Obsidian — entièrement sur votre machine. Pas de compte, pas de cloud, pas de télémétrie.",
  'setup.wizard.quickSetup': 'Une configuration rapide de 2 minutes :',
  'setup.wizard.downloadEngineStep': 'Téléchargez le moteur vocal',
  'setup.wizard.pickModelStep': 'Choisissez un modèle de transcription',
  'setup.wizard.startTalking':
    'Appuyez ensuite sur le micro dans le ruban (ou sur votre propre raccourci clavier) et commencez à parler.',
  'setup.wizard.downloadEngine': 'Télécharger le moteur',
  'setup.wizard.modelSelectedTitle': 'Modèle sélectionné',
  'setup.wizard.pickModelTitle': 'Choisissez un modèle de transcription',
  'setup.wizard.modelSelectedDesc':
    'Un modèle de transcription est installé et sélectionné. Vous pouvez en installer plus ou changer plus tard à partir des paramètres.',
  'setup.wizard.modelIntro':
    "Installez un modèle de transcription pour activer la dictée. Vous pourrez installer d'autres modèles plus tard : les petits modèles sont plus rapides et les grands modèles plus précis.",
  'setup.wizard.modelKinds':
    'Deux types sont disponibles : les modèles de streaming affichent les mots en direct pendant que vous parlez ; les modèles standards transcrivent après chaque pause. Pour une dictée mains libres, commencez par le modèle Moonshine Small recommandé. Nemotron 3.5 ASR est une option de streaming qui nécessite davantage de ressources.',
  'setup.wizard.openModelPicker': 'Ouvrir le sélecteur de modèles',
  'setup.wizard.readyTitle': 'Vous êtes prêt à dicter',
  'setup.wizard.readyDesc':
    "Essayez dans la note Markdown actuellement ouverte. Dites quelques mots, puis utilisez l'icône de microphone du ruban ou votre raccourci clavier pour arrêter la dictée.",
  'setup.wizard.ribbonTitle': "Utiliser l'icône de microphone du ruban",
  'setup.wizard.ribbonDesc':
    'Recherchez cette icône dans le ruban Obsidian. Cliquez dessus pour commencer à dicter ; cliquez à nouveau pour arrêter.',
  'setup.wizard.hotkeyTitle': 'Ou lier un raccourci-clavier',
  'setup.wizard.hotkeyDescBefore': 'Lier un raccourci vers le',
  'setup.wizard.toggleCommandName': 'Speech Kit : activer/désactiver la dictée',
  'setup.wizard.hotkeyDescAfter':
    'commande pour démarrer et arrêter de n’importe où dans Obsidian.',
  'setup.wizard.openHotkeySettings': 'Ouvrir les paramètres des raccourcis clavier',
  'setup.wizard.tryDictationNow': 'Essayez la dictée maintenant',
  'setup.wizard.openHotkeySettingsFallback':
    'Ouvrez Paramètres → Raccourcis clavier et recherchez « Speech Kit ».',
  'setup.sidecar.modal.download': 'Télécharger',
  'setup.sidecar.modal.variantDownload': 'Télécharger {variant}',
  'setup.sidecar.modal.version': 'Version',
  'setup.sidecar.modal.cancelling': 'Annulation…',
  'setup.sidecar.modal.downloading': 'Téléchargement...',
  'setup.sidecar.modal.retryDownload': 'Réessayez le téléchargement',
  'setup.sidecar.modal.installFailureNotice':
    "L'installation du moteur vocal a échoué. Rouvrez la configuration ou les paramètres pour vérifier l'erreur et réessayez.",
  'setup.sidecar.modal.startFailed':
    "Impossible de démarrer l'installation de sidecar. Fermez les autres fenêtres de configuration et réessayez.",
  'setup.sidecar.installCancelled': 'Sidecar installation annulée.',
  'setup.sidecar.progress.variant': '{variant} sidecar ({current} de {total})',
  'setup.sidecar.progress.downloading': 'Téléchargement',
  'setup.sidecar.progress.verifying': 'Vérification de la somme de contrôle...',
  'setup.sidecar.progress.extracting': 'Extraction des archives...',
  'models.manage.title': 'Gérer les modèles',
  'models.manage.openFolder': 'Ouvrir le dossier des modèles',
  'models.manage.openFolderFailed': 'Impossible d’ouvrir le dossier des modèles.',
  'models.manage.loadFailedTitle': 'Impossible de charger les modèles',
  'models.manage.loadFailedDesc':
    "Le moteur vocal n'est peut-être pas installé ou ne répond pas. Réexécutez le programme d'installation pour le réinstaller ou réessayez.",
  'models.manage.runSetup': 'Exécuter la configuration',
  'models.manage.loadingCatalog': 'Chargement du catalogue de modèles…',
  'models.manage.loadCatalogFailed': 'Échec du chargement du catalogue de modèles.',
  'models.manage.noneAvailable': 'Aucun modèle disponible pour ce moteur.',
  'models.manage.unsupportedLanguage':
    ' · Ne prend pas en charge {language}. Modifiez la langue de dictée pour installer ou utiliser ce modèle.',
  'models.manage.use': 'Utiliser',
  'models.manage.selected': 'Sélectionné',
  'models.manage.cancelling': 'Annulation…',
  'models.manage.details': 'Détails',
  'models.manage.installStartFailed': "Impossible de démarrer l'installation du modèle. Réessayez.",
  'models.manage.selectFailed':
    'Impossible de sélectionner le modèle. Vérifiez que ses fichiers sont disponibles.',
  'models.manage.selectedNotice': 'Modèle sélectionné.',
  'models.manage.removeFailed':
    'Impossible de supprimer le modèle. Fermez tout processus utilisant ses fichiers.',
  'models.manage.removedNotice': 'Modèle supprimé.',
  'models.external.title': 'Utiliser un fichier externe',
  'models.external.intro':
    'Les modèles externes sont destinés à un usage avancé. Speech Kit ne télécharge pas ces fichiers, ne les met pas à jour et ne vérifie pas leur somme de contrôle.',
  'models.external.family.name': 'Famille du modèle',
  'models.external.family.desc':
    "Choisissez le chargeur qui correspond au modèle. La famille n'est pas déduite de son nom de fichier.",
  'models.external.path.name': 'Chemin du fichier modèle',
  'models.external.path.desc':
    "Entrez le chemin absolu vers l'artefact de modèle principal. Elle est validée avant la sauvegarde de cette sélection.",
  'models.external.validateAndUse': 'Valider et utiliser',
  'models.external.validating': 'Validation…',
  'models.external.selectedNotice': 'Fichier modèle externe validé et sélectionné.',
  'models.external.requirementsTitle': 'Exigences en matière de fichiers',
  'models.external.validation.notConfigured': "Le chemin du fichier modèle n'est pas configuré.",
  'models.external.validation.notAbsolute':
    'Le chemin du fichier modèle doit être un chemin absolu.',
  'models.external.validation.missing': "Le chemin du fichier modèle n'existe pas : {path}",
  'models.external.validation.notFile':
    'Le chemin du fichier modèle doit pointer vers un fichier : {path}',
  'models.external.validation.selectEntryFile': 'Sélectionnez {filename}.',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR nécessite son artefact encoder.int8.onnx. Sélectionnez encoder.int8.onnx dans le répertoire de modèles 560 ms épinglés.',
  'models.external.validation.moonshineEntryFile':
    'Moonshine nécessite son artefact frontend.ort principal. Sélectionnez frontend.ort dans le répertoire du modèle de streaming.',
  'models.external.validation.generic': "Le moteur vocal n'a pas pu valider ce modèle.",
  'models.external.requirements.nemotron.entry':
    "Sélectionnez encoder.int8.onnx à partir de l'exportation Nemotron 3.5 ASR 560 ms int8 épinglée.",
  'models.external.requirements.nemotron.siblings':
    'Le même répertoire doit contenir decoder.int8.onnx, joiner.int8.onnx et tokens.txt.',
  'models.external.requirements.nemotron.compatibility':
    'Les autres tailles de fragments et les exportations ORT GenAI ne sont pas compatibles avec cet adaptateur.',
  'models.external.requirements.moonshine.entry':
    'Sélectionnez frontend.ort dans un répertoire de modèles ORT de streaming Moonshine v2.',
  'models.external.requirements.moonshine.siblings':
    'Le même répertoire doit contenir encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json et tokenizer.bin.',
  'models.external.requirements.moonshine.compatibility':
    'Les exportations Moonshine ONNX sans streaming ne sont pas compatibles.',
  'models.external.requirements.whisper.entry':
    'Sélectionnez un fichier de modèle GGML ou GGUF compatible avec whisper.cpp.',
  'models.external.requirements.whisper.validation':
    'Le chargeur valide le contenu du fichier ; une extension de nom de fichier à elle seule n’établit pas la compatibilité.',
  'models.external.requirements.whisper.language':
    'Les fichiers Whisper avec des pondérations .en sont uniquement en anglais ; les pondérations multilingues exposent le sélecteur de langue vérifié et la détection automatique.',
  'models.details.totalSize': 'Taille totale',
  'models.details.source': 'Source',
  'models.details.license': 'Licence',
  'models.details.capabilities': 'Capacités',
  'models.details.installPath': "Chemin d'installation",
  'models.details.files': 'Fichiers ({count})',
  'models.details.size': 'Taille',
  'models.capability.segmentTimestamps': 'Horodatage des segments',
  'models.capability.wordTimestamps': 'Horodatage des mots',
  'models.capability.initialPrompt': 'Invite initiale',
  'models.capability.streaming': 'Streaming',
  'models.capability.autoLanguageDetection': 'Détection de langue',
  'models.capability.punctuation': 'Ponctuation',
  'models.capability.maxAudio': 'Audio maximal : {seconds} s',
  'models.capability.anyLanguage': "N'importe quelle langue",
  'models.capability.englishOnly': 'Anglais uniquement',
  'models.capability.languageCount': '{count} langues',
  'models.capability.languageSelection': 'Sélection de la langue',
  'models.tag.fullPrecision': 'Pleine précision',
  'models.tag.reducedSize': 'Taille réduite',
  'models.progress.preparing': 'Préparer l’installation',
  'models.progress.downloading': 'Téléchargement',
  'models.progress.verifying': 'Vérification du téléchargement',
  'models.progress.validating': 'Validation du modèle',
  'models.progress.installed': 'Modèle installé',
  'models.progress.cancelled': 'Installation du modèle annulée',
  'models.progress.failed': "Échec de l'installation du modèle",
  'models.progress.downloadingFile': 'Téléchargement de {filename}',
  'models.progress.verifyingFile': 'Vérification de {filename}',
  'models.progress.fileCount': 'Fichier {current} de {total}',
  'models.current.noneSelected': 'Aucun modèle sélectionné',
  'models.current.noneSelectedDesc': 'Choisissez un modèle installé ou validez un fichier externe.',
  'models.current.notSelected': 'Non sélectionné',
  'models.current.externalFile': 'Fichier externe',
  'models.current.managedNotInstalled': "Le modèle géré sélectionné n'est pas installé.",
  'models.current.installed': 'Installé',
  'models.current.notInstalled': 'Non installé',
  'models.current.managedDownload': 'Téléchargement géré',
  'models.current.externalValidated': 'Fichier externe validé',
  'models.current.checking': 'Vérification',
  'models.current.externalUnavailableDesc':
    "Le modèle externe n'est pas disponible. Validez à nouveau le fichier pour voir les détails.",
  'models.current.unavailable': 'Indisponible',
  'models.current.validateBeforeDictating': 'Validez le fichier de modèle externe avant de dicter.',
  'sidecarError.audio_too_long': 'Le clip audio dépasse la durée maximale pour ce moteur.',
  'sidecarError.engine_inference_failed': 'La transcription locale a échoué.',
  'sidecarError.internal_error': 'Le moteur vocal a rencontré une erreur interne.',
  'sidecarError.invalid_audio_buffer':
    'Le tampon audio était vide lorsque la transcription a commencé.',
  'sidecarError.invalid_audio_frame': 'Le moteur vocal a reçu une trame audio non valide.',
  'sidecarError.invalid_diarization_speaker_limit':
    "Le nombre maximal de locuteurs doit être d'au moins 1 ou réglé sur Automatique.",
  'sidecarError.invalid_frame': 'Le moteur vocal a reçu une trame de protocole non valide.',
  'sidecarError.invalid_model_file':
    'Le fichier modèle est manquant, illisible ou non pris en charge.',
  'sidecarError.invalid_model_task':
    'Le modèle sélectionné ne peut pas être utilisé pour la dictée.',
  'sidecarError.invalid_model_store':
    'Le dossier de stockage des modèles est indisponible ou non valide.',
  'sidecarError.missing_model_file':
    'Le fichier modèle n’existe pas ou n’est pas un fichier standard.',
  'sidecarError.no_active_install': "Il n'y a pas d'installation de modèle active à annuler.",
  'sidecarError.no_active_session': "Il n'y a pas de session de dictée active.",
  'sidecarError.session_already_exists': 'Une session de dictée avec cet identifiant existe déjà.',
  'sidecarError.session_capacity_exceeded':
    'Speech Kit a déjà le nombre maximum de sessions actives.',
  'sidecarError.system_audio_capture_failed': 'Impossible de démarrer la capture audio du système.',
  'sidecarError.system_audio_permission_denied':
    "L'autorisation d'enregistrement audio du système est désactivée pour Obsidian. Ouvrez Paramètres système → Confidentialité et sécurité → Écran et enregistrement audio du système, activez Obsidian et réessayez.",
  'sidecarError.system_audio_unsupported':
    "La capture audio du système n'est pas encore disponible sur cette plate-forme. Acheminez la sortie de cet ordinateur via un périphérique audio virtuel et choisissez-le comme microphone – consultez le guide audio du système.",
  'sidecarError.transcription_failure': 'La transcription locale a échoué.',
  'sidecarError.unsupported_engine': "Le moteur demandé n'est pas disponible dans cette version.",
  'sidecarError.unsupported_language':
    'Le modèle sélectionné ne prend pas en charge cette langue de dictée.',
  'sidecarError.utterance_dropped_during_overload_drain':
    "Un énoncé finalisé a été abandonné pendant le vidage de la file d'attente de transcription.",
  'sidecarError.utterance_queue_overload':
    "Dictée arrêtée car la file d'attente de transcription est surchargée. L'audio accepté terminera le traitement.",
  'sidecarError.vad_error': "La détection de l'activité vocale a échoué sur une trame audio.",
  'sidecarError.vad_init_failed': "Échec de l'initialisation du VAD Silero intégré.",
  'sidecarError.worker_panic':
    "Le processus de transcription du moteur vocal s'est arrêté de manière inattendue.",
  'catalog.whisper_tiny_en_q8_0.summary':
    'Modèle le plus rapide avec le coût des ressources le plus bas. Idéal pour les tests ou les machines à faible consommation.',
  'catalog.whisper_base_en_q8_0.summary':
    'Modèle rapide avec une précision décente. Un bon choix pour des brouillons rapides sur CPU.',
  'catalog.whisper_small_en_q5_1.summary':
    'Équilibre la qualité de la transcription, la taille du téléchargement et la vitesse CPU.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Modèle de haute précision destiné aux utilisateurs qui privilégient la qualité de transcription à la vitesse.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    "Transcription multilingue de haute précision avec une architecture optimisée pour l'accélération GPU.",
  'catalog.cohere_transcribe_fp16.summary':
    'Plus grande variante Cohere, préservant la précision complète du modèle.',
  'catalog.cohere_transcribe_int8.summary':
    'Variante centrale Cohere par taille de téléchargement, utilisant une quantification 8 bits.',
  'catalog.cohere_transcribe_q4.summary':
    'Variante Cohere la plus petite ; la quantification 4 bits réduit la taille à un coût de qualité.',
  'catalog.moonshine_tiny_streaming_en.summary':
    'Modèle de streaming Moonshine le plus rapide avec 34 millions de paramètres, conçu pour les CPU bas de gamme.',
  'catalog.moonshine_small_streaming_en.summary':
    'Modèle de dictée en direct équilibré avec 123 millions de paramètres.',
  'catalog.moonshine_medium_streaming_en.summary':
    'Modèle de streaming Moonshine le plus précis à 245M paramètres.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'RNNT multilingue 0,6B de NVIDIA, exporté vers int8 ONNX pour une transcription en direct prenant en compte le cache dans huit langues vérifiées.',
  'catalog.family.whisper.summary':
    'Transcrit après chaque pause. Whisper fournit des horodatages plus précis que les autres familles de modèles, avec notamment une synchronisation facultative au niveau des mots. Tiny et Base privilégient la vitesse, Small équilibre vitesse et qualité, et Medium et Large privilégient la qualité.',
  'catalog.family.cohere_transcribe.summary':
    'Transcription par lots de haute qualité avec des besoins de téléchargement et de mémoire de plusieurs gigaoctets.',
  'catalog.family.moonshine.summary':
    'Affiche les mots pendant que vous parlez. Tiny favorise une moindre utilisation des ressources, Small équilibre vitesse et qualité, et Medium favorise la qualité.',
  'catalog.family.nemotron_asr.summary':
    'Streaming multilingue de haute précision avec un téléchargement plus important et une utilisation plus importante des ressources. Moonshine Small reste la version par défaut recommandée pour la dictée en direct en anglais.',
  'setup.sidecar.modal.unsupportedPlatform':
    "Cette version du moteur vocal n'est pas disponible pour votre plate-forme ou votre architecture.",
  'setup.sidecar.modal.genericInstallError':
    "Le moteur vocal n'a pas pu être installé. Consultez les journaux du plugin pour plus de détails, puis réessayez.",
  'commands.readAloud': 'Lire depuis la sélection ou le début de la note',
  'commands.readAloudFromCursor': 'Lire à voix haute depuis le curseur',
  'commands.pauseResumeReadAloud': 'Mettre en pause ou reprendre la lecture',
  'commands.stopReadAloud': 'Arrêter la lecture',
  'settings.groups.readAloud': 'Lecture à voix haute',
  'settings.model.noModelSelected': 'Aucun modèle sélectionné',
  'settings.model.speechToText': 'Modèle de reconnaissance vocale',
  'settings.model.textToSpeech': 'Modèle de synthèse vocale',
  'settings.readAloud.hotkey': 'Raccourci recommandé',
  'settings.readAloud.hotkeyDesc':
    'Associez un raccourci à Lire depuis la sélection ou le début de la note. Le texte sélectionné est lu, sinon la note entière.',
  'settings.readAloud.highlightSpokenText': 'Surligner le texte lu',
  'settings.readAloud.highlightSpokenTextDesc':
    'Surligne le bloc actuellement lu dans l’éditeur pendant la lecture à voix haute.',
  'settings.readAloud.voice': 'Voix',
  'settings.readAloud.voiceDesc':
    'Choisissez parmi les voix installées pour le modèle sélectionné.',
  'settings.readAloud.noVoices': 'Aucune voix installée',
  'settings.readAloud.speed': 'Vitesse de lecture',
  'settings.readAloud.speedDesc':
    'Modifier la vitesse pendant la lecture redémarre à la phrase actuelle.',
  'models.manage.dictationModels': 'Reconnaissance vocale',
  'models.manage.readAloudModels': 'Synthèse vocale',
  'models.manage.allLanguages': 'Toutes les langues',
  'models.manage.familiesLabel': 'Familles de modèles',
  'models.manage.noneForLanguage': 'Aucun modèle disponible pour cette tâche et cette langue.',
  'models.manage.optionalVoice': 'Voix locale facultative',
  'models.manage.voiceInstalled': 'Installée',
  'tts.status.reading': 'Lecture…',
  'tts.status.paused': 'Lecture en pause',
  'tts.control.model': 'Modèle : {model}',
  'tts.control.speed': 'Vitesse : {speed}',
  'tts.notice.noText': "Il n'y a aucun texte lisible ici.",
  'tts.notice.modelRequired': "Installez et sélectionnez d'abord un modèle de lecture.",
  'tts.notice.voiceRequired': "Sélectionnez d'abord une voix installée.",
  'tts.notice.startFailed': 'Impossible de démarrer la lecture.',
  'tts.notice.playbackFailed': 'La lecture audio a échoué.',
  'tts.notice.sidecarExited': "La lecture s'est arrêtée car le sidecar a quitté inopinément.",
  'sidecarError.invalid_synthesis_request': 'La demande de lecture est invalide.',
  'sidecarError.missing_voice_file': "La voix de lecture sélectionnée n'est pas installée.",
  'sidecarError.sidecar_exited': 'Le processus sidecar a quitté inopinément.',
  'sidecarError.synthesis_cancelled': 'La lecture a été annulée.',
  'sidecarError.synthesis_failed': 'La synthèse vocale locale a échoué.',
  'sidecarError.synthesis_worker_unavailable':
    "Le processus de synthèse vocale locale n'est pas disponible.",
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Lecture naturelle en anglais, locale, avec un choix de voix sélectionnées.',
  'catalog.family.pocket_tts.summary':
    'Lit les notes localement en anglais, français, allemand, espagnol, portugais et italien avec plusieurs voix et un réglage de vitesse qui préserve la hauteur.',
  'commands.translateNote': 'Traduire la note',
  'commands.translateSelection': 'Traduire la sélection',
  'models.manage.translationModels': 'Traduction',
  'translation.modal.privacy': 'La traduction s’exécute entièrement sur cet appareil.',
  'translation.modal.from': 'De',
  'translation.modal.to': 'Vers',
  'translation.modal.swap': 'Inverser',
  'translation.modal.largeNote': 'Note volumineuse : la traduction peut prendre quelques secondes.',
  'translation.modal.sourceSelection': 'Sélection source',
  'translation.modal.sourceNote': 'Note source',
  'translation.modal.previewAria': 'Aperçu de la traduction',
  'translation.modal.readAloud': 'Lire la traduction à voix haute en {language}',
  'translation.modal.preparing': 'Préparation de la traduction locale…',
  'translation.modal.loading': 'Chargement du modèle local…',
  'translation.modal.translating': 'Traduction en cours…',
  'translation.modal.translatingProgress': 'Traduction du bloc {completed} sur {total}…',
  'translation.modal.ready': 'Traduction prête.',
  'translation.modal.readyPartial_one':
    'Traduction prête. 1 bloc est resté dans la langue source car sa mise en forme n’a pas pu être conservée.',
  'translation.modal.readyPartial_other':
    'Traduction prête. {count} blocs sont restés dans la langue source car leur mise en forme n’a pas pu être conservée.',
  'translation.modal.canceled': 'Traduction annulée.',
  'translation.modal.failed': 'La traduction a échoué.',
  'translation.modal.missingModel':
    'Installez le pack de traduction locale pour utiliser cette paire de langues.',
  'translation.modal.missingEngineModel':
    '{style} n’est pas installé. Installez son modèle local pour traduire cette paire de langues.',
  'translation.modal.unsupportedPairModel':
    'Vos modèles de traduction installés ne prennent pas en charge cette paire de langues.',
  'translation.modal.incompleteModel':
    'Il manque des fichiers au modèle de traduction. Réinstallez-le pour continuer.',
  'translation.modal.installModel': 'Installer le modèle de traduction',
  'translation.modal.translateAgain': 'Traduire à nouveau',
  'translation.modal.retryReady':
    'Les réglages de traduction ont changé. Sélectionnez Traduire à nouveau pour actualiser l’aperçu.',
  'translation.modal.cancel': 'Annuler',
  'translation.modal.replace': 'Remplacer',
  'translation.modal.insertBelow': 'Insérer en dessous',
  'translation.modal.copy': 'Copier',
  'translation.modal.dismiss': 'Ignorer',
  'translation.modal.stale':
    'La note a changé depuis le début de cette traduction. Lancez une nouvelle traduction ou copiez celle-ci.',
  'translation.notice.copied': 'Traduction copiée.',
  'translation.notice.copyFailed': 'Impossible de copier la traduction.',
  'translation.notice.tooLong': 'Traduisez jusqu’à {count} caractères à la fois.',
  'catalog.firefox_translations_release_2026_07.summary':
    'Traduction locale rapide avec de petits packs de langues à la demande et les modèles publiés dans Firefox.',
  'catalog.family.firefox_translations.summary':
    'Traduit localement le texte des notes avec le moteur compact Bergamot et les modèles Firefox.',
} as const satisfies TranslationCatalog;
