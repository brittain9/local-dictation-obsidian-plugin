import type { TranslationCatalog } from './index';

export const it = {
  'notice.dictationNotActive': 'La dettatura non è attiva.',
  'notice.dictationStartFailed': 'Impossibile avviare la dettatura.',
  'notice.dictationStopFailed': 'Impossibile interrompere la dettatura.',
  'notice.lastUtteranceCleared': 'L’ultima frase conservata è stata eliminata.',
  'notice.lastUtteranceReinsertFailed': 'Impossibile reinserire l’ultima frase completata.',
  'notice.lastUtteranceReinserted': 'L’ultima frase completata è stata reinserita.',
  'notice.lastUtteranceUnavailable': 'Non è disponibile alcuna frase completata da reinserire.',
  'notice.llmTransformEmpty': 'La trasformazione LLM non ha restituito nulla da aggiungere.',
  'notice.microphoneDisconnected':
    'Microfono disconnesso. La dettatura è stata interrotta e terminerà l’elaborazione dell’audio già acquisito. Ricollega il microfono, quindi avvia di nuovo la dettatura.',
  'notice.rawTranscriptChanged':
    'Impossibile ripristinare la trascrizione grezza perché la nota è stata modificata dopo la pulizia.',
  'notice.rawTranscriptCleared': 'Dati di recupero della trascrizione grezza eliminati.',
  'notice.rawTranscriptCopied': 'Trascrizione grezza copiata.',
  'notice.rawTranscriptCopyFailed': 'Impossibile copiare la trascrizione grezza.',
  'notice.rawTranscriptRestored': 'Trascrizione grezza ripristinata.',
  'notice.rawTranscriptRestoreFailed': 'Impossibile ripristinare la trascrizione grezza.',
  'notice.rawTranscriptTargetUnavailable':
    'Impossibile ripristinare la trascrizione grezza perché la nota originale non è più aperta nello stesso editor.',
  'notice.rawTranscriptUnavailable':
    'Non sono disponibili dati di recupero della trascrizione grezza.',
  'notice.sidecarHealthCheckFailed': 'Controllo dello stato del sidecar non riuscito',
  'notice.sidecarReady': 'Il sidecar è pronto ({version}).',
  'notice.sidecarRestarted': 'Sidecar riavviato ({version}).',
  'notice.sidecarRestartFailed': 'Riavvio del sidecar non riuscito',
  'notice.sidecarRestartRequiresIdle':
    'Riavvia il sidecar solo quando dettatura e lettura non sono attive.',
  'notice.transcriptRecordFailed': 'Impossibile registrare la trascrizione.',
  'notice.sidecarSessionError': 'Il motore di riconoscimento vocale ha segnalato un errore.',
  'notice.sidecarVersionDrift.actionMultiple': 'Aggiorna i motori di riconoscimento vocale',
  'notice.sidecarVersionDrift.actionOne': 'Aggiorna il motore di riconoscimento vocale',
  'notice.sidecarVersionDrift.cpu':
    'Aggiornamento a {version} completato, ma il motore di riconoscimento vocale installato non è aggiornato. Aggiornalo ora affinché corrisponda alla nuova versione.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Aggiornamento a {version} completato, ma i motori di riconoscimento vocale CPU e CUDA installati non sono aggiornati. Aggiornali ora affinché corrispondano alla nuova versione.',
  'notice.sidecarVersionDrift.cuda':
    'Aggiornamento a {version} completato, ma il motore di riconoscimento vocale CUDA installato non è aggiornato. Aggiornalo ora affinché corrisponda alla nuova versione.',
  'notice.surfaceDesynchronized':
    'La dettatura è stata interrotta perché la nota è cambiata in un modo che Speech Kit non è riuscito a rilevare in sicurezza. Avvia di nuovo la dettatura per continuare.',
  'notice.targetNoteClosed':
    'La dettatura è stata interrotta perché la nota di destinazione è stata chiusa o sostituita. Avvia di nuovo la dettatura per continuare.',
  'notice.targetNoteDeleted':
    'La dettatura è stata interrotta perché la nota di destinazione è stata eliminata. Ripristina o ricrea la nota, quindi avvia di nuovo la dettatura.',
  'notice.transcriptWriteFailed':
    'La dettatura è stata interrotta perché Speech Kit non è riuscito a scrivere nella nota in sicurezza. Avvia di nuovo la dettatura per continuare.',
  'setup.sidecar.cpu.firstRun.body':
    'Speech Kit deve scaricare una sola volta il motore CPU di conversione da voce a testo dalle release di GitHub. Al termine, la trascrizione verrà eseguita localmente sul computer. Potrai installare in seguito l’accelerazione CUDA dalle impostazioni.',
  'setup.sidecar.cpu.firstRun.primaryButton': 'Scarica il sidecar CPU',
  'setup.sidecar.cpu.firstRun.success': 'Sidecar di Speech Kit installato e avviato.',
  'setup.sidecar.cpu.firstRun.title': 'Completa la configurazione di Speech Kit',
  'setup.sidecar.cpu.install.body':
    'Scarica il motore CPU di conversione da voce a testo dalle release di GitHub. Al termine, la trascrizione verrà eseguita localmente sul computer.',
  'setup.sidecar.cpu.install.primaryButton': 'Scarica il sidecar CPU',
  'setup.sidecar.cpu.install.success': 'Sidecar CPU installato e avviato.',
  'setup.sidecar.cpu.install.title': 'Installa il sidecar CPU',
  'setup.sidecar.cpu.reinstall.body':
    'Scarica di nuovo il motore CPU di conversione da voce a testo dalle release di GitHub. L’installazione CPU corrente verrà sostituita.',
  'setup.sidecar.cpu.reinstall.primaryButton': 'Scarica di nuovo il sidecar CPU',
  'setup.sidecar.cpu.reinstall.success': 'Sidecar CPU reinstallato e riavviato.',
  'setup.sidecar.cpu.reinstall.title': 'Reinstalla il sidecar CPU',
  'setup.sidecar.cuda.install.primaryButton': 'Scarica il sidecar CUDA',
  'setup.sidecar.cuda.install.success': 'Sidecar CUDA installato e avviato.',
  'setup.sidecar.cuda.install.title': 'Installa l’accelerazione CUDA',
  'setup.sidecar.mac.firstRun.body':
    'Speech Kit deve scaricare una sola volta il proprio motore di conversione da voce a testo dalle release di GitHub. Dopo l’installazione, la trascrizione verrà eseguita interamente sul Mac: l’audio non lascerà mai il computer.',
  'setup.sidecar.mac.firstRun.primaryButton': 'Scarica il sidecar',
  'setup.sidecar.mac.firstRun.success': 'Sidecar di Speech Kit installato e avviato.',
  'setup.sidecar.mac.firstRun.title': 'Completa la configurazione di Speech Kit',
  'setup.sidecar.mac.install.body':
    'Scarica il motore di conversione da voce a testo dalle release di GitHub. Al termine, la trascrizione verrà eseguita localmente sul Mac.',
  'setup.sidecar.mac.install.primaryButton': 'Scarica il sidecar',
  'setup.sidecar.mac.install.success': 'Sidecar installato e avviato.',
  'setup.sidecar.mac.install.title': 'Installa il sidecar',
  'setup.sidecar.mac.reinstall.body':
    'Scarica di nuovo il motore di conversione da voce a testo dalle release di GitHub. L’installazione corrente verrà sostituita.',
  'setup.sidecar.mac.reinstall.primaryButton': 'Scarica di nuovo il sidecar',
  'setup.sidecar.mac.reinstall.success': 'Sidecar reinstallato e riavviato.',
  'setup.sidecar.mac.reinstall.title': 'Reinstalla il sidecar',
  'setup.sidecar.update.body':
    'Scarica {engineLabel} nella versione corrispondente a quella di Speech Kit. Le installazioni esistenti verranno sostituite sul posto.',
  'setup.sidecar.update.engine.cpuAndCuda': 'i motori di riconoscimento vocale CPU e CUDA',
  'setup.sidecar.update.engine.cuda': 'il motore di riconoscimento vocale CUDA',
  'setup.sidecar.update.engine.default': 'il motore di riconoscimento vocale',
  'setup.sidecar.update.primaryButton_one': 'Aggiorna il motore di riconoscimento vocale',
  'setup.sidecar.update.primaryButton_other': 'Aggiorna i motori di riconoscimento vocale',
  'setup.sidecar.update.success_one':
    'Motore di riconoscimento vocale di Speech Kit aggiornato e riavviato.',
  'setup.sidecar.update.success_other':
    'Motori di riconoscimento vocale di Speech Kit aggiornati e riavviati.',
  'setup.sidecar.update.title_one': 'Aggiorna il motore di riconoscimento vocale',
  'setup.sidecar.update.title_other': 'Aggiorna i motori di riconoscimento vocale',
  'audio.microphone.permissionDeniedMac':
    'Accesso al microfono negato. Apri Impostazioni di Sistema → Privacy e sicurezza → Microfono, abilita Obsidian, quindi riavvia Obsidian e riprova.',
  'audio.microphone.permissionDenied':
    'Accesso al microfono negato. Concedi l’accesso nelle impostazioni del sistema operativo e riprova.',
  'audio.microphone.notFound':
    'Nessun microfono rilevato. Collega un microfono o delle cuffie USB oppure abilita un dispositivo di input nelle impostazioni audio del sistema operativo, quindi riprova.',
  'audio.microphone.notReadable':
    'Impossibile aprire il microfono. Potrebbe essere utilizzato da un’altra applicazione oppure potrebbe essersi verificato un errore del dispositivo audio. Chiudi le altre applicazioni che usano il microfono e riprova.',
  'audio.systemAudio.notReady': 'L’audio di sistema non è pronto.',
  'audio.systemAudio.outdatedInstaller':
    '{message} Il programma di installazione di Obsidian è precedente all’autorizzazione di macOS per l’audio di sistema. Scarica un programma di installazione aggiornato da obsidian.md, reinstalla l’applicazione e riprova.',
  'commands.toggleDictation': 'Attiva o disattiva la dettatura',
  'commands.startDictation': 'Avvia la dettatura',
  'commands.stopDictation': 'Interrompi la dettatura',
  'commands.cancelDictation': 'Annulla la dettatura',
  'commands.reinsertLastUtterance': 'Reinserisci l’ultima frase',
  'commands.clearLastUtterance': 'Elimina l’ultima frase',
  'commands.restoreRawTranscript': 'Ripristina la trascrizione grezza',
  'commands.copyRawTranscript': 'Copia la trascrizione grezza',
  'commands.clearRawRecovery': 'Elimina i dati di recupero della trascrizione grezza',
  'commands.checkSidecarHealth': 'Controlla lo stato del sidecar',
  'commands.restartSidecar': 'Riavvia il sidecar',
  'common.reset': 'Ripristina',
  'settings.acceleration.pending': 'in sospeso (sidecar non pronto)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} non disponibile)',
  'settings.acceleration.unknownReason': 'motivo sconosciuto',
  'settings.dictationLanguage.autoDetect': 'Rilevamento automatico',
  'settings.dictationLanguage.name': 'Lingua della dettatura',
  'settings.dictationLanguage.englishOnlyDesc':
    'Il modello selezionato, {model}, supporta solo l’inglese.',
  'settings.dictationLanguage.desc':
    'Scegli la lingua in cui parlerai. La selezione manuale assicura una pulizia più prevedibile. Il rilevamento automatico può avviarsi più lentamente e sceglie una lingua per ogni frase.',
  'settings.dictationLanguage.unsupported': '{language} (non supportata)',
  'settings.engine.named': 'Motore {engine}',
  'settings.groups.model': 'Modelli',
  'settings.groups.capture': 'Acquisizione',
  'settings.groups.transcriptOutput': 'Output della trascrizione',
  'settings.groups.llmTransformation': 'Trasformazione LLM',
  'settings.groups.engine': 'Motore',
  'settings.groups.advanced': 'Avanzate',
  'settings.listeningMode.alwaysOn': 'Sempre attiva',
  'settings.listeningMode.oneSentence': 'Una frase',
  'settings.listeningMode.name': 'Modalità di ascolto',
  'settings.listeningMode.desc': 'Continua oppure si interrompe dopo una frase.',
  'settings.insertText.atCursor': 'Alla posizione del cursore',
  'settings.insertText.endOfNote': 'Alla fine della nota',
  'settings.insertText.name': 'Inserimento del testo',
  'settings.insertText.desc': 'Dove viene inserito il testo dettato.',
  'settings.transcriptFormatting.smartParagraphs': 'Paragrafi intelligenti',
  'settings.transcriptFormatting.space': 'Spazio',
  'settings.transcriptFormatting.newLine': 'Nuova riga',
  'settings.transcriptFormatting.newParagraph': 'Nuovo paragrafo',
  'settings.transcriptFormatting.name': 'Formattazione della trascrizione',
  'settings.transcriptFormatting.desc': 'Come vengono unite le frasi.',
  'settings.phraseFinalization.responsiveOption': 'Reattiva — pause brevi',
  'settings.phraseFinalization.balancedOption': 'Bilanciata — standard',
  'settings.phraseFinalization.patientOption': 'Tollerante — pause lunghe',
  'settings.phraseFinalization.name': 'Finalizzazione della frase',
  'settings.phraseFinalization.responsive':
    'Completa la frase dopo pause più brevi, per mostrare prima il testo definitivo.',
  'settings.phraseFinalization.balanced':
    'Usa la tolleranza standard alle pause per la dettatura quotidiana.',
  'settings.phraseFinalization.patient':
    'Attende durante le pause più lunghe, riducendo la probabilità che un pensiero venga diviso.',
  'settings.phraseFinalization.tooltip':
    'Si applica a ogni modello di trascrizione. Le parole visualizzate in tempo reale possono comunque aggiornarsi prima che la frase sia definitiva. Modifica i confini dell’attività vocale, non lo stile di scrittura né l’accuratezza del modello. Reattiva privilegia la velocità; Tollerante tende a mantenere le pause all’interno di un’unica frase.',
  'settings.systemAudio.name': 'Includi l’audio di sistema',
  'settings.systemAudio.desc':
    'Acquisisci anche l’uscita audio predefinita di questo computer per riunioni, chiamate e video.',
  'settings.systemAudio.ready': 'L’audio di sistema è pronto.',
  'settings.systemAudio.testFailed':
    'Impossibile verificare l’audio di sistema. Controlla che il motore di riconoscimento vocale sia installato e riprova.',
  'settings.speakerLabels.name': 'Etichette dei parlanti',
  'settings.speakerLabels.desc': 'Identifica ogni frase con il relativo parlante.',
  'settings.speakerLabels.streamingLimitation':
    'Le etichette dei parlanti richiedono un modello batch.',
  'settings.speakerLabels.modal.title': 'Impostazioni delle etichette dei parlanti',
  'settings.speakerLabels.modal.intro':
    'Le etichette dei parlanti vengono elaborate sul dispositivo dopo ogni frase rilevata tramite attività vocale. Richiedono un modello di trascrizione batch.',
  'settings.speakerLabels.maximumSpeakers.name': 'Numero massimo di parlanti',
  'settings.speakerLabels.maximumSpeakers.desc':
    'L’opzione Automatico determina il numero di parlanti. Imposta un limite solo se compaiono etichette superflue.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Abilita le etichette dei parlanti prima di configurarne il limite.',
  'settings.speakerLabels.automatic': 'Automatico',
  'settings.timestamps.enable.name': 'Usa i timestamp',
  'settings.timestamps.enable.desc': 'Aggiungi riferimenti temporali alle trascrizioni dettate.',
  'settings.timestamps.modal.title': 'Impostazioni dei timestamp',
  'settings.timestamps.modal.intro':
    'Scegli i riferimenti a intervalli regolari, ai confini delle frasi o alle interruzioni dei Paragrafi intelligenti.',
  'settings.timestamps.clock.elapsed': 'Tempo trascorso',
  'settings.timestamps.clock.wallClock': 'Ora locale',
  'settings.timestamps.frequency.atIntervals': 'A intervalli',
  'settings.timestamps.frequency.everyPhrase': 'A ogni frase',
  'settings.timestamps.frequency.atParagraphBreaks': 'Alle interruzioni di paragrafo',
  'settings.timestamps.sessionHeader.name': 'Intestazione della sessione',
  'settings.timestamps.sessionHeader.desc':
    'Inizia ogni sessione con timestamp usando [YYYY-MM-DD HH:MM].',
  'settings.timestamps.referenceClock.name': 'Orologio di riferimento',
  'settings.timestamps.referenceClock.desc':
    'Tempo trascorso dall’avvio della dettatura oppure ora locale.',
  'settings.timestamps.frequency.name': 'Frequenza',
  'settings.timestamps.frequency.desc': 'Scegli la frequenza con cui visualizzare i timestamp.',
  'settings.timestamps.frequency.sparseDesc':
    'Aggiunge riferimenti leggibili all’intervallo configurato.',
  'settings.timestamps.frequency.everyPhraseDesc':
    'Aggiunge un timestamp prima di ogni segmento temporizzato dal modello, quando disponibile; altrimenti, a ogni frase rilevata tramite attività vocale.',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    'Imposta Formattazione della trascrizione su Paragrafi intelligenti per ottenere le interruzioni di paragrafo.',
  'settings.timestamps.frequency.paragraphDesc':
    'Aggiunge un timestamp all’inizio della sessione e a ogni interruzione dei Paragrafi intelligenti.',
  'settings.timestamps.interval.name': 'Intervallo',
  'settings.timestamps.interval.desc': 'Secondi tra i riferimenti temporali ({min}-{max}).',
  'settings.timestamps.interval.inactiveDesc':
    'Usato solo quando la frequenza è impostata su A intervalli.',
  'settings.timestamps.interval.validation':
    'Inserisci un numero intero di secondi compreso tra {min} e {max}.',
  'settings.smartParagraph.modal.title': 'Impostazioni dei Paragrafi intelligenti',
  'settings.smartParagraph.modal.intro':
    'I Paragrafi intelligenti trasformano le pause più lunghe in interruzioni di riga o di paragrafo. Questi valori si applicano solo quando Formattazione della trascrizione è impostata su Paragrafi intelligenti.',
  'settings.smartParagraph.lineBreakPause.name': 'Pausa per una nuova riga',
  'settings.smartParagraph.lineBreakPause.desc':
    'Secondi prima di una singola interruzione di riga ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Pausa per un nuovo paragrafo',
  'settings.smartParagraph.paragraphPause.desc':
    'Secondi prima di un’interruzione di paragrafo ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Abilita le funzionalità LLM',
  'settings.llm.enableFeatures.desc':
    'Rende disponibili le trasformazioni LLM. Attiva o disattiva la trasformazione nella barra laterale.',
  'settings.llm.restoreDefaults.name': 'Ripristina i valori predefiniti della trasformazione',
  'settings.llm.restoreDefaults.desc':
    'Ripristina preset, tempistica, contesto, numero minimo di parole e temperatura. I preset e i modelli salvati vengono mantenuti.',
  'settings.llm.restoreDefaults.button': 'Ripristina',
  'settings.llm.restoreDefaults.confirmMessage':
    'Ripristinare preset, tempistica, contesto, numero minimo di parole e temperatura predefiniti? I preset e i modelli salvati verranno mantenuti.',
  'settings.llm.migratedPreset': 'Il mio preset',
  'settings.llm.migratedPresetNumbered': 'Il mio preset {number}',
  'settings.recoveryMemory.name': 'Mantieni in memoria il testo di recupero',
  'settings.recoveryMemory.desc':
    'Conserva in memoria il testo recuperabile più recente e un’istantanea della nota. Non viene scritto nulla sul disco.',
  'settings.modelStoreOverride.name': 'Cartella alternativa per l’archivio dei modelli',
  'settings.modelStoreOverride.desc':
    'Cartella personalizzata per il download dei modelli gestiti.',
  'settings.modelStoreOverride.placeholder': 'Usa l’archivio dei modelli condiviso predefinito',
  'settings.runSetup.name': 'Esegui la configurazione',
  'settings.runSetup.desc': 'Esegui di nuovo la procedura di configurazione iniziale.',
  'settings.hardwareAcceleration.name': 'Accelerazione hardware',
  'settings.hardwareAcceleration.desc': 'Esegui l’inferenza sulla GPU quando disponibile.',
  'settings.hardwareAcceleration.busy':
    'Non è possibile modificare l’accelerazione hardware durante la dettatura o la lettura ad alta voce. Se la dettatura è ancora in elaborazione dopo averla interrotta, esegui “Annulla la dettatura”.',
  'settings.hardwareAcceleration.on': 'Accelerazione hardware attiva.',
  'settings.hardwareAcceleration.off': 'Accelerazione hardware disattivata.',
  'settings.noteContext.name': 'Usa la nota come contesto',
  'settings.noteContext.desc':
    'Per l’inglese selezionato manualmente, invia i termini distintivi della nota aperta per migliorare l’ortografia.',
  'settings.noteContext.tooltip':
    'Invia un glossario di nomi propri e termini tecnici come prompt iniziale del motore. Viene usato solo per l’inglese selezionato manualmente con motori che supportano i prompt iniziali.',
  'settings.microphone.name': 'Microfono',
  'settings.microphone.desc':
    'Microfono da usare per la dettatura. Le modifiche verranno applicate nella sessione di dettatura successiva.',
  'settings.microphone.default': 'Microfono predefinito',
  'settings.microphone.labelUnavailable': 'Microfono (etichetta non disponibile)',
  'settings.microphone.notConnected': '{microphone} (non connesso)',
  'settings.microphone.detectTooltip': 'Rileva i microfoni (richiede l’autorizzazione)',
  'settings.microphone.allowAccessFirst':
    'Prima consenti l’accesso al microfono per salvare questo dispositivo.',
  'settings.microphone.stopDictationToDetect': 'Interrompi la dettatura per rilevare i microfoni.',
  'settings.microphone.unavailableRuntime':
    'L’accesso al microfono non è disponibile in questo ambiente di esecuzione.',
  'settings.microphone.detectFailed':
    'Impossibile rilevare i microfoni. Controlla le impostazioni audio del sistema.',
  'settings.microphone.fallbackSaveFailed':
    'Il microfono salvato non è disponibile. Viene usato il microfono predefinito, ma non è stato possibile salvare questa modifica. Seleziona un microfono disponibile nelle Impostazioni prima di riavviare Obsidian.',
  'settings.microphone.fallbackUnchanged':
    'Il microfono salvato non è disponibile. Per questa sessione viene usato il microfono predefinito; l’impostazione attuale del microfono è rimasta invariata.',
  'settings.microphone.fallbackCleared':
    'Il microfono salvato non è disponibile. Viene usato il microfono predefinito; la selezione salvata è stata eliminata per le sessioni future.',
  'settings.model.notInstalled': 'Non installato',
  'settings.model.validatedExternal': 'Convalidato · esterno',
  'settings.model.external': 'Esterno',
  'settings.model.checking': 'Verifica in corso…',
  'settings.model.unavailable': 'Non disponibile',
  'settings.model.noModel': 'Nessun modello',
  'settings.model.streaming': 'Streaming',
  'settings.model.manageModels': 'Gestisci i modelli',
  'settings.model.useExternalFile': 'Usa un file esterno',
  'settings.model.details': 'Dettagli del modello',
  'settings.install.installingNamed': 'Installazione in corso: {name}',
  'settings.install.installingSidecar': 'Installazione in corso: sidecar {variant}',
  'settings.install.installingSidecarMac': 'Installazione del sidecar in corso',
  'settings.install.cancelling': 'Annullamento in corso...',
  'settings.install.cancel': 'Annulla',
  'settings.missingSidecar.name': 'Configura Speech Kit',
  'settings.missingSidecar.desc':
    'Speech Kit non è ancora pronto. Esegui la procedura di configurazione per installare il motore di riconoscimento vocale e un modello.',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': 'sidecar {variant}',
  'settings.sidecar.desc': 'Motore di conversione da voce a testo.',
  'settings.sidecar.cpuName': 'Sidecar CPU',
  'settings.sidecar.cpuDesc': 'Motore di conversione da voce a testo. Obbligatorio.',
  'settings.sidecar.gpuName': 'Sidecar GPU',
  'settings.sidecar.cudaLibraryPath.name': 'Percorso delle librerie CUDA',
  'settings.sidecar.cudaLibraryPath.desc':
    'Percorso facoltativo di ricerca delle librerie per il sidecar (Flatpak, installazioni CUDA personalizzate).',
  'settings.sidecar.installAnyway': 'Installa comunque',
  'settings.sidecar.stopBeforeInstall':
    'Interrompi la dettatura o la lettura ad alta voce prima di installare un sidecar: l’installazione riavvia il motore. Se la dettatura è ancora in elaborazione, esegui “Annulla la dettatura” per interromperla subito.',
  'settings.sidecar.stopBeforeUninstall':
    'Interrompi la dettatura o la lettura ad alta voce prima di disinstallare il {sidecar}. Se la dettatura è ancora in elaborazione, esegui “Annulla la dettatura” per interromperla subito.',
  'settings.sidecar.uninstallFailed':
    'Impossibile disinstallare il {sidecar}. Chiudi le altre finestre di configurazione e riprova.',
  'settings.sidecar.uninstalled': 'Sidecar disinstallato.',
  'settings.sidecar.cudaUninstalled': 'Sidecar CUDA disinstallato. Esecuzione su CPU.',
  'settings.sidecar.cpuUninstalled': 'Sidecar CPU disinstallato.',
  'settings.sidecar.restartFailed':
    'Impossibile riavviare il motore di riconoscimento vocale. Riavvia Obsidian prima di dettare.',
  'settings.sidecar.reinstall': 'Reinstalla',
  'settings.sidecar.uninstall': 'Disinstalla',
  'settings.sidecar.install': 'Installa',
  'plugin.name': 'Speech Kit',
  'common.cancel': 'Annulla',
  'common.delete': 'Elimina',
  'common.duplicate': 'Duplica',
  'common.free': 'Gratis',
  'common.inherit': 'Eredita',
  'common.off': 'Disattivato',
  'common.on': 'Attivato',
  'common.save': 'Salva',
  'common.unavailable': 'Non disponibile',
  'ribbon.idle': 'Speech Kit — avvia la dettatura',
  'ribbon.starting': 'Speech Kit — avvio in corso…',
  'ribbon.listening': 'Speech Kit — in ascolto',
  'ribbon.speechDetected': 'Speech Kit — voce rilevata',
  'ribbon.error': 'Speech Kit — errore',
  'validation.wholeNumberRange': 'Inserisci un numero intero compreso tra {min} e {max}.',
  'validation.numberRange': 'Inserisci un numero compreso tra {min} e {max}.',
  'llm.managedByPreset': 'Gestito da “{preset}”. Modifica quel preset per cambiare questo valore.',
  'llm.context.title': 'Impostazioni del contesto',
  'llm.context.settingsTooltip': 'Impostazioni del contesto',
  'llm.context.intro':
    'Un contesto più ampio può migliorare la terminologia, ma può aumentare la latenza locale o il costo di OpenRouter.',
  'llm.context.noteLength.name': 'Lunghezza del contesto della nota',
  'llm.context.noteLength.description':
    'Numero massimo di caratteri estratti dalla nota corrente sopra il cursore.',
  'llm.context.previousPhrases.name': 'Frasi precedenti',
  'llm.context.previousPhrases.description':
    'Frasi dettate di recente incluse nella cronologia della conversazione.',
  'llm.context.afterEachPhraseOnly':
    'Usato solo quando Esegui la trasformazione è impostato su Dopo ogni frase.',
  'llm.context.limit.name': 'Limite del contesto',
  'llm.context.limit.description':
    'Numero massimo complessivo di caratteri del contesto della nota e delle frasi precedenti.',
  'llm.context.useCurrentNote.name': 'Usa la nota corrente come contesto',
  'llm.context.useCurrentNote.description': 'Includi in ogni prompt il testo sopra il cursore.',
  'llm.model.title': 'Impostazioni del modello',
  'llm.model.settingsTooltip': 'Impostazioni del modello',
  'llm.model.temperature.name': 'Temperatura',
  'llm.model.temperature.description':
    'Variabilità del campionamento. Con 0 il risultato è deterministico; valori più alti producono risultati più vari.',
  'llm.model.behavior.name': 'Comportamento del modello',
  'llm.model.summary.temperature': 'Temperatura {value}',
  'llm.model.summary.timeout': 'Timeout di {value} s',
  'llm.failure.authInvalid': 'Chiave API di {provider} rifiutata. Controlla le impostazioni.',
  'llm.failure.rateLimited':
    'Limite di richieste di {provider} raggiunto. Verrà usato il testo grezzo.',
  'llm.failure.network': 'Errore di rete durante la connessione a {provider}.',
  'llm.failure.modelNotConfigured':
    'Il modello {provider} non è configurato. Scegline uno in Modello.',
  'llm.failure.unknownModel': 'Modello {provider} non trovato. Scegline un altro in Modello.',
  'llm.failure.unknown': 'Trasformazione LLM non riuscita. Consulta la console.',
  'llm.status.selectOllamaModel': 'Seleziona un modello Ollama qui sotto.',
  'llm.status.selectOpenRouterModel': 'Seleziona un modello OpenRouter qui sotto.',
  'llm.status.ollamaNotRunning': 'Ollama non è in esecuzione.',
  'llm.status.unreachable': '{provider} non è raggiungibile.',
  'llm.status.authInvalid': 'Chiave API di {provider} rifiutata.',
  'llm.status.rateLimited': 'Limite di richieste di {provider} raggiunto.',
  'llm.status.noOllamaModels': 'Nessun modello di chat installato in Ollama.',
  'llm.status.noModels': 'Nessun modello {provider} utilizzabile trovato.',
  'llm.status.selectedUnavailable': 'Il modello selezionato non è disponibile.',
  'llm.timing.title': 'Impostazioni della tempistica',
  'llm.timing.settingsTooltip': 'Impostazioni della tempistica',
  'llm.timing.minimumWords.name': 'Numero minimo di parole',
  'llm.timing.minimumWords.description':
    'Salta la trasformazione quando la trascrizione contiene meno parole di questo valore.',
  'llm.timing.timestamps.perUtterance': 'Dopo ogni frase mantiene i confini dei timestamp.',
  'llm.timing.timestamps.batch':
    'Tutto insieme può riscrivere o rimuovere i timestamp, a seconda del preset.',
  'llm.timing.option.perUtterance': 'Dopo ogni frase',
  'llm.timing.option.batch': 'Tutto insieme all’interruzione',
  'llm.routing.priceTierTooltip': 'Fascia di prezzo approssimativa',
  'llm.routing.providerModel': 'Modello {provider}',
  'llm.routing.ollamaModelDescription': 'Scegli un modello di chat Ollama locale.',
  'llm.routing.selectModel': 'Seleziona un modello',
  'llm.routing.refreshModels': 'Aggiorna i modelli di {provider}',
  'llm.routing.openRouterModel.name': 'Modello OpenRouter',
  'llm.routing.openRouterModel.description': 'Digita per cercare tra i modelli OpenRouter.',
  'llm.routing.testConnection': 'Verifica la chiave API e il modello',
  'llm.sidebar.eyebrow': 'Flusso di lavoro della trascrizione',
  'llm.sidebar.title': 'Trasforma la dettatura',
  'llm.sidebar.description':
    'Scegli come elaborare il testo pronunciato prima che raggiunga la nota.',
  'llm.sidebar.group.preset': 'Preset',
  'llm.sidebar.group.model': 'Modello',
  'llm.sidebar.group.context': 'Contesto',
  'llm.sidebar.enabled.name': 'Abilitata',
  'llm.sidebar.enabled.description': 'Applica il preset attivo al nuovo testo dettato.',
  'llm.sidebar.showOriginal.name': 'Mostra la trascrizione originale',
  'llm.sidebar.showOriginal.description':
    'Conservala in un callout comprimibile sotto ogni risultato trasformato.',
  'llm.sidebar.runTransform.name': 'Esegui la trasformazione',
  'llm.sidebar.runTransform.description':
    'Eseguila dopo ogni frase oppure tutta insieme quando interrompi la dettatura.',
  'llm.sidebar.runTransform.setByPreset': 'Impostato da {preset} — {timing}.',
  'llm.sidebar.activePreset': 'Preset attivo',
  'llm.sidebar.unavailable.title': 'Le funzionalità LLM non sono disponibili',
  'llm.sidebar.unavailable.description':
    'Abilita le funzionalità LLM nelle impostazioni di Speech Kit per configurare le trasformazioni.',
  'llm.sidebar.unavailable.summary': 'Abilita le funzionalità LLM nelle impostazioni',
  'llm.sidebar.off.title': 'Modalità trascrizione grezza',
  'llm.sidebar.off.description':
    'La dettatura inserisce la trascrizione locale grezza. Attiva Trasformazione quando vuoi ripulire o riscrivere il testo oppure creare riepiloghi.',
  'llm.sidebar.off.summary': 'Trascrizione grezza',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Pulizia',
  'llm.preset.builtin.cleanUp.description':
    'Corregge artefatti di trascrizione, intercalari, punteggiatura e maiuscole mantenendo la voce e il significato originali.',
  'llm.preset.builtin.cleanUp.prompt':
    'Ripulisci il testo dettato convertito da voce a testo. Correggi intercalari, false partenze, ripetizioni, punteggiatura, uso delle maiuscole ed evidenti errori di riconoscimento. Mantieni la voce e il significato di chi parla. Usa il contesto di riferimento solo per l’ortografia. Scrivi nella lingua originale della trascrizione. Non tradurre mai, a meno che l’utente non richieda esplicitamente una traduzione. Restituisci soltanto il testo ripulito, senza introduzioni né commenti.',
  'llm.preset.builtin.professionalWriting.label': 'Scrittura professionale',
  'llm.preset.builtin.professionalWriting.description':
    'Riscrive il testo in una prosa professionale concisa e curata, mantenendo fatti, nomi, decisioni e termini tecnici.',
  'llm.preset.builtin.professionalWriting.prompt':
    'Riscrivi il testo dettato come prosa professionale concisa. Usa la forma attiva ed elimina intercalari ed espressioni esitanti. Mantieni ogni fatto, nome e termine. Usa il contesto di riferimento per l’ortografia. Scrivi nella lingua originale della trascrizione. Non tradurre mai, a meno che l’utente non richieda esplicitamente una traduzione. Restituisci soltanto il testo riscritto, senza introduzioni né commenti.',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Aggiunge un breve riepilogo TLDR sopra la trascrizione inalterata.',
  'llm.preset.builtin.tldr.prompt':
    'Scrivi un riepilogo TLDR della trascrizione dettata: un’intestazione “TLDR” seguita da 1-3 brevi punti elenco che illustrino gli aspetti principali. Scrivi nella lingua originale della trascrizione. Non tradurre mai, a meno che l’utente non richieda esplicitamente una traduzione. Restituisci soltanto l’intestazione e i punti elenco: non ripetere la trascrizione e non aggiungere introduzioni o commenti.',
  'llm.preset.builtin.markdownFormatting.label': 'Formattazione Markdown',
  'llm.preset.builtin.markdownFormatting.description':
    'Riformatta la trascrizione della sessione come Markdown strutturato, con intestazioni, elenchi ed enfasi.',
  'llm.preset.builtin.markdownFormatting.prompt':
    'Riformatta il testo dettato come Markdown ben strutturato. Aggiungi intestazioni, elenchi puntati o numerati, grassetto, corsivo e blocchi di codice delimitati quando il contenuto lo richiede. Correggi con moderazione intercalari, false partenze, punteggiatura e uso delle maiuscole; mantieni le parole di chi parla e ogni fatto, nome e termine. Scrivi nella lingua originale della trascrizione. Non tradurre mai, a meno che l’utente non richieda esplicitamente una traduzione. Restituisci soltanto il Markdown, senza introduzioni né commenti.',
  'llm.preset.builtin.actionItems.label': 'Attività',
  'llm.preset.builtin.actionItems.description':
    'Aggiunge sotto la trascrizione inalterata una checklist delle attività.',
  'llm.preset.builtin.actionItems.prompt':
    'Estrai le attività dalla trascrizione dettata. Produci un’intestazione “Attività” seguita da una checklist Markdown di compiti concreti, indicando il responsabile quando viene menzionato. Se la trascrizione non contiene attività, non restituire nulla. Scrivi nella lingua originale della trascrizione. Non tradurre mai, a meno che l’utente non richieda esplicitamente una traduzione. Restituisci soltanto l’intestazione e la checklist: non ripetere la trascrizione e non aggiungere introduzioni o commenti.',
  'llm.preset.timing.perUtterance': 'Viene eseguito dopo ogni frase',
  'llm.preset.timing.batch': 'Viene eseguito una volta all’interruzione',
  'llm.preset.timing.either': 'Viene eseguito in entrambe le modalità',
  'llm.preset.behavior.addAbove': 'aggiunge nuovi contenuti sopra la trascrizione',
  'llm.preset.behavior.addBelow': 'aggiunge nuovi contenuti sotto la trascrizione',
  'llm.preset.behavior.replace': 'riscrive il testo dettato',
  'llm.preset.behavior.overrides': 'sostituisce {fields}',
  'llm.preset.override.minimumWords': 'numero min. di parole',
  'llm.preset.override.temperature': 'temperatura',
  'llm.preset.override.noteContext': 'contesto della nota',
  'llm.preset.option.perUtterance': '{preset} (dopo ogni frase)',
  'llm.preset.option.batch': '{preset} (all’interruzione)',
  'llm.preset.copySuffix': ' (copia)',
  'llm.preset.copySuffixNumbered': ' (copia {number})',
  'llm.preset.validation.nameRequired': 'Inserisci un nome per questo preset.',
  'llm.preset.validation.nameExists': 'Esiste già un preset con questo nome.',
  'llm.preset.validation.promptRequired': 'Inserisci un prompt per questo preset.',
  'llm.preset.validation.minimumWords':
    'Il numero minimo di parole deve essere un intero compreso tra 0 e {max}.',
  'llm.preset.validation.temperature':
    'La temperatura deve essere un numero compreso tra 0 e {max}.',
  'llm.preset.validation.maximumCount': 'Puoi salvare fino a {max} preset. Eliminane prima uno.',
  'llm.preset.validation.builtinName':
    'Questo nome è usato da un preset integrato — scegline uno diverso.',
  'llm.preset.manager.title': 'Gestisci i preset',
  'llm.preset.manager.newTitle': 'Nuovo preset',
  'llm.preset.manager.editTitle': 'Modifica preset',
  'llm.preset.manager.presets.name': 'Preset',
  'llm.preset.manager.presets.description':
    'Il preset attivo è contrassegnato. I preset integrati sono di sola lettura: duplicane uno per personalizzarlo.',
  'llm.preset.manager.new': 'Nuovo preset',
  'llm.preset.manager.searchPlaceholder': 'Cerca preset...',
  'llm.preset.manager.noMatches': 'Nessun preset corrisponde alla ricerca.',
  'llm.preset.manager.builtinHeading': 'Integrati',
  'llm.preset.manager.yoursHeading': 'I tuoi preset',
  'llm.preset.manager.viewTooltip': 'Visualizza preset',
  'llm.preset.manager.editTooltip': 'Modifica preset',
  'llm.preset.manager.duplicateTooltip': 'Duplica preset',
  'llm.preset.manager.deleteTooltip': 'Elimina il preset “{preset}”',
  'llm.preset.manager.back': '← Tutti i preset',
  'llm.preset.editor.name': 'Nome',
  'llm.preset.editor.namePlaceholder': 'es. Appunti della riunione',
  'llm.preset.editor.description': 'Descrizione (facoltativa)',
  'llm.preset.editor.descriptionPlaceholder': 'Quando usare questo preset',
  'llm.preset.editor.prompt': 'Prompt',
  'llm.preset.editor.promptDescription': 'Inviato al modello come prompt di sistema.',
  'llm.preset.editor.promptSize':
    '~{tokens} token ({characters} caratteri) — inviato con ogni richiesta',
  'llm.preset.editor.timing': 'Tempistica',
  'llm.preset.editor.timingDescription':
    'Quando viene eseguita la trasformazione. “Entrambe” segue la tempistica della barra laterale.',
  'llm.preset.editor.timingEither': 'Entrambe (segue la barra laterale)',
  'llm.preset.editor.timingPerUtterance': 'Dopo ogni frase',
  'llm.preset.editor.timingBatch': 'Una volta all’interruzione',
  'llm.preset.editor.output': 'Output',
  'llm.preset.editor.outputDescription':
    'L’opzione Sostituisci riscrive il testo dettato. L’opzione Aggiungi lo mantiene inalterato e inserisce nuovi contenuti.',
  'llm.preset.editor.outputReplace': 'Sostituisci il testo',
  'llm.preset.editor.outputAddAbove': 'Aggiungi sopra la trascrizione',
  'llm.preset.editor.outputAddBelow': 'Aggiungi sotto la trascrizione',
  'llm.preset.editor.overrides': 'Impostazioni sostitutive',
  'llm.preset.editor.overridesDescription':
    'Lascia vuoto un campo per usare l’impostazione globale.',
  'llm.preset.editor.minimumWords': 'Numero min. di parole',
  'llm.preset.delete.title': 'Elimina preset',
  'llm.preset.delete.message':
    'Eliminare il preset “{preset}”? Questa operazione non può essere annullata.',
  'llm.preset.delete.activeFallback': '“{preset}” era attivo — è stata selezionata Pulizia.',
  'common.back': 'Indietro',
  'common.close': 'Chiudi',
  'common.done': 'Fine',
  'common.install': 'Installa',
  'common.later': 'Più tardi',
  'common.next': 'Avanti',
  'common.remove': 'Rimuovi',
  'common.tryAgain': 'Riprova',
  'setup.ready.waitForDictation': 'Attendi che la dettatura corrente termini, quindi riprova.',
  'setup.ready.openMarkdownNote':
    'Apri una nota Markdown in modalità di modifica, quindi riprova a dettare.',
  'setup.ready.completionFailed': 'Impossibile completare la configurazione. Riprova.',
  'setup.wizard.welcomeTitle': 'Benvenuto in Speech Kit',
  'setup.wizard.title': 'Configura Speech Kit',
  'setup.wizard.engineReadyTitle': 'Motore di riconoscimento vocale pronto',
  'setup.wizard.engineReadyDesc':
    'Il motore locale di conversione da voce a testo è installato e pronto.',
  'setup.wizard.intro':
    'Detta appunti senza usare le mani, direttamente in Obsidian e interamente sul tuo computer. Nessun account, cloud o telemetria.',
  'setup.wizard.quickSetup': 'Una configurazione rapida di 2 minuti:',
  'setup.wizard.downloadEngineStep': 'Scarica il motore di riconoscimento vocale',
  'setup.wizard.pickModelStep': 'Scegli un modello di trascrizione',
  'setup.wizard.startTalking':
    'Poi premi il microfono nella barra multifunzione, oppure usa la tua scorciatoia da tastiera, e inizia a parlare.',
  'setup.wizard.downloadEngine': 'Scarica il motore',
  'setup.wizard.modelSelectedTitle': 'Modello selezionato',
  'setup.wizard.pickModelTitle': 'Scegli un modello di trascrizione',
  'setup.wizard.modelSelectedDesc':
    'Un modello di trascrizione è installato e selezionato. Potrai installarne altri o cambiarlo in seguito dalle Impostazioni.',
  'setup.wizard.modelIntro':
    'Installa un modello di trascrizione per abilitare la dettatura. Potrai installarne altri in seguito: i modelli più piccoli sono più veloci, quelli più grandi sono più accurati.',
  'setup.wizard.modelKinds':
    'Sono disponibili due tipi: i modelli streaming mostrano le parole in tempo reale mentre parli; i modelli standard trascrivono dopo ogni pausa. Per la dettatura senza usare le mani, inizia con il modello consigliato Moonshine Small. Nemotron 3.5 ASR è un’opzione streaming che richiede più risorse.',
  'setup.wizard.openModelPicker': 'Apri il selettore dei modelli',
  'setup.wizard.readyTitle': 'Tutto pronto per dettare',
  'setup.wizard.readyDesc':
    'Prova nella nota Markdown attualmente aperta. Pronuncia alcune parole, quindi usa il microfono nella barra multifunzione o la scorciatoia da tastiera per interrompere la dettatura.',
  'setup.wizard.ribbonTitle': 'Usa il microfono nella barra multifunzione',
  'setup.wizard.ribbonDesc':
    'Cerca questa icona nella barra multifunzione di Obsidian. Selezionala per iniziare a dettare e selezionala di nuovo per interrompere.',
  'setup.wizard.hotkeyTitle': 'Oppure assegna una scorciatoia da tastiera',
  'setup.wizard.hotkeyDescBefore': 'Assegna una scorciatoia al comando ',
  'setup.wizard.toggleCommandName': 'Speech Kit: Attiva o disattiva la dettatura',
  'setup.wizard.hotkeyDescAfter':
    ' per avviare e interrompere la dettatura da qualsiasi punto di Obsidian.',
  'setup.wizard.openHotkeySettings': 'Apri le impostazioni delle scorciatoie',
  'setup.wizard.tryDictationNow': 'Prova subito la dettatura',
  'setup.wizard.openHotkeySettingsFallback':
    'Apri Impostazioni → Tasti di scelta rapida e cerca “Speech Kit”.',
  'setup.sidecar.modal.download': 'Scarica',
  'setup.sidecar.modal.variantDownload': 'Download di {variant}',
  'setup.sidecar.modal.version': 'Versione',
  'setup.sidecar.modal.cancelling': 'Annullamento in corso...',
  'setup.sidecar.modal.downloading': 'Download in corso...',
  'setup.sidecar.modal.retryDownload': 'Riprova il download',
  'setup.sidecar.modal.installFailureNotice':
    'L’installazione del motore di riconoscimento vocale non è riuscita. Riapri la configurazione o le Impostazioni per esaminare l’errore e riprovare.',
  'setup.sidecar.modal.startFailed':
    'Impossibile avviare l’installazione del sidecar. Chiudi le altre finestre di configurazione e riprova.',
  'setup.sidecar.installCancelled': 'Installazione del sidecar annullata.',
  'setup.sidecar.progress.variant': ' sidecar {variant} ({current} di {total})',
  'setup.sidecar.progress.downloading': 'Download in corso',
  'setup.sidecar.progress.verifying': 'Verifica del checksum...',
  'setup.sidecar.progress.extracting': 'Estrazione dell’archivio...',
  'models.manage.title': 'Gestisci i modelli',
  'models.manage.loadFailedTitle': 'Impossibile caricare i modelli',
  'models.manage.loadFailedDesc':
    'Il motore di riconoscimento vocale potrebbe non essere installato o non rispondere. Esegui di nuovo la configurazione per reinstallarlo oppure riprova.',
  'models.manage.runSetup': 'Esegui la configurazione',
  'models.manage.loadingCatalog': 'Caricamento del catalogo dei modelli…',
  'models.manage.loadCatalogFailed': 'Impossibile caricare il catalogo dei modelli.',
  'models.manage.noneAvailable': 'Nessun modello disponibile per questo motore.',
  'models.manage.unsupportedLanguage':
    ' · Non supporta {language}. Modifica Lingua della dettatura per installare o usare questo modello.',
  'models.manage.use': 'Usa',
  'models.manage.selected': 'Selezionato',
  'models.manage.cancelling': 'Annullamento in corso…',
  'models.manage.details': 'Dettagli',
  'models.manage.installStartFailed': 'Impossibile avviare l’installazione del modello. Riprova.',
  'models.manage.selectFailed':
    'Impossibile selezionare il modello. Controlla che i relativi file siano disponibili.',
  'models.manage.selectedNotice': 'Modello selezionato.',
  'models.manage.removeFailed':
    'Impossibile rimuovere il modello. Chiudi tutti i processi che ne usano i file.',
  'models.manage.removedNotice': 'Modello rimosso.',
  'models.external.title': 'Usa un file esterno',
  'models.external.intro':
    'I modelli esterni sono destinati a un uso avanzato. Speech Kit non scarica, aggiorna né verifica tramite checksum questi file.',
  'models.external.family.name': 'Famiglia del modello',
  'models.external.family.desc':
    'Scegli il loader adatto al modello. La famiglia non viene dedotta dal nome del file.',
  'models.external.path.name': 'Percorso del file del modello',
  'models.external.path.desc':
    'Inserisci il percorso assoluto del file principale del modello. Verrà convalidato prima di salvare la selezione.',
  'models.external.validateAndUse': 'Convalida e usa',
  'models.external.validating': 'Convalida in corso…',
  'models.external.selectedNotice': 'File del modello esterno convalidato e selezionato.',
  'models.external.requirementsTitle': 'Requisiti dei file',
  'models.external.validation.notConfigured': 'Il percorso del file del modello non è configurato.',
  'models.external.validation.notAbsolute':
    'Il percorso del file del modello deve essere assoluto.',
  'models.external.validation.missing': 'Il percorso del file del modello non esiste: {path}',
  'models.external.validation.notFile':
    'Il percorso del file del modello deve indicare un file: {path}',
  'models.external.validation.selectEntryFile': 'Seleziona {filename}.',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR richiede il file encoder.int8.onnx. Seleziona encoder.int8.onnx dalla directory del modello con blocchi fissi da 560 ms.',
  'models.external.validation.moonshineEntryFile':
    'Moonshine richiede il file principale frontend.ort. Seleziona frontend.ort dalla directory del modello streaming.',
  'models.external.validation.generic':
    'Il motore di riconoscimento vocale non ha potuto convalidare questo modello.',
  'models.external.requirements.nemotron.entry':
    'Seleziona encoder.int8.onnx dall’esportazione int8 di Nemotron 3.5 ASR fissata a 560 ms.',
  'models.external.requirements.nemotron.siblings':
    'La stessa directory deve contenere decoder.int8.onnx, joiner.int8.onnx e tokens.txt.',
  'models.external.requirements.nemotron.compatibility':
    'Altre dimensioni dei chunk e le esportazioni ORT GenAI non sono compatibili con questo adattatore.',
  'models.external.requirements.moonshine.entry':
    'Seleziona frontend.ort da una directory di modello ORT streaming Moonshine v2.',
  'models.external.requirements.moonshine.siblings':
    'La stessa directory deve contenere encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json e tokenizer.bin.',
  'models.external.requirements.moonshine.compatibility':
    'Le esportazioni Moonshine ONNX non streaming non sono compatibili.',
  'models.external.requirements.whisper.entry':
    'Seleziona un file di modello GGML o GGUF compatibile con whisper.cpp.',
  'models.external.requirements.whisper.validation':
    'Il loader convalida il contenuto del file; la sola estensione del file non ne stabilisce la compatibilità.',
  'models.external.requirements.whisper.language':
    'I file Whisper con pesi .en supportano solo l’inglese; i pesi multilingue rendono disponibili il selettore della lingua verificato e il rilevamento automatico.',
  'models.details.totalSize': 'Dimensione totale',
  'models.details.source': 'Origine',
  'models.details.license': 'Licenza',
  'models.details.capabilities': 'Funzionalità',
  'models.details.installPath': 'Percorso di installazione',
  'models.details.files': 'File ({count})',
  'models.details.size': 'Dimensione',
  'models.capability.segmentTimestamps': 'Timestamp dei segmenti',
  'models.capability.wordTimestamps': 'Timestamp delle parole',
  'models.capability.initialPrompt': 'Prompt iniziale',
  'models.capability.streaming': 'Streaming',
  'models.capability.autoLanguageDetection': 'Rilevamento automatico della lingua',
  'models.capability.punctuation': 'Punteggiatura',
  'models.capability.maxAudio': 'Durata audio max: {seconds} s',
  'models.capability.anyLanguage': 'Qualsiasi lingua',
  'models.capability.englishOnly': 'Solo inglese',
  'models.capability.languageCount': '{count} lingue',
  'models.capability.languageSelection': 'Selezione della lingua',
  'models.tag.fullPrecision': 'Precisione completa',
  'models.tag.reducedSize': 'Dimensioni ridotte',
  'models.progress.preparing': 'Preparazione dell’installazione',
  'models.progress.downloading': 'Download in corso',
  'models.progress.verifying': 'Verifica del download',
  'models.progress.validating': 'Convalida del modello',
  'models.progress.installed': 'Modello installato',
  'models.progress.cancelled': 'Installazione del modello annullata',
  'models.progress.failed': 'Installazione del modello non riuscita',
  'models.progress.downloadingFile': 'Download di {filename}',
  'models.progress.verifyingFile': 'Verifica di {filename}',
  'models.progress.fileCount': 'File {current} di {total}',
  'models.current.noneSelected': 'Nessun modello selezionato',
  'models.current.noneSelectedDesc': 'Scegli un modello installato o convalida un file esterno.',
  'models.current.notSelected': 'Non selezionato',
  'models.current.externalFile': 'File esterno',
  'models.current.managedNotInstalled': 'Il modello gestito selezionato non è installato.',
  'models.current.installed': 'Installato',
  'models.current.notInstalled': 'Non installato',
  'models.current.managedDownload': 'Download gestito',
  'models.current.externalValidated': 'Esterno convalidato',
  'models.current.checking': 'Verifica in corso',
  'models.current.externalUnavailableDesc':
    'Il modello esterno non è disponibile. Convalida di nuovo il file per visualizzare i dettagli.',
  'models.current.unavailable': 'Non disponibile',
  'models.current.validateBeforeDictating':
    'Convalida il file del modello esterno prima di dettare.',
  'sidecarError.audio_too_long':
    'La clip audio supera la durata massima prevista per questo motore.',
  'sidecarError.engine_inference_failed': 'Trascrizione locale non riuscita.',
  'sidecarError.internal_error':
    'Si è verificato un errore interno del motore di riconoscimento vocale.',
  'sidecarError.invalid_audio_buffer': 'Il buffer audio era vuoto all’avvio della trascrizione.',
  'sidecarError.invalid_audio_frame':
    'Il motore di riconoscimento vocale ha ricevuto un frame audio non valido.',
  'sidecarError.invalid_diarization_speaker_limit':
    'Il numero massimo di parlanti deve essere almeno 1 oppure impostato su Automatico.',
  'sidecarError.invalid_frame':
    'Il motore di riconoscimento vocale ha ricevuto un frame di protocollo non valido.',
  'sidecarError.invalid_model_file':
    'Il file del modello è mancante, illeggibile o non supportato.',
  'sidecarError.invalid_model_task':
    'Il modello selezionato non può essere usato per la dettatura.',
  'sidecarError.invalid_model_store':
    'La cartella di archiviazione dei modelli non è disponibile o non è valida.',
  'sidecarError.missing_model_file': 'Il file del modello non esiste o non è un file regolare.',
  'sidecarError.no_active_install':
    'Non è in corso alcuna installazione di un modello da annullare.',
  'sidecarError.no_active_session': 'Non è attiva alcuna sessione di dettatura.',
  'sidecarError.session_already_exists': 'Esiste già una sessione di dettatura con questo ID.',
  'sidecarError.session_capacity_exceeded':
    'Speech Kit ha già raggiunto il numero massimo di sessioni attive.',
  'sidecarError.system_audio_capture_failed':
    'Impossibile avviare l’acquisizione dell’audio di sistema.',
  'sidecarError.system_audio_permission_denied':
    'L’autorizzazione alla registrazione dell’audio di sistema è disattivata per Obsidian. Apri Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo e audio di sistema, abilita Obsidian e riprova.',
  'sidecarError.system_audio_unsupported':
    'L’acquisizione dell’audio di sistema non è ancora disponibile su questa piattaforma. Instrada l’uscita del computer attraverso un dispositivo audio virtuale e selezionalo come microfono; consulta la guida Audio di sistema.',
  'sidecarError.transcription_failure': 'Trascrizione locale non riuscita.',
  'sidecarError.unsupported_engine': 'Il motore richiesto non è disponibile in questa build.',
  'sidecarError.unsupported_language':
    'Il modello selezionato non supporta questa lingua di dettatura.',
  'sidecarError.utterance_dropped_during_overload_drain':
    'Una frase completata è stata scartata durante lo svuotamento della coda di trascrizione.',
  'sidecarError.utterance_queue_overload':
    'La dettatura è stata interrotta perché la coda di trascrizione è sovraccarica. L’elaborazione dell’audio già accettato verrà completata.',
  'sidecarError.vad_error': 'Rilevamento dell’attività vocale non riuscito su un frame audio.',
  'sidecarError.vad_init_failed': 'Inizializzazione del VAD Silero incluso non riuscita.',
  'sidecarError.worker_panic':
    'Il processo di trascrizione del motore di riconoscimento vocale si è arrestato in modo imprevisto.',
  'catalog.whisper_tiny_en_q8_0.summary':
    'Il modello più veloce e con il minor consumo di risorse. Adatto ai test o ai computer poco potenti.',
  'catalog.whisper_base_en_q8_0.summary':
    'Modello veloce con una buona accuratezza. Una scelta valida per creare rapidamente bozze con la CPU.',
  'catalog.whisper_small_en_q5_1.summary':
    'Offre un buon equilibrio tra qualità della trascrizione, dimensioni del download e velocità sulla CPU.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Modello ad alta accuratezza per chi privilegia la qualità della trascrizione rispetto alla velocità.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'Trascrizione multilingue ad alta accuratezza, con un’architettura ottimizzata per l’accelerazione tramite GPU.',
  'catalog.cohere_transcribe_fp16.summary':
    'La variante Cohere più grande, che conserva la precisione completa del modello.',
  'catalog.cohere_transcribe_int8.summary':
    'La variante Cohere di dimensioni intermedie, con quantizzazione a 8 bit.',
  'catalog.cohere_transcribe_q4.summary':
    'La variante Cohere più piccola; la quantizzazione a 4 bit riduce le dimensioni a scapito della qualità.',
  'catalog.moonshine_tiny_streaming_en.summary':
    'Il modello di streaming Moonshine più veloce, con 34 milioni di parametri, progettato per CPU poco potenti.',
  'catalog.moonshine_small_streaming_en.summary':
    'Modello equilibrato per la dettatura in tempo reale, con 123 milioni di parametri.',
  'catalog.moonshine_medium_streaming_en.summary':
    'Il modello di streaming Moonshine più accurato, con 245 milioni di parametri.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'RNNT multilingue di NVIDIA da 0,6 miliardi di parametri, esportato in ONNX int8 per la trascrizione in tempo reale ottimizzata per la cache in otto lingue verificate.',
  'catalog.family.whisper.summary':
    'Trascrive dopo ogni pausa. Whisper offre timestamp più precisi rispetto alle altre famiglie di modelli, inclusa la temporizzazione facoltativa a livello di parola. Tiny e Base privilegiano la velocità, Small bilancia velocità e qualità, mentre Medium e Large privilegiano la qualità.',
  'catalog.family.cohere_transcribe.summary':
    'Trascrizione in batch di alta qualità, con requisiti di download e memoria nell’ordine di diversi gigabyte.',
  'catalog.family.moonshine.summary':
    'Mostra le parole mentre parli. Tiny privilegia un minore utilizzo delle risorse, Small bilancia velocità e qualità, mentre Medium privilegia la qualità.',
  'catalog.family.nemotron_asr.summary':
    'Streaming multilingue ad alta accuratezza, con un download più grande e un maggiore utilizzo delle risorse. Moonshine Small resta il modello predefinito consigliato per la dettatura in tempo reale in inglese.',
  'setup.sidecar.modal.unsupportedPlatform':
    'Questa versione del motore di riconoscimento vocale non è disponibile per la tua piattaforma o architettura.',
  'setup.sidecar.modal.genericInstallError':
    'Impossibile installare il motore di riconoscimento vocale. Controlla i log del plugin per i dettagli, quindi riprova.',
  'commands.readAloud': 'Leggi ad alta voce',
  'commands.readAloudFromCursor': 'Leggi ad alta voce dal cursore',
  'commands.pauseResumeReadAloud': 'Metti in pausa o riprendi la lettura',
  'commands.stopReadAloud': 'Interrompi la lettura',
  'settings.groups.readAloud': 'Lettura ad alta voce',
  'settings.model.noModelSelected': 'Nessun modello selezionato',
  'settings.model.speechToText': 'Modello voce-testo',
  'settings.model.textToSpeech': 'Modello testo-voce',
  'settings.readAloud.hotkey': 'Scorciatoia consigliata',
  'settings.readAloud.hotkeyDesc':
    "Assegna una scorciatoia a Leggi ad alta voce. Legge il testo selezionato oppure l'intera nota se non c'è una selezione.",
  'settings.readAloud.highlightSpokenText': 'Evidenzia il testo letto',
  'settings.readAloud.highlightSpokenTextDesc':
    'Evidenzia la frase o il frammento di testo corrente nell’editor durante la lettura ad alta voce.',
  'settings.readAloud.voice': 'Voce',
  'settings.readAloud.voiceDesc': 'Scegli tra le voci installate per il modello selezionato.',
  'settings.readAloud.noVoices': 'Nessuna voce installata',
  'settings.readAloud.speed': 'Velocità di lettura',
  'settings.readAloud.speedDesc':
    'Cambiare velocità durante la lettura riparte dalla frase corrente.',
  'models.manage.dictationModels': 'Da voce a testo',
  'models.manage.readAloudModels': 'Da testo a voce',
  'models.manage.allLanguages': 'Tutte le lingue',
  'models.manage.familiesLabel': 'Famiglie di modelli',
  'models.manage.noneForLanguage': 'Nessun modello disponibile per questa attività e lingua.',
  'models.manage.optionalVoice': 'Voce locale facoltativa',
  'models.manage.voiceInstalled': 'Installata',
  'tts.status.reading': 'Lettura…',
  'tts.status.paused': 'Lettura in pausa',
  'tts.control.model': 'Modello: {model}',
  'tts.control.speed': 'Velocità: {speed}',
  'tts.notice.noText': 'Qui non è presente testo leggibile.',
  'tts.notice.modelRequired': 'Installa e seleziona prima un modello di lettura.',
  'tts.notice.voiceRequired': 'Seleziona prima una voce installata.',
  'tts.notice.startFailed': 'Impossibile avviare la lettura.',
  'tts.notice.playbackFailed': 'Riproduzione audio non riuscita.',
  'tts.notice.sidecarExited':
    'La lettura si è interrotta perché il sidecar è terminato inaspettatamente.',
  'sidecarError.invalid_synthesis_request': 'La richiesta di lettura non è valida.',
  'sidecarError.missing_voice_file': 'La voce di lettura selezionata non è installata.',
  'sidecarError.sidecar_exited': 'Il processo sidecar è terminato inaspettatamente.',
  'sidecarError.synthesis_cancelled': 'La lettura è stata annullata.',
  'sidecarError.synthesis_failed': 'La sintesi vocale locale non è riuscita.',
  'sidecarError.synthesis_worker_unavailable':
    'Il processo di sintesi vocale locale non è disponibile.',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Lettura naturale locale in inglese con una selezione di voci curate.',
  'catalog.family.pocket_tts.summary':
    'Legge localmente le note in inglese, francese, tedesco, spagnolo, portoghese e italiano con voci selezionabili e controllo della velocità che preserva il tono.',
  'commands.translateNote': 'Traduci nota',
  'commands.translateSelection': 'Traduci selezione',
  'models.manage.translationModels': 'Traduzione',
  'translation.modal.privacy': 'La traduzione viene eseguita interamente su questo dispositivo.',
  'translation.modal.from': 'Da',
  'translation.modal.to': 'A',
  'translation.modal.swap': 'Scambia',
  'translation.modal.largeNote': 'Nota grande: la traduzione potrebbe richiedere alcuni secondi.',
  'translation.modal.sourceSelection': 'Selezione originale',
  'translation.modal.sourceNote': 'Nota originale',
  'translation.modal.previewAria': 'Anteprima della traduzione',
  'translation.modal.readAloud': 'Leggi la traduzione ad alta voce in {language}',
  'translation.modal.preparing': 'Preparazione della traduzione locale…',
  'translation.modal.loading': 'Caricamento del modello locale…',
  'translation.modal.translating': 'Traduzione in corso…',
  'translation.modal.translatingProgress': 'Traduzione… {completed}/{total}',
  'translation.modal.ready': 'Traduzione pronta.',
  'translation.modal.readyPartial_one':
    'Traduzione pronta. 1 blocco è rimasto nella lingua di partenza perché non è stato possibile conservarne la formattazione.',
  'translation.modal.readyPartial_other':
    'Traduzione pronta. {count} blocchi sono rimasti nella lingua di partenza perché non è stato possibile conservarne la formattazione.',
  'translation.modal.canceled': 'Traduzione annullata.',
  'translation.modal.failed': 'Traduzione non riuscita.',
  'translation.modal.missingModel':
    'Installa il pacchetto di traduzione locale per usare questa coppia di lingue.',
  'translation.modal.missingEngineModel':
    '{style} non è installato. Installa il relativo modello locale per tradurre questa coppia di lingue.',
  'translation.modal.unsupportedPairModel':
    'I modelli di traduzione installati non supportano questa coppia di lingue.',
  'translation.modal.incompleteModel':
    'Al modello di traduzione mancano dei file. Reinstallalo per continuare.',
  'translation.modal.installModel': 'Installa modello di traduzione',
  'translation.modal.translateAgain': 'Traduci di nuovo',
  'translation.modal.cancel': 'Annulla',
  'translation.modal.replace': 'Sostituisci',
  'translation.modal.insertBelow': 'Inserisci sotto',
  'translation.modal.copy': 'Copia',
  'translation.modal.dismiss': 'Ignora',
  'translation.modal.stale':
    'La nota è cambiata da quando è iniziata questa traduzione. Avvia una nuova traduzione o copia questa.',
  'translation.notice.copied': 'Traduzione copiata.',
  'translation.notice.copyFailed': 'Impossibile copiare la traduzione.',
  'translation.notice.tooLong': 'Traduci fino a {count} caratteri alla volta.',
  'catalog.firefox_translations_release_2026_07.summary':
    'Traduzione locale rapida tra inglese e sette lingue con modelli pubblicati in Firefox.',
  'catalog.family.firefox_translations.summary':
    'Traduce localmente il testo delle note con il motore compatto Bergamot e i modelli Firefox.',
} satisfies TranslationCatalog;
