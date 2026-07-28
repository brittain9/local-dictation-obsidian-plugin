import type { TranslationCatalog } from '.';

export const nl = {
  'notice.dictationNotActive': 'Dicteren is momenteel niet actief.',
  'notice.dictationStartFailed': 'Kan het dicteren niet starten.',
  'notice.dictationStopFailed': 'Kan het dicteren niet stoppen.',
  'notice.lastUtteranceCleared': 'De laatst bewaarde uiting gewist.',
  'notice.lastUtteranceReinsertFailed': 'Kan de laatste voltooide uiting niet opnieuw invoegen.',
  'notice.lastUtteranceReinserted': 'De laatste voltooide uiting is opnieuw ingevoegd.',
  'notice.lastUtteranceUnavailable':
    'Er is geen definitieve uiting beschikbaar om opnieuw in te voegen.',
  'notice.llmTransformEmpty': 'De LLM-transformatie heeft niets opgeleverd om toe te voegen.',
  'notice.microphoneDisconnected':
    'De microfoon is losgekoppeld. Het dicteren is gestopt; reeds opgenomen audio wordt nog verwerkt. Sluit de microfoon opnieuw aan en start het dicteren opnieuw.',
  'notice.rawTranscriptChanged':
    'Kan het onbewerkte transcript niet herstellen omdat de notitie is gewijzigd na het opruimen.',
  'notice.rawTranscriptCleared': 'Herstel van onbewerkte transcripties gewist.',
  'notice.rawTranscriptCopied': 'Het ruwe transcript gekopieerd.',
  'notice.rawTranscriptCopyFailed': 'Kan het onbewerkte transcript niet kopiëren.',
  'notice.rawTranscriptRestored': 'Het onbewerkte transcript hersteld.',
  'notice.rawTranscriptRestoreFailed': 'Kan het onbewerkte transcript niet herstellen.',
  'notice.rawTranscriptTargetUnavailable':
    'Kan het onbewerkte transcript niet herstellen omdat de oorspronkelijke notitie niet langer in dezelfde editor geopend is.',
  'notice.rawTranscriptUnavailable': 'Er is geen herstel van onbewerkte transcripties beschikbaar.',
  'notice.sidecarHealthCheckFailed': 'Sidecar-gezondheidscontrole mislukt',
  'notice.sidecarReady': 'Sidecar is gereed ({version}).',
  'notice.sidecarRestarted': 'sidecar opnieuw gestart ({version}).',
  'notice.sidecarRestartFailed': 'Opnieuw opstarten van Sidecar mislukt',
  'notice.sidecarRestartRequiresIdle':
    'Start de sidecar alleen opnieuw als dicteren en voorlezen niet actief zijn.',
  'notice.transcriptRecordFailed': 'Kan het transcript niet opnemen.',
  'notice.sidecarSessionError': 'De spraakengine heeft een fout gerapporteerd.',
  'notice.sidecarVersionDrift.actionMultiple': 'Spraakengines bijwerken',
  'notice.sidecarVersionDrift.actionOne': 'Spraakengine bijwerken',
  'notice.sidecarVersionDrift.cpu':
    'Bijgewerkt naar {version}, maar de geïnstalleerde spraakengine is verouderd. Update nu om ze gesynchroniseerd te houden.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Bijgewerkt naar {version}, maar de geïnstalleerde CPU- en CUDA-spraakengines zijn verouderd. Update nu om ze gesynchroniseerd te houden.',
  'notice.sidecarVersionDrift.cuda':
    'Bijgewerkt naar {version}, maar de geïnstalleerde CUDA-spraakengine is verouderd. Update nu om ze gesynchroniseerd te houden.',
  'notice.surfaceDesynchronized':
    'Het dicteren is gestopt omdat de notitie veranderde op een manier die Speech Kit niet veilig kon volgen. Start het dicteren opnieuw om door te gaan.',
  'notice.targetNoteClosed':
    'Het dicteren is gestopt omdat de doelnotitie is gesloten of vervangen. Start het dicteren opnieuw om door te gaan.',
  'notice.targetNoteDeleted':
    'Het dicteren is gestopt omdat de doelnotitie is verwijderd. Herstel of maak de notitie opnieuw en begin vervolgens opnieuw met dicteren.',
  'notice.transcriptWriteFailed':
    'Het dicteren is gestopt omdat Speech Kit niet veilig naar de notitie kon schrijven. Start het dicteren opnieuw om door te gaan.',
  'setup.sidecar.cpu.firstRun.body':
    'Voor Speech Kit is een eenmalige download van de CPU spraak-naar-tekst-engine uit GitHub-releases vereist. Nadat deze is voltooid, wordt de transcriptie lokaal op uw machine uitgevoerd. U kunt de CUDA-versnelling later via de instellingen installeren.',
  'setup.sidecar.cpu.firstRun.primaryButton': 'CPU sidecar downloaden',
  'setup.sidecar.cpu.firstRun.success': 'Speech Kit sidecar geïnstalleerd en gestart.',
  'setup.sidecar.cpu.firstRun.title': 'Voltooi het instellen van Speech Kit',
  'setup.sidecar.cpu.install.body':
    'Download de CPU spraak-naar-tekst-engine uit GitHub-releases. Nadat deze is voltooid, wordt de transcriptie lokaal op uw machine uitgevoerd.',
  'setup.sidecar.cpu.install.primaryButton': 'CPU sidecar downloaden',
  'setup.sidecar.cpu.install.success': 'CPU sidecar geïnstalleerd en gestart.',
  'setup.sidecar.cpu.install.title': 'Installeer CPU sidecar',
  'setup.sidecar.cpu.reinstall.body':
    'Download de CPU spraak-naar-tekst-engine opnieuw vanuit GitHub-releases. Dit vervangt de huidige CPU-installatie.',
  'setup.sidecar.cpu.reinstall.primaryButton': 'CPU sidecar opnieuw downloaden',
  'setup.sidecar.cpu.reinstall.success': 'CPU sidecar opnieuw geïnstalleerd en opnieuw opgestart.',
  'setup.sidecar.cpu.reinstall.title': 'Installeer CPU sidecar opnieuw',
  'setup.sidecar.cuda.install.primaryButton': 'CUDA sidecar downloaden',
  'setup.sidecar.cuda.install.success': 'CUDA sidecar geïnstalleerd en gestart.',
  'setup.sidecar.cuda.install.title': 'Installeer CUDA-versnelling',
  'setup.sidecar.mac.firstRun.body':
    'Speech Kit heeft een eenmalige download nodig van de spraak-naar-tekst-engine uit GitHub-releases. Eenmaal geïnstalleerd, draait de transcriptie volledig op je Mac; audio verlaat nooit je machine.',
  'setup.sidecar.mac.firstRun.primaryButton': 'sidecar downloaden',
  'setup.sidecar.mac.firstRun.success': 'Speech Kit sidecar geïnstalleerd en gestart.',
  'setup.sidecar.mac.firstRun.title': 'Voltooi het instellen van Speech Kit',
  'setup.sidecar.mac.install.body':
    'Download de spraak-naar-tekst-engine van GitHub-releases. De transcriptie wordt lokaal op uw Mac uitgevoerd nadat deze is voltooid.',
  'setup.sidecar.mac.install.primaryButton': 'sidecar downloaden',
  'setup.sidecar.mac.install.success': 'Sidecar geïnstalleerd en gestart.',
  'setup.sidecar.mac.install.title': 'Installeer sidecar',
  'setup.sidecar.mac.reinstall.body':
    'Download de spraak-naar-tekst-engine opnieuw vanaf GitHub-releases. Deze vervangt de huidige installatie.',
  'setup.sidecar.mac.reinstall.primaryButton': 'Download sidecar opnieuw',
  'setup.sidecar.mac.reinstall.success': 'Sidecar opnieuw geïnstalleerd en opnieuw opgestart.',
  'setup.sidecar.mac.reinstall.title': 'Installeer sidecar opnieuw',
  'setup.sidecar.update.body':
    'Download de huidige {engineLabel} zodat deze overeenkomt met deze versie van Speech Kit. Bestaande installaties worden op hun plaats vervangen.',
  'setup.sidecar.update.engine.cpuAndCuda': 'CPU- en CUDA-spraakengines',
  'setup.sidecar.update.engine.cuda': 'CUDA spraakengine',
  'setup.sidecar.update.engine.default': 'spraakengine',
  'setup.sidecar.update.primaryButton_one': 'Spraakengine bijwerken',
  'setup.sidecar.update.primaryButton_other': 'Spraakengines bijwerken',
  'setup.sidecar.update.success_one': 'Speech Kit-spraakengine bijgewerkt en opnieuw gestart.',
  'setup.sidecar.update.success_other': 'Speech Kit-spraakengines bijgewerkt en opnieuw opgestart.',
  'setup.sidecar.update.title_one': 'Spraakengine bijwerken',
  'setup.sidecar.update.title_other': 'Update spraakengines',
  'audio.microphone.permissionDeniedMac':
    'Microfoontoestemming geweigerd. Open Systeeminstellingen → Privacy en beveiliging → Microfoon, schakel Obsidian in, start Obsidian opnieuw op en probeer het opnieuw.',
  'audio.microphone.permissionDenied':
    'Microfoontoestemming geweigerd. Verleen toegang via uw besturingssysteeminstellingen en probeer het opnieuw.',
  'audio.microphone.notFound':
    'Geen microfoon gedetecteerd. Sluit een microfoon of USB-headset aan, of schakel een invoerapparaat in de geluidsinstellingen van uw besturingssysteem in en probeer het vervolgens opnieuw.',
  'audio.microphone.notReadable':
    'Microfoon kon niet worden geopend. Mogelijk maakt een andere app er gebruik van, of is er een fout opgetreden in het audioapparaat. Sluit andere apps met de microfoon en probeer het opnieuw.',
  'audio.systemAudio.notReady': 'Systeemaudio is niet gereed.',
  'audio.systemAudio.outdatedInstaller':
    '{message} Uw Obsidian-installatieprogramma dateert van vóór de macOS-systeemaudiotoestemming. Download een nieuw installatieprogramma van obsidian.md, installeer het opnieuw en probeer het opnieuw.',
  'commands.toggleDictation': 'Dicteren in-/uitschakelen',
  'commands.startDictation': 'Begin met dicteren',
  'commands.stopDictation': 'Stop met dicteren',
  'commands.cancelDictation': 'Dicteren annuleren',
  'commands.reinsertLastUtterance': 'Laatste uiting opnieuw invoegen',
  'commands.clearLastUtterance': 'Laatste uiting wissen',
  'commands.restoreRawTranscript': 'Herstel onbewerkte transcriptie',
  'commands.copyRawTranscript': 'Kopieer onbewerkte transcriptie',
  'commands.clearRawRecovery': 'Hersteltekst wissen',
  'commands.checkSidecarHealth': 'Controleer de status van de sidecar',
  'commands.restartSidecar': 'Start sidecar opnieuw',
  'common.reset': 'Opnieuw instellen',
  'settings.acceleration.pending': 'in behandeling (sidecar niet gereed)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} niet beschikbaar)',
  'settings.acceleration.unknownReason': 'onbekende reden',
  'settings.dictationLanguage.autoDetect': 'Automatische detectie',
  'settings.dictationLanguage.name': 'Dicteertaal',
  'settings.dictationLanguage.englishOnlyDesc':
    'Het geselecteerde model, {model}, ondersteunt alleen Engels.',
  'settings.dictationLanguage.desc':
    'Kies de taal die u gaat spreken. Handmatige selectie geeft de meest voorspelbare opruiming. Automatische detectie start mogelijk langzamer en kiest één taal per uiting.',
  'settings.dictationLanguage.unsupported': '{language} (niet ondersteund)',
  'settings.engine.named': '{engine}-engine',
  'settings.groups.model': 'Modellen',
  'settings.groups.capture': 'Opname',
  'settings.groups.transcriptOutput': 'Transcriptuitvoer',
  'settings.groups.timestamps': 'Tijdstempels',
  'settings.groups.llmTransformation': 'LLM-transformatie',
  'settings.groups.engine': 'Engine',
  'settings.groups.advanced': 'Geavanceerd',
  'settings.listeningMode.alwaysOn': 'Altijd aan',
  'settings.listeningMode.oneSentence': 'Eén zin',
  'settings.listeningMode.name': 'Luistermodus',
  'settings.listeningMode.desc': 'Continu, of stop na één zin.',
  'settings.insertText.atCursor': 'Bij cursor',
  'settings.insertText.endOfNote': 'Einde van de notitie',
  'settings.insertText.name': 'Tekst invoegen',
  'settings.insertText.desc': 'Waar gedicteerde tekst verschijnt.',
  'settings.transcriptFormatting.smartParagraphs': "Slimme alinea's",
  'settings.transcriptFormatting.space': 'Spatie',
  'settings.transcriptFormatting.newLine': 'Nieuwe regel',
  'settings.transcriptFormatting.newParagraph': 'Nieuwe alinea',
  'settings.transcriptFormatting.name': 'Opmaak van transcripties',
  'settings.transcriptFormatting.desc': 'Hoe zinnen met elkaar worden verbonden.',
  'settings.phraseFinalization.responsiveOption': 'Responsief – korte pauzes',
  'settings.phraseFinalization.balancedOption': 'Evenwichtig – standaard',
  'settings.phraseFinalization.patientOption': 'Geduldig – lange pauzes',
  'settings.phraseFinalization.name': 'Afronding van de zin',
  'settings.phraseFinalization.responsive':
    'Wordt voltooid na kortere pauzes voor sneller voltooide tekst.',
  'settings.phraseFinalization.balanced':
    'Gebruikt de standaard pauzetolerantie voor dagelijks dicteren.',
  'settings.phraseFinalization.patient':
    'Wacht langere pauzes af, zodat de kans kleiner is dat een gedachte gespleten wordt.',
  'settings.phraseFinalization.tooltip':
    'Geldt voor elk transcriptiemodel. Live woorden kunnen nog worden bijgewerkt voordat de zin definitief is. Dit verandert de grenzen van spraakactiviteit, niet de schrijfstijl of modelnauwkeurigheid. Responsief geeft voorrang aan snelheid; Geduldig houdt pauzes liever binnen één zin.',
  'settings.systemAudio.name': 'Inclusief systeemaudio',
  'settings.systemAudio.desc':
    "Leg ook de standaard audio-uitvoer van deze computer vast voor vergaderingen, gesprekken en video's.",
  'settings.systemAudio.ready': 'Systeemaudio is gereed.',
  'settings.systemAudio.testFailed':
    'Kan systeemaudio niet testen. Controleer of de spraakengine is geïnstalleerd en probeer het opnieuw.',
  'settings.speakerLabels.name': 'Sprekerlabels',
  'settings.speakerLabels.desc': 'Label elke zin per spreker.',
  'settings.speakerLabels.streamingLimitation': 'Sprekerlabels vereisen een batchmodel.',
  'settings.speakerLabels.modal.title': 'Instellingen voor sprekerlabels',
  'settings.speakerLabels.modal.intro':
    'Sprekerlabels worden na elke gedetecteerde gesproken zin op het apparaat bepaald. Ze vereisen een batchtranscriptiemodel.',
  'settings.speakerLabels.maximumSpeakers.name': 'Maximumaantal sprekers',
  'settings.speakerLabels.maximumSpeakers.desc':
    'Automatisch bepaalt het aantal sprekers. Stel alleen een limiet in als er te veel sprekerlabels verschijnen.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Schakel sprekerlabels in voordat u een maximumaantal sprekers instelt.',
  'settings.speakerLabels.automatic': 'Automatisch',
  'settings.timestamps.enable.name': 'Gebruik tijdstempels',
  'settings.timestamps.enable.desc':
    'Voeg tijdstempels toe als herkenningspunten in transcripties.',
  'settings.timestamps.modal.title': 'Tijdstempel instellingen',
  'settings.timestamps.modal.intro':
    'Kies oriëntatiepunten op intervallen, zinsgrenzen of slimme alinea-einden.',
  'settings.timestamps.clock.elapsed': 'Verstreken',
  'settings.timestamps.clock.wallClock': 'Lokale tijd',
  'settings.timestamps.frequency.atIntervals': 'Met tussenpozen',
  'settings.timestamps.frequency.everyPhrase': 'Elke zin',
  'settings.timestamps.frequency.atParagraphBreaks': 'Bij alinea-einden',
  'settings.timestamps.sessionHeader.name': 'Sessiekop',
  'settings.timestamps.sessionHeader.desc':
    'Start elke sessie met tijdstempel met [JJJJ-MM-DD HH:MM].',
  'settings.timestamps.referenceClock.name': 'Referentie klok',
  'settings.timestamps.referenceClock.desc':
    'Verstreken tijd sinds het dicteren is gestart, of de lokale kloktijd.',
  'settings.timestamps.frequency.name': 'Frequentie',
  'settings.timestamps.frequency.desc': 'Kies hoe vaak tijdstempels verschijnen.',
  'settings.timestamps.frequency.sparseDesc':
    'Voeg op het ingestelde interval leesbare tijdmarkeringen toe.',
  'settings.timestamps.frequency.everyPhraseDesc':
    'Voeg een tijdstempel toe vóór elk modelgetimed segment, indien beschikbaar, en anders bij elke stemgedetecteerde zin.',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    "Stel de transcriptopmaak in op Slimme alinea's om alinea-einden te krijgen.",
  'settings.timestamps.frequency.paragraphDesc':
    'Voeg een tijdstempel toe aan het begin van de sessie en bij elk slim alinea-einde.',
  'settings.timestamps.interval.name': 'Interval',
  'settings.timestamps.interval.desc': 'Seconden tussen tijdstempeloriëntatiepunten ({min}-{max}).',
  'settings.timestamps.interval.inactiveDesc':
    'Wordt alleen gebruikt als de frequentie is ingesteld op Met intervallen.',
  'settings.timestamps.interval.validation':
    'Voer een geheel getal in, variërend van {min} tot {max} seconden.',
  'settings.smartParagraph.modal.title': 'Slimme alinea-instellingen',
  'settings.smartParagraph.modal.intro':
    "Slimme alinea's zetten langere pauzes om in regel- of alinea-einden. Deze waarden zijn alleen van toepassing als de transcriptopmaak is ingesteld op Slimme alinea's.",
  'settings.smartParagraph.lineBreakPause.name': 'Pauze voor regeleinde',
  'settings.smartParagraph.lineBreakPause.desc':
    'Seconden vóór een enkele regeleinde ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Paragraaf pauze',
  'settings.smartParagraph.paragraphPause.desc': 'Seconden vóór een alinea-einde ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Schakel LLM-functies in',
  'settings.llm.enableFeatures.desc':
    'LLM-transformaties beschikbaar maken. Schakel transformatie in of uit in de zijbalk.',
  'settings.llm.enableRemote.name': 'Schakel externe LLM in',
  'settings.llm.enableRemote.desc':
    'Toestaan ​​dat transcriptietekst en opgenomen notitiecontext naar OpenRouter worden verzonden. Audio wordt nooit verzonden.',
  'settings.llm.restoreDefaults.name': 'Herstel standaardinstellingen voor transformatie',
  'settings.llm.restoreDefaults.desc':
    'Reset preset, timing, context, minimum aantal woorden en temperatuur. Opgeslagen presets en modellen blijven behouden.',
  'settings.llm.restoreDefaults.button': 'Herstellen',
  'settings.llm.restoreDefaults.confirmMessage':
    'De standaardvoorinstelling, timing, context, minimumwoorden en temperatuur herstellen? Opgeslagen presets en modellen blijven behouden.',
  'settings.llm.migratedPreset': 'Mijn voorinstelling',
  'settings.llm.migratedPresetNumbered': 'Mijn preset {number}',
  'settings.recoveryMemory.name': 'Bewaar de hersteltekst in het geheugen',
  'settings.recoveryMemory.desc':
    'Bewaar de nieuwste herstelbare tekst en notitiemomentopname in het geheugen. Er wordt niets naar de schijf geschreven.',
  'settings.modelStoreOverride.name': 'Modelopslagmap overschrijven',
  'settings.modelStoreOverride.desc': 'Aangepaste map voor beheerde modeldownloads.',
  'settings.modelStoreOverride.placeholder': 'Gebruik het gedeelde standaardmodelarchief',
  'settings.runSetup.name': 'Voer de installatie uit',
  'settings.runSetup.desc': 'Voer de wizard voor de eerste installatie opnieuw uit.',
  'settings.hardwareAcceleration.name': 'Hardwareversnelling',
  'settings.hardwareAcceleration.desc': 'Voer gevolgtrekking uit op de GPU, indien beschikbaar.',
  'settings.hardwareAcceleration.busy':
    'Kan de hardwareversnelling niet wijzigen terwijl dicteren of voorlezen actief is. Als het dicteren na het stoppen nog wordt verwerkt, voert u ‘Dicteren annuleren’ uit.',
  'settings.hardwareAcceleration.on': 'Hardwareversnelling ingeschakeld.',
  'settings.hardwareAcceleration.off': 'Hardwareversnelling uitgeschakeld.',
  'settings.noteContext.name': 'Gebruik notitie als context',
  'settings.noteContext.desc':
    'Stuur bij handmatig geselecteerd Engels onderscheidende termen uit de geopende notitie om de spelling te verbeteren.',
  'settings.noteContext.tooltip':
    'Stuurt een woordenlijst met eigennamen en technische termen als initiële prompt van de engine. Alleen gebruikt bij handmatig geselecteerd Engels met engines die initiële prompts ondersteunen.',
  'settings.microphone.name': 'Microfoon',
  'settings.microphone.desc':
    'Welke microfoon u moet gebruiken voor dicteren. Wijzigingen zijn van toepassing op de volgende dicteersessie.',
  'settings.microphone.default': 'Standaard microfoon',
  'settings.microphone.labelUnavailable': 'Microfoon (label niet beschikbaar)',
  'settings.microphone.notConnected': '{microphone} (niet aangesloten)',
  'settings.microphone.detectTooltip': 'Microfoons detecteren (vraagt ​​toestemming)',
  'settings.microphone.allowAccessFirst':
    'Sta eerst microfoontoegang toe om dit apparaat op te slaan.',
  'settings.microphone.stopDictationToDetect': 'Stop het dicteren om microfoons te detecteren.',
  'settings.microphone.unavailableRuntime': 'Microfoontoegang is in deze runtime niet beschikbaar.',
  'settings.microphone.detectFailed':
    'Kan microfoons niet detecteren. Controleer de audio-instellingen van uw systeem.',
  'settings.microphone.fallbackSaveFailed':
    'Opgeslagen microfoon niet beschikbaar. De standaardmicrofoon wordt gebruikt, maar deze wijziging kan niet worden opgeslagen. Selecteer een beschikbare microfoon in Instellingen voordat u Obsidian opnieuw opstart.',
  'settings.microphone.fallbackUnchanged':
    'Opgeslagen microfoon niet beschikbaar. Gebruik van de standaardmicrofoon voor deze sessie; de huidige microfooninstelling bleef ongewijzigd.',
  'settings.microphone.fallbackCleared':
    'Opgeslagen microfoon niet beschikbaar. De standaardmicrofoon gebruiken; de opgeslagen selectie is gewist voor toekomstige sessies.',
  'settings.model.notInstalled': 'Niet geïnstalleerd',
  'settings.model.validatedExternal': 'Gevalideerd · extern',
  'settings.model.external': 'Extern',
  'settings.model.checking': 'Controleren…',
  'settings.model.unavailable': 'Niet beschikbaar',
  'settings.model.noModel': 'Geen model',
  'settings.model.streaming': 'Streamen',
  'settings.model.manageModels': 'Beheer modellen',
  'settings.model.useExternalFile': 'Gebruik een extern bestand',
  'settings.model.details': 'Modeldetails',
  'settings.install.installingNamed': 'Installeren: {name}',
  'settings.install.installingSidecar': 'Installeren: {variant} sidecar',
  'settings.install.installingSidecarMac': 'sidecar installeren',
  'settings.install.cancelling': 'Annuleren...',
  'settings.install.cancel': 'Annuleren',
  'settings.missingSidecar.name': 'Stel Speech Kit in',
  'settings.missingSidecar.desc':
    'Speech Kit is nog niet klaar. Voer de installatiewizard uit om de spraakengine en een model te installeren.',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': '{variant} sidecar',
  'settings.sidecar.desc': 'Spraak-naar-tekst-engine.',
  'settings.sidecar.cpuName': 'CPU sidecar',
  'settings.sidecar.cpuDesc': 'Spraak-naar-tekst-engine. Vereist.',
  'settings.sidecar.gpuName': 'GPU sidecar',
  'settings.sidecar.cudaLibraryPath.name': 'CUDA-bibliotheekpad',
  'settings.sidecar.cudaLibraryPath.desc':
    'Optioneel bibliotheekzoekpad voor de sidecar (Flatpak, aangepaste CUDA-installaties).',
  'settings.sidecar.installAnyway': 'Hoe dan ook installeren',
  'settings.sidecar.stopBeforeInstall':
    'Stop met dicteren of voorlezen voordat u een sidecar installeert: tijdens de installatie wordt de engine opnieuw gestart. Als het dicteren nog wordt verwerkt, voert u ‘Dicteren annuleren’ uit om het nu te stoppen.',
  'settings.sidecar.stopBeforeUninstall':
    'Stop met dicteren of voorlezen voordat u {sidecar} verwijdert. Als het dicteren nog wordt verwerkt, voert u ‘Dicteren annuleren’ uit om het nu te stoppen.',
  'settings.sidecar.uninstallFailed':
    'Kan {sidecar} niet verwijderen. Sluit andere installatievensters en probeer het opnieuw.',
  'settings.sidecar.uninstalled': 'Sidecar verwijderd.',
  'settings.sidecar.cudaUninstalled': 'CUDA sidecar verwijderd. Draait op CPU.',
  'settings.sidecar.cpuUninstalled': 'CPU sidecar verwijderd.',
  'settings.sidecar.restartFailed':
    'De spraakengine kon niet opnieuw opstarten. Start Obsidian opnieuw voordat u gaat dicteren.',
  'settings.sidecar.reinstall': 'Opnieuw installeren',
  'settings.sidecar.uninstall': 'Verwijderen',
  'settings.sidecar.install': 'Installeren',
  'plugin.name': 'Speech Kit',
  'common.cancel': 'Annuleren',
  'common.delete': 'Verwijderen',
  'common.duplicate': 'Dupliceren',
  'common.free': 'Gratis',
  'common.inherit': 'Overnemen',
  'common.off': 'Uit',
  'common.on': 'Aan',
  'common.save': 'Opslaan',
  'common.unavailable': 'Niet beschikbaar',
  'ribbon.idle': 'Speech Kit — start het dicteren',
  'ribbon.starting': 'Speech Kit — starten…',
  'ribbon.listening': 'Speech Kit — luistert',
  'ribbon.speechDetected': 'Speech Kit — spraak gedetecteerd',
  'ribbon.error': 'Speech Kit — fout',
  'validation.wholeNumberRange': 'Voer een geheel getal in, van {min} tot {max}.',
  'validation.numberRange': 'Voer een getal in van {min} tot {max}.',
  'llm.managedByPreset':
    'Beheerd door “{preset}”. Bewerk die voorinstelling om deze waarde te wijzigen.',
  'llm.context.title': 'Contextinstellingen',
  'llm.context.settingsTooltip': 'Contextinstellingen',
  'llm.context.intro':
    'Meer context kan de terminologie verbeteren, maar kan de lokale latentie of de OpenRouter-kosten verhogen.',
  'llm.context.noteLength.name': 'Lengte van notitiecontext',
  'llm.context.noteLength.description':
    'Maximumaantal tekens uit de huidige notitie boven de cursor.',
  'llm.context.previousPhrases.name': 'Vorige zinnen',
  'llm.context.previousPhrases.description':
    'Recent gedicteerde zinnen opgenomen als gespreksgeschiedenis.',
  'llm.context.afterEachPhraseOnly':
    'Wordt alleen gebruikt wanneer Transformatie uitvoeren is ingesteld op Na elke zin.',
  'llm.context.limit.name': 'Contextlimiet',
  'llm.context.limit.description':
    'Maximaal aantal gecombineerde tekens uit de notitiecontext en eerdere zinnen.',
  'llm.context.useCurrentNote.name': 'Gebruik de huidige notitie als context',
  'llm.context.useCurrentNote.description': 'Plaats tekst boven de cursor in elke prompt.',
  'llm.model.title': 'Modelinstellingen',
  'llm.model.settingsTooltip': 'Modelinstellingen',
  'llm.model.temperature.name': 'Temperatuur',
  'llm.model.temperature.description':
    'Bemonsteringsvariatie. 0 is deterministisch; hogere waarden zijn gevarieerder.',
  'llm.model.remoteThreshold.name': 'Drempel voor routering op afstand',
  'llm.model.remoteThreshold.description':
    'Transcriptlengte die automatische transformaties naar OpenRouter (tekens) verzendt.',
  'llm.model.remoteTimeout.name': 'Time-out op afstand',
  'llm.model.remoteTimeout.description':
    'Wacht na zoveel seconden niet meer op OpenRouter. Het originele transcript wordt bewaard.',
  'llm.model.behavior.name': 'Modelgedrag',
  'llm.model.summary.temperature': 'Temperatuur {value}',
  'llm.model.summary.remoteThreshold': 'Op afstand bij {value}+ tekens',
  'llm.model.summary.timeout': 'Time-out van {value}s',
  'llm.failure.authInvalid': '{provider} API-sleutel afgewezen. Controleer instellingen.',
  'llm.failure.rateLimited':
    'Snelheidslimiet van {provider} bereikt. De onbewerkte tekst wordt gebruikt.',
  'llm.failure.network': 'Netwerkfout bij het bereiken van {provider}.',
  'llm.failure.modelNotConfigured':
    '{provider}-model is niet geconfigureerd. Kies er een onder Model.',
  'llm.failure.unknownModel': '{provider}-model niet gevonden. Kies een andere onder Model.',
  'llm.failure.unknown': 'LLM-transformatie mislukt. Zie console.',
  'llm.status.selectOllamaModel': 'Selecteer hieronder een Ollama-model.',
  'llm.status.selectOpenRouterModel': 'Selecteer hieronder een OpenRouter-model.',
  'llm.status.ollamaNotRunning': 'Ollama is niet actief.',
  'llm.status.unreachable': '{provider} is onbereikbaar.',
  'llm.status.authInvalid': '{provider} API-sleutel afgewezen.',
  'llm.status.rateLimited': 'Snelheidslimiet van {provider} bereikt.',
  'llm.status.noOllamaModels': 'Geen chatmodellen geïnstalleerd in Ollama.',
  'llm.status.noModels': 'Geen bruikbare {provider}-modellen gevonden.',
  'llm.status.selectedUnavailable': 'Het geselecteerde model is niet beschikbaar.',
  'llm.timing.title': 'Timing-instellingen',
  'llm.timing.settingsTooltip': 'Timing-instellingen',
  'llm.timing.minimumWords.name': 'Minimale woorden',
  'llm.timing.minimumWords.description':
    'Sla de transformatie over als het transcript minder woorden bevat.',
  'llm.timing.timestamps.perUtterance': 'Na elke zin blijven de tijdstempelgrenzen behouden.',
  'llm.timing.timestamps.batch':
    'Afhankelijk van de voorinstelling kunnen in één keer tijdstempels worden herschreven of verwijderd.',
  'llm.timing.option.perUtterance': 'Na elke zin',
  'llm.timing.option.batch': 'Alles tegelijk bij stoppen',
  'llm.routing.local': 'Lokaal',
  'llm.routing.remote': 'Op afstand',
  'llm.routing.auto': 'Auto',
  'llm.routing.ariaLabel': 'Voer transformaties uit met',
  'llm.routing.localHint': 'Draait volledig op uw apparaat met Ollama.',
  'llm.routing.remoteHint': 'Stuurt elk transcript naar OpenRouter voor transformatie.',
  'llm.routing.autoHint':
    'Blijft op het apparaat en overhandigt grote transcripties aan OpenRouter.',
  'llm.routing.localLeg': 'Lokaal · Ollama',
  'llm.routing.remoteLeg': 'Op afstand · OpenRouter',
  'llm.routing.priceTierTooltip': 'Geschatte prijsklasse',
  'llm.routing.providerModel': '{provider}-model',
  'llm.routing.ollamaModelDescription': 'Kies een lokaal Ollama-chatmodel.',
  'llm.routing.selectModel': 'Selecteer een model',
  'llm.routing.refreshModels': 'Ververs {provider}-modellen',
  'llm.routing.apiKey.name': 'OpenRouter API-sleutel',
  'llm.routing.apiKey.description': 'Veilig opgeslagen door Obsidian.',
  'llm.routing.openRouterModel.name': 'OpenRouter-model',
  'llm.routing.openRouterModel.description': 'Typ om naar OpenRouter-modellen te zoeken.',
  'llm.routing.testConnection': 'Test de API-sleutel en het model',
  'llm.sidebar.eyebrow': 'Workflow voor transcriptie',
  'llm.sidebar.title': 'Transformeer dictaat',
  'llm.sidebar.description':
    'Kies hoe gesproken tekst wordt gevormd voordat deze uw notitie bereikt.',
  'llm.sidebar.group.preset': 'Voorinstelling',
  'llm.sidebar.group.model': 'Model',
  'llm.sidebar.group.context': 'Context',
  'llm.sidebar.enabled.name': 'Ingeschakeld',
  'llm.sidebar.enabled.description':
    'Pas de actieve voorinstelling toe op nieuwe gedicteerde tekst.',
  'llm.sidebar.showOriginal.name': 'Toon origineel transcript',
  'llm.sidebar.showOriginal.description':
    'Bewaar het in een samenvouwbare toelichting onder elk getransformeerd resultaat.',
  'llm.sidebar.runTransform.name': 'Voer transformatie uit',
  'llm.sidebar.runTransform.description':
    'Voer de transformatie na elke zin uit, of alles tegelijk wanneer u stopt.',
  'llm.sidebar.runTransform.setByPreset': 'Ingesteld door {preset} — {timing}.',
  'llm.sidebar.activePreset': 'Actieve voorinstelling',
  'llm.sidebar.unavailable.title': 'LLM-functies zijn niet beschikbaar',
  'llm.sidebar.unavailable.description':
    'Schakel LLM-functies in de Speech Kit-instellingen in om transformaties te configureren.',
  'llm.sidebar.unavailable.summary': 'Schakel LLM-functies in de instellingen in',
  'llm.sidebar.off.title': 'Ruwe transcriptiemodus',
  'llm.sidebar.off.description':
    'Bij dicteren wordt het onbewerkte lokale transcript ingevoegd. Schakel Transformeren in als u wilt opschonen, herschrijven of samenvattingen wilt maken.',
  'llm.sidebar.off.summary': 'Ruwe transcriptie',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Opruimen',
  'llm.preset.builtin.cleanUp.description':
    'Corrigeer transcriptieartefacten, opvullingen, interpunctie en hoofdlettergebruik met behoud van stem en betekenis.',
  'llm.preset.builtin.cleanUp.prompt':
    'Schoon gedicteerde spraak-naar-tekst op. Corrigeer stopwoorden, valse starts, herhalingen, interpunctie, hoofdlettergebruik en duidelijke herkenningsfouten. Behoud de toon en betekenis van de spreker. Gebruik de referentiecontext alleen voor spelling. Schrijf in de oorspronkelijke taal van het transcript. Vertaal nooit tenzij de gebruiker daar expliciet om vraagt. Geef alleen de opgeschoonde tekst terug, zonder inleiding of commentaar.',
  'llm.preset.builtin.professionalWriting.label': 'Professioneel schrijven',
  'llm.preset.builtin.professionalWriting.description':
    'Herschrijf in beknopt, gepolijst professioneel proza, met behoud van feiten, namen, beslissingen en technische termen.',
  'llm.preset.builtin.professionalWriting.prompt':
    'Herschrijf gedicteerde spraak als beknopte, professionele tekst. Gebruik de actieve vorm en verwijder stopwoorden en afzwakkingen. Behoud elk feit, elke naam en elke term. Gebruik de referentiecontext voor spelling. Schrijf in de oorspronkelijke taal van het transcript. Vertaal nooit tenzij de gebruiker daar expliciet om vraagt. Geef alleen de herschreven tekst terug, zonder inleiding of commentaar.',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Voeg een korte TLDR-samenvatting toe boven uw onaangeroerde transcript.',
  'llm.preset.builtin.tldr.prompt':
    "Schrijf een TLDR-samenvatting van het gedicteerde transcript: een kop 'TLDR' gevolgd door 1-3 korte opsommingen die de belangrijkste punten bestrijken. Schrijf in de oorspronkelijke taal van het transcript. Vertaal nooit tenzij de gebruiker expliciet om vertaling vraagt. Geef alleen de kop en de opsommingen terug; herhaal de transcriptie niet, geen preambule, geen commentaar.",
  'llm.preset.builtin.markdownFormatting.label': 'Markdown-opmaak',
  'llm.preset.builtin.markdownFormatting.description':
    'Formatteer het transcript van de sessie opnieuw als gestructureerd Markdown met kopjes, lijsten en nadruk.',
  'llm.preset.builtin.markdownFormatting.prompt':
    'Formatteer gedicteerde spraak opnieuw als goed gestructureerde Markdown. Voeg waar nodig koppen, lijsten met opsommingstekens of nummers, vetgedrukte tekst, nadruk en afgeschermde codeblokken toe. Schoon stopwoorden, valse starts, interpunctie en hoofdlettergebruik licht op; behoud de formulering van de spreker, elk feit, elke naam en elke term. Schrijf in de oorspronkelijke taal van het transcript. Vertaal nooit tenzij de gebruiker daar expliciet om vraagt. Geef alleen de Markdown terug, zonder inleiding of commentaar.',
  'llm.preset.builtin.actionItems.label': 'Actiepunten',
  'llm.preset.builtin.actionItems.description':
    'Voeg een checklist met actiepunten toe onder uw onaangeroerde transcript.',
  'llm.preset.builtin.actionItems.prompt':
    "Haal actiepunten uit het gedicteerde transcript. Geef de kop 'Actiepunten', gevolgd door een Markdown-checklist met concrete taken. Vermeld een verantwoordelijke als de spreker die noemt. Geef niets terug als het transcript geen actiepunten bevat. Schrijf in de oorspronkelijke taal van het transcript. Vertaal nooit tenzij de gebruiker daar expliciet om vraagt. Geef alleen de kop en de checklist terug; herhaal het transcript niet en voeg geen inleiding of commentaar toe.",
  'llm.preset.timing.perUtterance': 'Loopt na elke zin',
  'llm.preset.timing.batch': 'Loopt 1 keer bij stop',
  'llm.preset.timing.either': 'Werkt in beide modi',
  'llm.preset.behavior.addAbove': 'voegt nieuwe inhoud toe boven het transcript',
  'llm.preset.behavior.addBelow': 'voegt nieuwe inhoud toe onder het transcript',
  'llm.preset.behavior.replace': 'herschrijft de gedicteerde tekst',
  'llm.preset.behavior.overrides': 'overschrijft {fields}',
  'llm.preset.override.minimumWords': 'min woorden',
  'llm.preset.override.temperature': 'temperatuur',
  'llm.preset.override.noteContext': 'notitiecontext',
  'llm.preset.option.perUtterance': '{preset} (na elke zin)',
  'llm.preset.option.batch': '{preset} (bij stop)',
  'llm.preset.copySuffix': '(kopiëren)',
  'llm.preset.copySuffixNumbered': ' (kopie {number})',
  'llm.preset.validation.nameRequired': 'Voer een naam in voor deze voorinstelling.',
  'llm.preset.validation.nameExists': 'Er bestaat al een voorinstelling met die naam.',
  'llm.preset.validation.promptRequired': 'Voer een prompt in voor deze voorinstelling.',
  'llm.preset.validation.minimumWords':
    'Min. woorden moeten een geheel getal zijn tussen 0 en {max}.',
  'llm.preset.validation.temperature': 'De temperatuur moet een getal tussen 0 en {max} zijn.',
  'llm.preset.validation.maximumCount':
    'U kunt maximaal {max}-voorinstellingen opslaan. Verwijder er eerst één.',
  'llm.preset.validation.builtinName':
    'Die naam wordt gebruikt door een ingebouwde voorinstelling: kies een andere naam.',
  'llm.preset.manager.title': 'Beheer voorinstellingen',
  'llm.preset.manager.newTitle': 'Nieuwe voorinstelling',
  'llm.preset.manager.editTitle': 'Voorinstelling bewerken',
  'llm.preset.manager.presets.name': 'Voorinstellingen',
  'llm.preset.manager.presets.description':
    'De actieve preset is gemarkeerd. Ingebouwde voorinstellingen zijn alleen-lezen: dupliceer er één om deze aan te passen.',
  'llm.preset.manager.new': 'Nieuwe voorinstelling',
  'llm.preset.manager.searchPlaceholder': 'Voorinstellingen zoeken...',
  'llm.preset.manager.noMatches':
    'Er zijn geen voorinstellingen die overeenkomen met uw zoekopdracht.',
  'llm.preset.manager.builtinHeading': 'Ingebouwd',
  'llm.preset.manager.yoursHeading': 'Uw voorinstellingen',
  'llm.preset.manager.viewTooltip': 'Voorinstelling bekijken',
  'llm.preset.manager.editTooltip': 'Voorinstelling bewerken',
  'llm.preset.manager.duplicateTooltip': 'Voorinstelling dupliceren',
  'llm.preset.manager.deleteTooltip': 'Voorinstelling "{preset}" verwijderen',
  'llm.preset.manager.back': '← Alle voorinstellingen',
  'llm.preset.editor.name': 'Naam',
  'llm.preset.editor.namePlaceholder': 'bijv. Notulen van de vergadering',
  'llm.preset.editor.description': 'Beschrijving (optioneel)',
  'llm.preset.editor.descriptionPlaceholder': 'Wanneer moet u deze voorinstelling gebruiken?',
  'llm.preset.editor.prompt': 'Prompt',
  'llm.preset.editor.promptDescription': 'Verzonden naar het model als systeemprompt.',
  'llm.preset.editor.promptSize':
    '~{tokens}-tokens ({characters}-tekens) — verzonden bij elk verzoek',
  'llm.preset.editor.timing': 'Tijdstip',
  'llm.preset.editor.timingDescription':
    'Wanneer de transformatie wordt uitgevoerd. "Ofwel" volgt de timing in de zijbalk.',
  'llm.preset.editor.timingEither': 'Beide (volg zijbalk)',
  'llm.preset.editor.timingPerUtterance': 'Na elke zin',
  'llm.preset.editor.timingBatch': 'Eenmaal op stop',
  'llm.preset.editor.output': 'Uitvoer',
  'llm.preset.editor.outputDescription':
    'Vervangen herschrijft uw gedicteerde tekst. Add houdt het onaangeroerd en voegt nieuwe inhoud in.',
  'llm.preset.editor.outputReplace': 'Tekst vervangen',
  'llm.preset.editor.outputAddAbove': 'Boven transcript toevoegen',
  'llm.preset.editor.outputAddBelow': 'Onder transcript toevoegen',
  'llm.preset.editor.overrides': 'Overschrijvingen',
  'llm.preset.editor.overridesDescription':
    'Laat een veld leeg om de algemene instelling te gebruiken.',
  'llm.preset.editor.minimumWords': 'Min woorden',
  'llm.preset.delete.title': 'Voorinstelling verwijderen',
  'llm.preset.delete.message':
    'Voorinstelling "{preset}" verwijderen? Dit kan niet ongedaan worden gemaakt.',
  'llm.preset.delete.activeFallback': '"{preset}" was actief - geschakeld naar Opschonen.',
  'common.back': 'Terug',
  'common.close': 'Sluiten',
  'common.done': 'Klaar',
  'common.install': 'Installeren',
  'common.later': 'Later',
  'common.next': 'Volgende',
  'common.remove': 'Verwijderen',
  'common.tryAgain': 'Probeer het opnieuw',
  'setup.ready.waitForDictation':
    'Wacht tot het huidige dictaat is voltooid en probeer het vervolgens opnieuw.',
  'setup.ready.openMarkdownNote':
    'Open een Markdown-notitie in de bewerkingsmodus en probeer opnieuw te dicteren.',
  'setup.ready.completionFailed': 'Kan het instellen niet voltooien. Probeer het opnieuw.',
  'setup.wizard.welcomeTitle': 'Welkom bij Speech Kit',
  'setup.wizard.title': 'Stel Speech Kit in',
  'setup.wizard.engineReadyTitle': 'Spraakengine gereed',
  'setup.wizard.engineReadyDesc': 'De lokale spraak-naar-tekst-engine is geïnstalleerd en gereed.',
  'setup.wizard.intro':
    'Dicteer handsfree notities, rechtstreeks in Obsidian — volledig op uw machine. Geen account, geen cloud, geen telemetrie.',
  'setup.wizard.quickSetup': 'Een snelle installatie van 2 minuten:',
  'setup.wizard.downloadEngineStep': 'Download de spraak-engine',
  'setup.wizard.pickModelStep': 'Kies een transcriptiemodel',
  'setup.wizard.startTalking':
    'Druk vervolgens op de microfoon in het lint (of op uw eigen sneltoets) en begin te praten.',
  'setup.wizard.downloadEngine': 'Engine downloaden',
  'setup.wizard.modelSelectedTitle': 'Model geselecteerd',
  'setup.wizard.pickModelTitle': 'Kies een transcriptiemodel',
  'setup.wizard.modelSelectedDesc':
    'Er wordt een transcriptiemodel geïnstalleerd en geselecteerd. Je kunt meer installeren of later overstappen via Instellingen.',
  'setup.wizard.modelIntro':
    'Installeer een transcriptiemodel om dicteren mogelijk te maken. U kunt er later meer installeren: kleinere modellen zijn sneller, grotere modellen zijn nauwkeuriger.',
  'setup.wizard.modelKinds':
    'Er zijn twee soorten beschikbaar: streamingmodellen tonen woorden live terwijl u spreekt; standaardmodellen worden na elke pauze getranscribeerd. Voor handsfree dicteren begint u met het aanbevolen Moonshine Small-model. Nemotron 3.5 ASR is een streamingoptie die meer systeembronnen vereist.',
  'setup.wizard.openModelPicker': 'Modelkiezer openen',
  'setup.wizard.readyTitle': 'U bent klaar om te dicteren',
  'setup.wizard.readyDesc':
    'Probeer het in de Markdown-notitie die nu is geopend. Spreek een paar woorden en gebruik vervolgens de lintmicrofoon of uw sneltoets om te stoppen.',
  'setup.wizard.ribbonTitle': 'Gebruik de lintmicrofoon',
  'setup.wizard.ribbonDesc':
    'Zoek dit pictogram in het Obsidian-lint. Klik erop om te beginnen met dicteren; klik nogmaals om te stoppen.',
  'setup.wizard.hotkeyTitle': 'Of bind een sneltoets',
  'setup.wizard.hotkeyDescBefore': 'Bind een snelkoppeling aan de',
  'setup.wizard.toggleCommandName': 'Speech Kit: dicteren wisselen',
  'setup.wizard.hotkeyDescAfter': 'opdracht om overal in Obsidian te starten en stoppen.',
  'setup.wizard.openHotkeySettings': 'Open sneltoetsinstellingen',
  'setup.wizard.tryDictationNow': 'Probeer nu dicteren',
  'setup.wizard.openHotkeySettingsFallback':
    'Open Instellingen → Sneltoetsen en zoek naar "Speech Kit".',
  'setup.sidecar.modal.download': 'Downloaden',
  'setup.sidecar.modal.variantDownload': '{variant} downloaden',
  'setup.sidecar.modal.version': 'Versie',
  'setup.sidecar.modal.cancelling': 'Annuleren...',
  'setup.sidecar.modal.downloading': 'Downloaden...',
  'setup.sidecar.modal.retryDownload': 'Probeer het downloaden opnieuw',
  'setup.sidecar.modal.installFailureNotice':
    'De installatie van de spraakengine is mislukt. Open de installatie of Instellingen opnieuw om de fout te bekijken en probeer het opnieuw.',
  'setup.sidecar.modal.startFailed':
    'Kan de sidecar-installatie niet starten. Sluit andere installatievensters en probeer het opnieuw.',
  'setup.sidecar.installCancelled': 'Installatie Sidecar geannuleerd.',
  'setup.sidecar.progress.variant': ' {variant} sidecar ({current} van {total})',
  'setup.sidecar.progress.downloading': 'Downloaden',
  'setup.sidecar.progress.verifying': 'Controlesom verifiëren...',
  'setup.sidecar.progress.extracting': 'Archief uitpakken...',
  'models.manage.title': 'Beheer modellen',
  'models.manage.loadFailedTitle': 'Kan modellen niet laden',
  'models.manage.loadFailedDesc':
    'De spraakengine is mogelijk niet geïnstalleerd of reageert mogelijk niet. Voer de installatie opnieuw uit om het opnieuw te installeren, of probeer het opnieuw.',
  'models.manage.runSetup': 'Voer de installatie uit',
  'models.manage.loadingCatalog': 'Modelcatalogus laden…',
  'models.manage.loadCatalogFailed': 'Kan de modelcatalogus niet laden.',
  'models.manage.noneAvailable': 'Er zijn geen modellen beschikbaar voor deze engine.',
  'models.manage.unsupportedLanguage':
    ' · Ondersteunt {language} niet. Wijzig de dicteertaal om dit model te installeren of te gebruiken.',
  'models.manage.use': 'Gebruik',
  'models.manage.selected': 'Gekozen',
  'models.manage.cancelling': 'Annuleren…',
  'models.manage.details': 'Details',
  'models.manage.installStartFailed': 'Kan de modelinstallatie niet starten. Probeer het opnieuw.',
  'models.manage.selectFailed':
    'Kan het model niet selecteren. Controleer of de bestanden beschikbaar zijn.',
  'models.manage.selectedNotice': 'Model geselecteerd.',
  'models.manage.removeFailed':
    'Kan het model niet verwijderen. Sluit elk proces met behulp van de bestanden.',
  'models.manage.removedNotice': 'Model verwijderd.',
  'models.external.title': 'Gebruik extern bestand',
  'models.external.intro':
    'Externe modellen zijn voor geavanceerd gebruik. Speech Kit downloadt, updatet of verifieert deze bestanden niet.',
  'models.external.family.name': 'Modelfamilie',
  'models.external.family.desc':
    'Kies de lader die bij het model past. De familie wordt niet afgeleid uit de bestandsnaam.',
  'models.external.path.name': 'Modelbestandspad',
  'models.external.path.desc':
    'Voer het absolute pad naar het primaire modelartefact in. Het wordt gevalideerd voordat deze selectie wordt opgeslagen.',
  'models.external.validateAndUse': 'Valideren en gebruiken',
  'models.external.validating': 'Valideren…',
  'models.external.selectedNotice': 'Extern modelbestand gevalideerd en geselecteerd.',
  'models.external.requirementsTitle': 'Bestandsvereisten',
  'models.external.validation.notConfigured': 'Het modelbestandspad is niet geconfigureerd.',
  'models.external.validation.notAbsolute': 'Het modelbestandspad moet een absoluut pad zijn.',
  'models.external.validation.missing': 'Modelbestandspad bestaat niet: {path}',
  'models.external.validation.notFile':
    'Het modelbestandspad moet naar een bestand verwijzen: {path}',
  'models.external.validation.selectEntryFile': 'Selecteer {filename}.',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR vereist het encoder.int8.onnx-artefact. Selecteer encoder.int8.onnx in de vastgezette 560 ms-modelmap.',
  'models.external.validation.moonshineEntryFile':
    'Moonshine vereist het primaire frontend.ort-artefact. Selecteer frontend.ort in de streamingmodelmap.',
  'models.external.validation.generic': 'De spraakengine kon dit model niet valideren.',
  'models.external.requirements.nemotron.entry':
    'Selecteer encoder.int8.onnx uit de vastgezette Nemotron 3.5 ASR 560 ms int8-export.',
  'models.external.requirements.nemotron.siblings':
    'Dezelfde map moet decoder.int8.onnx, joiner.int8.onnx en tokens.txt bevatten.',
  'models.external.requirements.nemotron.compatibility':
    'Andere chunkgroottes en ORT GenAI-exports zijn niet compatibel met deze adapter.',
  'models.external.requirements.moonshine.entry':
    'Selecteer frontend.ort in een Moonshine v2 streaming ORT-modelmap.',
  'models.external.requirements.moonshine.siblings':
    'Dezelfde map moet encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json en tokenizer.bin bevatten.',
  'models.external.requirements.moonshine.compatibility':
    'Niet-streaming Moonshine ONNX-exports zijn niet compatibel.',
  'models.external.requirements.whisper.entry':
    'Selecteer één Whisper.cpp-compatibel GGML- of GGUF-modelbestand.',
  'models.external.requirements.whisper.validation':
    'De lader valideert de bestandsinhoud; een bestandsnaamextensie alleen zorgt niet voor compatibiliteit.',
  'models.external.requirements.whisper.language':
    'Whisper-bestanden met .en-gewichten zijn alleen in het Engels; meertalige gewichten leggen de geverifieerde taalkiezer en automatische detectie bloot.',
  'models.details.totalSize': 'Totale grootte',
  'models.details.source': 'Bron',
  'models.details.license': 'Licentie',
  'models.details.capabilities': 'Mogelijkheden',
  'models.details.installPath': 'Installatiepad',
  'models.details.files': 'Bestanden ({count})',
  'models.details.size': 'Grootte',
  'models.capability.segmentTimestamps': 'Tijdstempels segmenteren',
  'models.capability.wordTimestamps': 'Woord-tijdstempels',
  'models.capability.initialPrompt': 'Eerste prompt',
  'models.capability.streaming': 'Streamen',
  'models.capability.autoLanguageDetection': 'Automatische taaldetectie',
  'models.capability.punctuation': 'Interpunctie',
  'models.capability.maxAudio': 'Max. audio: {seconds} s',
  'models.capability.anyLanguage': 'Elke taal',
  'models.capability.englishOnly': 'Alleen Engels',
  'models.capability.languageCount': '{count} talen',
  'models.capability.languageSelection': 'Taalkeuze',
  'models.tag.fullPrecision': 'Volledige precisie',
  'models.tag.reducedSize': 'Verkleind formaat',
  'models.progress.preparing': 'Installatie voorbereiden',
  'models.progress.downloading': 'Downloaden',
  'models.progress.verifying': 'Downloaden verifiëren',
  'models.progress.validating': 'Model valideren',
  'models.progress.installed': 'Model geïnstalleerd',
  'models.progress.cancelled': 'Modelinstallatie geannuleerd',
  'models.progress.failed': 'Modelinstallatie mislukt',
  'models.progress.downloadingFile': '{filename} downloaden',
  'models.progress.verifyingFile': '{filename} verifiëren',
  'models.progress.fileCount': 'Bestand {current} van {total}',
  'models.current.noneSelected': 'Geen model geselecteerd',
  'models.current.noneSelectedDesc': 'Kies een geïnstalleerd model of valideer een extern bestand.',
  'models.current.notSelected': 'Niet geselecteerd',
  'models.current.externalFile': 'Extern bestand',
  'models.current.managedNotInstalled': 'Het geselecteerde beheerde model is niet geïnstalleerd.',
  'models.current.installed': 'Geïnstalleerd',
  'models.current.notInstalled': 'Niet geïnstalleerd',
  'models.current.managedDownload': 'Beheerd downloaden',
  'models.current.externalValidated': 'Extern gevalideerd',
  'models.current.checking': 'Controleren',
  'models.current.externalUnavailableDesc':
    'Het externe model is niet beschikbaar. Valideer het bestand opnieuw om de details te bekijken.',
  'models.current.unavailable': 'Niet beschikbaar',
  'models.current.validateBeforeDictating':
    'Valideer het externe modelbestand voordat u gaat dicteren.',
  'sidecarError.audio_too_long': 'Audioclip overschrijdt de maximale duur voor deze engine.',
  'sidecarError.engine_inference_failed': 'Lokale transcriptie is mislukt.',
  'sidecarError.internal_error': 'Er is een interne fout opgetreden in de spraakengine.',
  'sidecarError.invalid_audio_buffer': 'De audiobuffer was leeg toen de transcriptie begon.',
  'sidecarError.invalid_audio_frame': 'De spraakengine heeft een ongeldig audioframe ontvangen.',
  'sidecarError.invalid_diarization_speaker_limit':
    'Het maximumaantal sprekers moet ten minste 1 zijn of ingesteld zijn op Automatisch.',
  'sidecarError.invalid_frame': 'De spraakengine heeft een ongeldig protocolframe ontvangen.',
  'sidecarError.invalid_model_file':
    'Modelbestand ontbreekt, is onleesbaar of wordt niet ondersteund.',
  'sidecarError.invalid_model_task':
    'Het geselecteerde model kan niet voor dicteren worden gebruikt.',
  'sidecarError.invalid_model_store': 'De modelopslagmap is niet beschikbaar of ongeldig.',
  'sidecarError.missing_model_file': 'Modelbestand bestaat niet of is geen regulier bestand.',
  'sidecarError.no_active_install':
    'Er is geen actieve modelinstallatie die kan worden geannuleerd.',
  'sidecarError.no_active_session': 'Er is geen actieve dicteersessie.',
  'sidecarError.session_already_exists': 'Er bestaat al een dicteersessie met deze ID.',
  'sidecarError.session_capacity_exceeded':
    'Speech Kit heeft al het maximale aantal actieve sessies.',
  'sidecarError.system_audio_capture_failed': 'Kan systeemaudio-opname niet starten.',
  'sidecarError.system_audio_permission_denied':
    'Toestemming voor het opnemen van systeemaudio is uitgeschakeld voor Obsidian. Open Systeeminstellingen → Privacy en beveiliging → Scherm- en systeemaudio-opname, schakel Obsidian in en probeer het opnieuw.',
  'sidecarError.system_audio_unsupported':
    'Systeemaudio-opname is nog niet beschikbaar op dit platform. Leid de uitvoer van deze computer door een virtueel audioapparaat en kies dit als uw microfoon. Zie de systeemaudiogids.',
  'sidecarError.transcription_failure': 'Lokale transcriptie is mislukt.',
  'sidecarError.unsupported_engine': 'De gevraagde engine is niet beschikbaar in deze build.',
  'sidecarError.unsupported_language': 'Het geselecteerde model ondersteunt deze dictaattaal niet.',
  'sidecarError.utterance_dropped_during_overload_drain':
    'Een definitieve uiting werd verwijderd terwijl de transcriptiewachtrij leegliep.',
  'sidecarError.utterance_queue_overload':
    'Het dicteren is gestopt omdat de transcriptiewachtrij overbelast is. Geaccepteerde audio wordt verwerkt.',
  'sidecarError.vad_error': 'Detectie van stemactiviteit is mislukt op een audioframe.',
  'sidecarError.vad_init_failed': 'Kan de gebundelde Silero VAD niet initialiseren.',
  'sidecarError.worker_panic': 'De transcriptiewerker van de spraakengine stopte onverwachts.',
  'catalog.whisper_tiny_en_q8_0.summary':
    'Snelste model met de laagste resourcekosten. Goed voor testen of machines met een laag vermogen.',
  'catalog.whisper_base_en_q8_0.summary':
    'Snel model met behoorlijke nauwkeurigheid. Een goede keuze voor snelle concepten op de CPU.',
  'catalog.whisper_small_en_q5_1.summary':
    'Brengt de transcriptiekwaliteit, downloadgrootte en CPU-snelheid in evenwicht.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Zeer nauwkeurig model voor gebruikers die transcriptiekwaliteit belangrijker vinden dan snelheid.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'Meertalige transcriptie met hoge nauwkeurigheid met een architectuur die is geoptimaliseerd voor GPU-versnelling.',
  'catalog.cohere_transcribe_fp16.summary':
    'Grootste Cohere-variant, met behoud van volledige modelprecisie.',
  'catalog.cohere_transcribe_int8.summary':
    'Middelste Cohere-variant op downloadgrootte, met behulp van 8-bit kwantisering.',
  'catalog.cohere_transcribe_q4.summary':
    'Kleinste Cohere-variant; 4-bit kwantisering verkleint de grootte tegen kwaliteitskosten.',
  'catalog.moonshine_tiny_streaming_en.summary':
    "Snelste Moonshine-streamingmodel met 34 miljoen parameters, ontworpen voor low-end CPU's.",
  'catalog.moonshine_small_streaming_en.summary':
    'Gebalanceerd live-dicteermodel met 123 miljoen parameters.',
  'catalog.moonshine_medium_streaming_en.summary':
    'Meest nauwkeurige Moonshine-streamingmodel met 245 miljoen parameters.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    "NVIDIA's 0,6B meertalige RNNT, geëxporteerd naar int8 ONNX voor cachebewuste live transcriptie in acht geverifieerde talen.",
  'catalog.family.whisper.summary':
    'Transcribeert na elke pauze. Whisper biedt nauwkeurigere tijdstempels dan andere modelfamilies, inclusief optionele timing op woordniveau. Tiny en Base geven de voorkeur aan snelheid, Small balanceert snelheid en kwaliteit, en Medium en Large geven de voorkeur aan kwaliteit.',
  'catalog.family.cohere_transcribe.summary':
    'Hoogwaardige batchtranscriptie met download- en geheugenvereisten van meerdere gigabytes.',
  'catalog.family.moonshine.summary':
    'Toont woorden terwijl u spreekt. Tiny is voorstander van een lager gebruik van hulpbronnen, Small is voorstander van een evenwicht tussen snelheid en kwaliteit, en Medium is voorstander van kwaliteit.',
  'catalog.family.nemotron_asr.summary':
    'Zeer nauwkeurige meertalige streaming met een grotere download en meer resourcegebruik. Moonshine Small blijft de aanbevolen standaard voor Engels live dicteren.',
  'setup.sidecar.modal.unsupportedPlatform':
    'Deze spraakengine-build is niet beschikbaar voor uw platform of architectuur.',
  'setup.sidecar.modal.genericInstallError':
    'De spraakengine kan niet worden geïnstalleerd. Controleer de plug-inlogboeken voor meer informatie en probeer het vervolgens opnieuw.',
  'commands.readAloud': 'Voorlezen',
  'commands.pauseResumeReadAloud': 'Voorlezen pauzeren of hervatten',
  'commands.stopReadAloud': 'Voorlezen stoppen',
  'settings.groups.readAloud': 'Voorlezen',
  'settings.model.noModelSelected': 'Geen model geselecteerd',
  'settings.model.speechToText': 'Spraak-naar-tekstmodel',
  'settings.model.textToSpeech': 'Tekst-naar-spraakmodel',
  'settings.readAloud.hotkey': 'Aanbevolen sneltoets',
  'settings.readAloud.hotkeyDesc':
    'Koppel een sneltoets aan Voorlezen. Geselecteerde tekst wordt voorgelezen, anders de hele notitie.',
  'settings.readAloud.voice': 'Stem',
  'settings.readAloud.voiceDesc':
    'Kies uit stemmen die voor het geselecteerde model zijn geïnstalleerd.',
  'settings.readAloud.noVoices': 'Geen geïnstalleerde stemmen',
  'settings.readAloud.speed': 'Voorleessnelheid',
  'settings.readAloud.speedDesc':
    'Als u de snelheid tijdens het voorlezen wijzigt, wordt de huidige zin opnieuw gestart.',
  'models.manage.dictationModels': 'Spraak naar tekst',
  'models.manage.readAloudModels': 'Tekst naar spraak',
  'models.manage.allLanguages': 'Alle talen',
  'models.manage.familiesLabel': 'Modelfamilies',
  'models.manage.noneForLanguage': 'Er zijn geen modellen voor deze taak en taal beschikbaar.',
  'models.manage.optionalVoice': 'Optionele lokale stem',
  'models.manage.voiceInstalled': 'Geïnstalleerd',
  'tts.status.reading': 'Bezig met voorlezen…',
  'tts.status.paused': 'Voorlezen gepauzeerd',
  'tts.control.model': 'Model: {model}',
  'tts.control.speed': 'Snelheid: {speed}',
  'tts.notice.noText': 'Hier staat geen tekst die kan worden voorgelezen.',
  'tts.notice.modelRequired': 'Installeer en selecteer eerst een voorleesmodel.',
  'tts.notice.voiceRequired': 'Selecteer eerst een geïnstalleerde stem.',
  'tts.notice.startFailed': 'Voorlezen kon niet worden gestart.',
  'tts.notice.playbackFailed': 'Afspelen van audio is mislukt.',
  'tts.notice.sidecarExited': 'Voorlezen is gestopt omdat de sidecar onverwacht is afgesloten.',
  'sidecarError.invalid_synthesis_request': 'Het voorleesverzoek is ongeldig.',
  'sidecarError.missing_voice_file': 'De geselecteerde voorleesstem is niet geïnstalleerd.',
  'sidecarError.sidecar_exited': 'Het sidecar-proces is onverwacht afgesloten.',
  'sidecarError.synthesis_cancelled': 'Voorlezen is geannuleerd.',
  'sidecarError.synthesis_failed': 'Lokale spraaksynthese is mislukt.',
  'sidecarError.synthesis_worker_unavailable':
    'De lokale spraaksyntheseworker is niet beschikbaar.',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Natuurlijk lokaal Engels voorlezen met een keuze uit samengestelde stemmen.',
  'catalog.family.pocket_tts.summary':
    'Leest notities lokaal voor in het Engels, Frans, Duits, Spaans, Portugees en Italiaans met selecteerbare stemmen en toonhoogtebehoudende snelheidsregeling.',
  'commands.translateNote': 'Notitie vertalen',
  'commands.translateSelection': 'Selectie vertalen',
  'models.manage.translationModels': 'Vertaling',
  'translation.modal.privacy': 'De vertaling wordt volledig op dit apparaat uitgevoerd.',
  'translation.modal.from': 'Van',
  'translation.modal.to': 'Naar',
  'translation.modal.swap': 'Wisselen',
  'translation.modal.largeNote': 'Grote notitie: vertalen kan enkele seconden duren.',
  'translation.modal.sourceSelection': 'Bronselectie',
  'translation.modal.sourceNote': 'Bronnotitie',
  'translation.modal.previewAria': 'Vertaalvoorbeeld',
  'translation.modal.preparing': 'Lokale vertaling voorbereiden…',
  'translation.modal.loading': 'Lokaal model laden…',
  'translation.modal.translating': 'Vertalen…',
  'translation.modal.translatingProgress': 'Vertalen… {completed}/{total}',
  'translation.modal.ready': 'Vertaling gereed.',
  'translation.modal.readyPartial_one':
    'Vertaling gereed. 1 blok is in de brontaal gebleven omdat de opmaak niet behouden kon blijven.',
  'translation.modal.readyPartial_other':
    'Vertaling gereed. {count} blokken zijn in de brontaal gebleven omdat de opmaak niet behouden kon blijven.',
  'translation.modal.canceled': 'Vertaling geannuleerd.',
  'translation.modal.failed': 'Vertalen mislukt.',
  'translation.modal.missingModel':
    'Installeer het lokale vertaalpakket om dit talenpaar te gebruiken.',
  'translation.modal.incompleteModel':
    'Er ontbreken bestanden in het vertaalmodel. Installeer het opnieuw om verder te gaan.',
  'translation.modal.installModel': 'Vertaalmodel installeren',
  'translation.modal.translateAgain': 'Opnieuw vertalen',
  'translation.modal.cancel': 'Annuleren',
  'translation.modal.replace': 'Vervangen',
  'translation.modal.insertBelow': 'Hieronder invoegen',
  'translation.modal.copy': 'Kopiëren',
  'translation.modal.stale':
    'De notitie is gewijzigd sinds deze vertaling begon. Kopieer in plaats daarvan de vertaling.',
  'translation.notice.copied': 'Vertaling gekopieerd.',
  'translation.notice.copyFailed': 'Kon de vertaling niet kopiëren.',
  'translation.notice.tooLong': 'Vertaal maximaal {count} tekens per keer.',
  'catalog.firefox_translations_release_2026_07.summary':
    'Snelle lokale vertaling tussen Engels en zeven talen met modellen die in Firefox zijn uitgebracht.',
  'catalog.family.firefox_translations.summary':
    'Vertaalt notitietekst lokaal met de compacte Bergamot-engine en Firefox-modellen.',
} as const satisfies TranslationCatalog;
