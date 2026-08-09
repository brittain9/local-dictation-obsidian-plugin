import type { TranslationCatalog } from '.';

export const hr = {
  'notice.dictationNotActive': 'Diktiranje trenutačno nije aktivno.',
  'notice.dictationStartFailed': 'Nije moguće pokrenuti diktiranje.',
  'notice.dictationStopFailed': 'Nije moguće zaustaviti diktiranje.',
  'notice.finalizedUtteranceAutoCopyFailed': 'Nije moguće automatski kopirati dovršeni iskaz.',
  'notice.lastUtteranceCleared': 'Zadnji zadržani iskaz je obrisan.',
  'notice.lastUtteranceReinsertFailed': 'Nije moguće ponovno umetnuti zadnji dovršeni iskaz.',
  'notice.lastUtteranceReinserted': 'Zadnji dovršeni iskaz je ponovno umetnut.',
  'notice.lastUtteranceUnavailable': 'Nema dovršenog iskaza za ponovno umetanje.',
  'notice.llmTransformEmpty': 'LLM transformacija nije vratila ništa za dodavanje.',
  'notice.microphoneDisconnected':
    'Mikrofon je odspojen. Diktiranje je zaustavljeno i dovršit će obradu već snimljenog zvuka. Ponovno spojite mikrofon, zatim opet pokrenite diktiranje.',
  'notice.rawTranscriptChanged':
    'Nije moguće vratiti izvorni transkript jer se bilješka promijenila nakon čišćenja.',
  'notice.rawTranscriptCleared': 'Oporavak izvornog transkripta je obrisan.',
  'notice.rawTranscriptCopied': 'Izvorni transkript je kopiran.',
  'notice.rawTranscriptCopyFailed': 'Nije moguće kopirati izvorni transkript.',
  'notice.rawTranscriptRestored': 'Izvorni transkript je vraćen.',
  'notice.rawTranscriptRestoreFailed': 'Nije moguće vratiti izvorni transkript.',
  'notice.rawTranscriptTargetUnavailable':
    'Nije moguće vratiti izvorni transkript jer njegova izvorna bilješka više nije otvorena u istom uređivaču.',
  'notice.rawTranscriptUnavailable': 'Nema dostupnog oporavka izvornog transkripta.',
  'notice.sidecarHealthCheckFailed': 'Provjera stanja sidecara nije uspjela',
  'notice.sidecarReady': 'Sidecar je spreman ({version}).',
  'notice.sidecarRestarted': 'Sidecar je ponovno pokrenut ({version}).',
  'notice.sidecarRestartFailed': 'Ponovno pokretanje sidecara nije uspjelo',
  'notice.sidecarRestartRequiresIdle':
    'Ponovno pokrenite sidecar samo kada diktiranje i čitanje miruju.',
  'notice.sidecarMaintenanceInProgress':
    'Govorni modul se instalira ili ponovno pokreće. Pričekajte da završi, zatim pokušajte ponovno.',
  'notice.transcriptRecordFailed': 'Nije moguće zabilježiti transkript.',
  'notice.sidecarSessionError': 'Govorni modul je prijavio pogrešku.',
  'notice.sidecarVersionDrift.actionMultiple': 'Ažuriraj govorne module',
  'notice.sidecarVersionDrift.actionOne': 'Ažuriraj govorni modul',
  'notice.sidecarVersionDrift.cpu':
    'Ažurirano na {version}, ali instalirani govorni modul je zastario. Ažurirajte ga sada kako bi verzije ostale usklađene.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Ažurirano na {version}, ali instalirani CPU i CUDA govorni moduli su zastarjeli. Ažurirajte ih sada kako bi verzije ostale usklađene.',
  'notice.sidecarVersionDrift.cuda':
    'Ažurirano na {version}, ali instalirani CUDA govorni modul je zastario. Ažurirajte ga sada kako bi verzije ostale usklađene.',
  'notice.surfaceDesynchronized':
    'Diktiranje je zaustavljeno jer se bilješka promijenila na način koji Speech Kit nije mogao sigurno pratiti. Ponovno pokrenite diktiranje za nastavak.',
  'notice.targetNoteClosed':
    'Diktiranje je zaustavljeno jer je odredišna bilješka zatvorena ili zamijenjena. Ponovno pokrenite diktiranje za nastavak.',
  'notice.targetNoteDeleted':
    'Diktiranje je zaustavljeno jer je odredišna bilješka izbrisana. Vratite ili ponovno stvorite bilješku, zatim opet pokrenite diktiranje.',
  'notice.transcriptWriteFailed':
    'Diktiranje je zaustavljeno jer Speech Kit nije mogao sigurno pisati u bilješku. Ponovno pokrenite diktiranje za nastavak.',
  'setup.sidecar.cpu.firstRun.body':
    'Speech Kit mora jednokratno preuzeti CPU modul za pretvorbu govora u tekst iz GitHub izdanja. Nakon toga transkripcija se izvodi lokalno na vašem računalu. CUDA ubrzanje možete instalirati kasnije u postavkama.',
  'setup.sidecar.cpu.firstRun.primaryButton': 'Preuzmi CPU sidecar',
  'setup.sidecar.cpu.firstRun.success': 'Speech Kit sidecar je instaliran i pokrenut.',
  'setup.sidecar.cpu.firstRun.title': 'Dovršetak postavljanja Speech Kita',
  'setup.sidecar.cpu.install.body':
    'Preuzmite CPU modul za pretvorbu govora u tekst iz GitHub izdanja. Nakon toga transkripcija se izvodi lokalno na vašem računalu.',
  'setup.sidecar.cpu.install.primaryButton': 'Preuzmi CPU sidecar',
  'setup.sidecar.cpu.install.success': 'CPU sidecar je instaliran i pokrenut.',
  'setup.sidecar.cpu.install.title': 'Instalacija CPU sidecara',
  'setup.sidecar.cpu.reinstall.body':
    'Ponovno preuzmite CPU modul za pretvorbu govora u tekst iz GitHub izdanja. Time se zamjenjuje trenutačna CPU instalacija.',
  'setup.sidecar.cpu.reinstall.primaryButton': 'Ponovno preuzmi CPU sidecar',
  'setup.sidecar.cpu.reinstall.success': 'CPU sidecar je ponovno instaliran i pokrenut.',
  'setup.sidecar.cpu.reinstall.title': 'Ponovna instalacija CPU sidecara',
  'setup.sidecar.cuda.install.body':
    'Preuzmite CUDA sidecar za ubrzavanje Whisper modela na podržanom NVIDIA GPU-u. Dok je aktivan, zamjenjuje CPU sidecar; CPU sidecar ostaje instaliran kao rezerva.',
  'setup.sidecar.cuda.install.primaryButton': 'Preuzmi CUDA sidecar',
  'setup.sidecar.cuda.install.success': 'CUDA sidecar je instaliran i pokrenut.',
  'setup.sidecar.cuda.install.title': 'Instalacija CUDA ubrzanja',
  'setup.sidecar.mac.firstRun.body':
    'Speech Kit mora jednokratno preuzeti svoj modul za pretvorbu govora u tekst iz GitHub izdanja. Nakon instalacije transkripcija se u cijelosti izvodi na vašem Macu — zvuk nikada ne napušta vaše računalo.',
  'setup.sidecar.mac.firstRun.primaryButton': 'Preuzmi sidecar',
  'setup.sidecar.mac.firstRun.success': 'Speech Kit sidecar je instaliran i pokrenut.',
  'setup.sidecar.mac.firstRun.title': 'Dovršetak postavljanja Speech Kita',
  'setup.sidecar.mac.install.body':
    'Preuzmite modul za pretvorbu govora u tekst iz GitHub izdanja. Nakon toga transkripcija se izvodi lokalno na vašem Macu.',
  'setup.sidecar.mac.install.primaryButton': 'Preuzmi sidecar',
  'setup.sidecar.mac.install.success': 'Sidecar je instaliran i pokrenut.',
  'setup.sidecar.mac.install.title': 'Instalacija sidecara',
  'setup.sidecar.mac.reinstall.body':
    'Ponovno preuzmite modul za pretvorbu govora u tekst iz GitHub izdanja. Time se zamjenjuje trenutačna instalacija.',
  'setup.sidecar.mac.reinstall.primaryButton': 'Ponovno preuzmi sidecar',
  'setup.sidecar.mac.reinstall.success': 'Sidecar je ponovno instaliran i pokrenut.',
  'setup.sidecar.mac.reinstall.title': 'Ponovna instalacija sidecara',
  'setup.sidecar.update.body':
    '{engineLabel}: preuzima se aktualna verzija usklađena s ovom verzijom Speech Kita. Postojeća se instalacija pritom zamjenjuje.',
  'setup.sidecar.update.engine.cpuAndCuda': 'CPU i CUDA govorni moduli',
  'setup.sidecar.update.engine.cuda': 'CUDA govorni modul',
  'setup.sidecar.update.engine.default': 'govorni modul',
  'setup.sidecar.update.primaryButton_one': 'Ažuriraj govorni modul',
  'setup.sidecar.update.primaryButton_other': 'Ažuriraj govorne module',
  'setup.sidecar.update.success_one': 'Govorni modul Speech Kita je ažuriran i ponovno pokrenut.',
  'setup.sidecar.update.success_other':
    'Govorni moduli Speech Kita su ažurirani i ponovno pokrenuti.',
  'setup.sidecar.update.title_one': 'Ažuriranje govornog modula',
  'setup.sidecar.update.title_other': 'Ažuriranje govornih modula',
  'audio.microphone.permissionDeniedMac':
    'Pristup mikrofonu je odbijen. Otvorite Postavke sustava → Privatnost i sigurnost → Mikrofon, omogućite Obsidian, zatim ponovno pokrenite Obsidian i pokušajte opet.',
  'audio.microphone.permissionDenied':
    'Pristup mikrofonu je odbijen. Dopustite pristup u postavkama operacijskog sustava i pokušajte ponovno.',
  'audio.microphone.notFound':
    'Nije otkriven nijedan mikrofon. Priključite mikrofon ili slušalice s mikrofonom ili omogućite ulazni uređaj u postavkama zvuka operacijskog sustava, zatim pokušajte ponovno.',
  'audio.microphone.notReadable':
    'Nije moguće otvoriti mikrofon. Možda ga koristi druga aplikacija ili je došlo do pogreške na audiouređaju. Zatvorite ostale aplikacije koje koriste mikrofon i pokušajte ponovno.',
  'audio.systemAudio.notReady': 'Zvuk sustava nije spreman.',
  'audio.systemAudio.outdatedInstaller':
    '{message} Vaša je instalacija Obsidiana starija od macOS dopuštenja za snimanje zvuka sustava. Preuzmite novi instalacijski program s obsidian.md i ponovno instalirajte Obsidian, zatim pokušajte ponovno.',
  'commands.toggleDictation': 'Uključi ili isključi diktiranje',
  'commands.startDictation': 'Pokreni diktiranje',
  'commands.stopDictation': 'Zaustavi diktiranje',
  'commands.cancelDictation': 'Odustani od diktiranja',
  'commands.reinsertLastUtterance': 'Ponovno umetni zadnji iskaz',
  'commands.clearLastUtterance': 'Obriši zadnji iskaz',
  'commands.restoreRawTranscript': 'Vrati izvorni transkript',
  'commands.copyRawTranscript': 'Kopiraj izvorni transkript',
  'commands.clearRawRecovery': 'Obriši oporavak izvornog transkripta',
  'commands.checkSidecarHealth': 'Provjeri stanje sidecara',
  'commands.restartSidecar': 'Ponovno pokreni sidecar',
  'commands.readAloud': 'Čitaj naglas',
  'commands.pauseResumeReadAloud': 'Pauziraj ili nastavi čitanje',
  'commands.stopReadAloud': 'Zaustavi čitanje',
  'commands.translateCurrentParagraph': 'Prevedi trenutačni odlomak',
  'commands.translateNote': 'Prevedi bilješku',
  'commands.translateSelection': 'Prevedi odabir',
  'translation.modal.titleWithPair': 'Prijevod: {source} → {target}',
  'translation.modal.privacy': 'Prijevod se u cijelosti izvodi na ovom uređaju.',
  'translation.modal.from': 'S jezika',
  'translation.modal.to': 'Na jezik',
  'translation.modal.swap': 'Zamijeni jezike',
  'translation.modal.largeNote': 'Velika bilješka: prijevod može potrajati nekoliko sekundi.',
  'translation.modal.sourceSelection': 'Odabrani tekst',
  'translation.modal.sourceNote': 'Izvorna bilješka',
  'translation.modal.sourceParagraph': 'Izvorni odlomak',
  'translation.modal.previewAria': 'Pregled prijevoda',
  'translation.modal.preparing': 'Priprema lokalnog prijevoda…',
  'translation.modal.loading': 'Učitavanje lokalnog modela…',
  'translation.modal.translating': 'Prevođenje…',
  'translation.modal.translatingProgress': 'Prevođenje… {completed}/{total}',
  'translation.modal.ready': 'Prijevod je spreman.',
  'translation.modal.readyPartial_one':
    'Prijevod je spreman. 1 blok zadržao je izvorni jezik jer se njegovo oblikovanje nije moglo sačuvati.',
  'translation.modal.readyPartial_other':
    'Prijevod je spreman. Broj blokova koji su zadržali izvorni jezik jer se njihovo oblikovanje nije moglo sačuvati: {count}.',
  'translation.modal.canceled': 'Prijevod je otkazan.',
  'translation.modal.failed': 'Prijevod nije uspio.',
  'translation.modal.missingModel':
    'Instalirajte paket za lokalni prijevod da biste koristili ovaj par jezika.',
  'translation.modal.incompleteModel':
    'Modelu za prijevod nedostaju datoteke. Ponovno ga instalirajte za nastavak.',
  'translation.modal.installModel': 'Instaliraj model za prijevod',
  'translation.modal.translateAgain': 'Prevedi ponovno',
  'translation.modal.cancel': 'Odustani',
  'translation.modal.replace': 'Zamijeni',
  'translation.modal.insertBelow': 'Umetni ispod',
  'translation.modal.copy': 'Kopiraj',
  'translation.modal.createNote': 'Izradi bilješku',
  'translation.modal.creatingNote': 'Izrada bilješke…',
  'translation.modal.stale':
    'Bilješka se promijenila otkako je prijevod započeo. Umjesto zamjene kopirajte prijevod ili izradite novu bilješku.',
  'translation.notice.copied': 'Prijevod je kopiran.',
  'translation.notice.copyFailed': 'Nije moguće kopirati prijevod.',
  'translation.notice.noteCreated': 'Bilješka {note} je izrađena i otvorena.',
  'translation.notice.noteCreatedOpenFailed':
    'Bilješka {note} je izrađena, ali se nije mogla otvoriti.',
  'translation.notice.noteCreateFailed': 'Prevedena bilješka nije se mogla izraditi.',
  'translation.notice.tooLong': 'Najveći broj znakova koji se može prevesti odjednom: {count}.',
  'translation.notice.noText': 'U ovoj bilješci nema teksta za prijevod.',
  'translation.notice.noParagraph': 'Postavite pokazivač u odlomak koji želite prevesti.',
  'common.reset': 'Vrati zadano',
  'settings.acceleration.active': 'Konfigurirano ubrzanje: {accelerator}',
  'settings.acceleration.pending': 'na čekanju (sidecar nije spreman)',
  'settings.acceleration.unavailable': 'CPU ({accelerator}: nedostupno)',
  'settings.acceleration.unknownReason': 'nepoznat razlog',
  'settings.dictationLanguage.autoDetect': 'Automatsko prepoznavanje',
  'settings.dictationLanguage.name': 'Jezik diktiranja',
  'settings.dictationLanguage.englishOnlyDesc': 'Odabrani model, {model}, podržava samo engleski.',
  'settings.dictationLanguage.desc':
    'Odaberite jezik kojim ćete govoriti. Ručni odabir daje najpredvidljivije čišćenje teksta. Automatsko prepoznavanje može se sporije pokrenuti i bira jedan jezik po iskazu.',
  'settings.dictationLanguage.unsupported': '{language} (nije podržan)',
  'settings.dictationLanguage.noReadAloud': 'Čitanje naglas još ne pokriva jezik {language}.',
  'settings.dictationLanguage.noTranslation': 'Lokalni prijevod još ne pokriva jezik {language}.',
  'settings.engine.named': 'Modul {engine}',
  'settings.groups.model': 'Modeli',
  'settings.groups.readAloud': 'Čitanje naglas',
  'settings.groups.translation': 'Prijevod',
  'settings.groups.capture': 'Snimanje',
  'settings.groups.transcriptOutput': 'Ispis transkripta',
  'settings.groups.llmTransformation': 'LLM transformacija',
  'settings.groups.engine': 'Govorni modul',
  'settings.groups.advanced': 'Napredno',
  'settings.readAloud.hotkey': 'Preporučeni tipkovni prečac',
  'settings.readAloud.hotkeyDesc':
    'Dodijelite tipkovni prečac naredbi „Speech Kit: Čitaj naglas”. Čita odabrani tekst ili cijelu bilješku ako ništa nije odabrano.',
  'settings.readAloud.voice': 'Glas',
  'settings.readAloud.voiceDesc': 'Odaberite među glasovima instaliranima za odabrani model.',
  'settings.readAloud.noVoices': 'Nema instaliranih glasova',
  'settings.readAloud.speed': 'Brzina čitanja',
  'settings.readAloud.speedDesc':
    'Promjena brzine tijekom čitanja ponovno pokreće čitanje od trenutačne rečenice.',
  'settings.translation.model.name': 'Model za prijevod',
  'settings.translation.model.installedDesc': '{model} · Instaliran · {size}',
  'settings.translation.model.availableDesc': '{model} · Nije instaliran · {size}',
  'settings.translation.model.unavailable': 'Nije dostupan nijedan model za prijevod.',
  'settings.translation.model.download': 'Preuzmi model za prijevod',
  'settings.translation.model.manage': 'Upravljaj modelima za prijevod',
  'settings.translation.source.name': 'Zadani izvorni jezik',
  'settings.translation.source.desc':
    'Unaprijed odabran kada prevodite bilješku ili odabir. Možete ga promijeniti prije prevođenja.',
  'settings.translation.target.name': 'Zadani ciljni jezik',
  'settings.translation.target.desc':
    'Jezik na koji Speech Kit prevodi prema zadanim postavkama. Svaki pregled prijevoda prikazuje aktivni par jezika.',
  'models.manage.dictationModels': 'Govor u tekst',
  'models.manage.readAloudModels': 'Tekst u govor',
  'models.manage.translationModels': 'Prijevod',
  'models.manage.allLanguages': 'Svi jezici',
  'models.manage.familiesLabel': 'Obitelji modela',
  'models.manage.noneForLanguage': 'Nema dostupnih modela za ovaj zadatak i jezik.',
  'models.manage.installAllVoices': 'Instaliraj sve glasove',
  'models.manage.installAllVoicesDesc':
    'Instalirajte preostale dodatne glasove za ovaj model (ukupno {count}).',
  'models.manage.optionalVoice': 'Dodatni lokalni glas',
  'models.manage.voiceInstalled': 'Instalirano',
  'models.manage.taskLabel': 'Zadatak modela',
  'models.manage.searchPlaceholder': 'Pretraži modele ({task})',
  'models.manage.languagesLabel': 'Jezici',
  'models.manage.manageVoices': 'Upravljanje glasovima',
  'models.manage.performanceWarning':
    'Pri većim brzinama čitanja može doći do zastajkivanja na sporijim procesorima.',
  'models.manage.installWarningTitle': 'Želite li instalirati model koji troši puno resursa?',
  'models.manage.installWarningMessage':
    '{model} preuzima približno {size} i znatno više opterećuje CPU. Pri većim brzinama čitanja može doći do zastajkivanja.',
  'models.tag.highCpu': 'Zahtjevno za CPU',
  'models.tag.mayBuffer': 'Moguće zastajkivanje',
  'tts.status.reading': 'Čitanje…',
  'tts.status.paused': 'Čitanje je pauzirano',
  'tts.control.model': 'Model: {model}',
  'tts.control.speed': 'Brzina: {speed}',
  'tts.control.voice': 'Glas: {voice}',
  'tts.control.pause': 'Pauziraj čitanje',
  'tts.control.resume': 'Nastavi čitanje',
  'tts.control.stop': 'Zaustavi čitanje',
  'tts.action.chooseModel': 'Odaberi model',
  'tts.notice.noText': 'Ovdje nema teksta za čitanje naglas.',
  'tts.notice.modelRequired': 'Najprije instalirajte i odaberite model za čitanje naglas.',
  'tts.notice.voiceRequired': 'Najprije odaberite instalirani glas.',
  'tts.notice.languageUnsupported':
    'Odabrani model za čitanje naglas ne podržava jezik {language}.',
  'tts.notice.startFailed': 'Nije moguće pokrenuti čitanje.',
  'tts.notice.playbackFailed': 'Reprodukcija zvuka nije uspjela.',
  'tts.notice.sidecarExited': 'Čitanje je zaustavljeno jer se sidecar neočekivano zatvorio.',
  'settings.listeningMode.alwaysOn': 'Uvijek uključeno',
  'settings.listeningMode.oneSentence': 'Jedna rečenica',
  'settings.listeningMode.name': 'Način slušanja',
  'settings.listeningMode.desc': 'Neprekidno slušanje ili zaustavljanje nakon jedne rečenice.',
  'settings.autoCopyFinalizedUtterances.name': 'Automatsko kopiranje dovršenih iskaza',
  'settings.autoCopyFinalizedUtterances.desc':
    'Svaka dovršena fraza zamjenjuje sadržaj međuspremnika sustava.',
  'settings.insertText.atCursor': 'Na mjestu kursora',
  'settings.insertText.endOfNote': 'Na kraju bilješke',
  'settings.insertText.name': 'Umetanje teksta',
  'settings.insertText.desc': 'Gdje se pojavljuje diktirani tekst.',
  'settings.transcriptFormatting.smartParagraphs': 'Pametni odlomci',
  'settings.transcriptFormatting.space': 'Razmak',
  'settings.transcriptFormatting.newLine': 'Novi redak',
  'settings.transcriptFormatting.newParagraph': 'Novi odlomak',
  'settings.transcriptFormatting.name': 'Oblikovanje transkripta',
  'settings.transcriptFormatting.desc': 'Način spajanja fraza.',
  'settings.phraseFinalization.responsiveOption': 'Brzo — kratke stanke',
  'settings.phraseFinalization.balancedOption': 'Uravnoteženo — standardno',
  'settings.phraseFinalization.patientOption': 'Strpljivo — duge stanke',
  'settings.phraseFinalization.name': 'Dovršavanje fraza',
  'settings.phraseFinalization.responsive':
    'Dovršava fraze nakon kraćih stanki pa gotov tekst dobivate brže.',
  'settings.phraseFinalization.balanced':
    'Koristi standardnu toleranciju stanki za svakodnevno diktiranje.',
  'settings.phraseFinalization.patient':
    'Čeka i tijekom duljih stanki pa je manje vjerojatno da će misao biti prekinuta.',
  'settings.phraseFinalization.tooltip':
    'Vrijedi za svaki model transkripcije. Riječi prikazane uživo mogu se i dalje mijenjati dok fraza ne postane konačna. Ovo mijenja granice govorne aktivnosti, a ne stil pisanja ni točnost modela. Brzo daje prednost brzini, a Strpljivo dopušta dulje stanke unutar jedne fraze.',
  'settings.systemAudio.name': 'Snimanje i zvuka sustava',
  'settings.systemAudio.desc':
    'Uz mikrofon snima i zadani izlaz zvuka ovog računala — za sastanke, pozive i videozapise.',
  'settings.systemAudio.ready': 'Zvuk sustava je spreman.',
  'settings.systemAudio.testFailed':
    'Testiranje zvuka sustava nije uspjelo. Provjerite je li govorni modul instaliran i pokušajte ponovno.',
  'settings.speakerLabels.name': 'Oznake govornika',
  'settings.speakerLabels.desc': 'Označava svaku frazu prema govorniku.',
  'settings.speakerLabels.streamingLimitation':
    'Oznake govornika zahtijevaju skupni model (bez streaminga).',
  'settings.speakerLabels.modal.title': 'Postavke oznaka govornika',
  'settings.speakerLabels.modal.intro':
    'Oznake govornika obrađuju se lokalno na uređaju nakon svake fraze prepoznate detekcijom govora. Zahtijevaju model za skupnu transkripciju.',
  'settings.speakerLabels.maximumSpeakers.name': 'Najveći broj govornika',
  'settings.speakerLabels.maximumSpeakers.desc':
    'Uz Automatski se broj govornika određuje sam. Ograničenje postavite samo ako se pojavljuju suvišne oznake govornika.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Uključite oznake govornika prije postavljanja ograničenja broja govornika.',
  'settings.speakerLabels.automatic': 'Automatski',
  'settings.timestamps.enable.name': 'Upotreba vremenskih oznaka',
  'settings.timestamps.enable.desc':
    'Dodaje vremenske oznake kao orijentire u diktirane transkripte.',
  'settings.timestamps.modal.title': 'Postavke vremenskih oznaka',
  'settings.timestamps.modal.intro':
    'Odaberite orijentire u postavljenim razmacima, na granicama fraza ili na prijelomima Pametnih odlomaka.',
  'settings.timestamps.clock.elapsed': 'Proteklo vrijeme',
  'settings.timestamps.clock.wallClock': 'Točno vrijeme',
  'settings.timestamps.frequency.atIntervals': 'U razmacima',
  'settings.timestamps.frequency.everyPhrase': 'Svaka fraza',
  'settings.timestamps.frequency.atParagraphBreaks': 'Na prijelomima odlomaka',
  'settings.timestamps.sessionHeader.name': 'Zaglavlje sesije',
  'settings.timestamps.sessionHeader.desc':
    'Svaku sesiju s vremenskim oznakama započinje zaglavljem [YYYY-MM-DD HH:MM].',
  'settings.timestamps.referenceClock.name': 'Referentno vrijeme',
  'settings.timestamps.referenceClock.desc':
    'Vrijeme proteklo od početka diktiranja ili lokalno točno vrijeme.',
  'settings.timestamps.frequency.name': 'Učestalost',
  'settings.timestamps.frequency.desc': 'Odaberite koliko se često umeću vremenske oznake.',
  'settings.timestamps.frequency.sparseDesc': 'Dodaje pregledne orijentire u postavljenom razmaku.',
  'settings.timestamps.frequency.everyPhraseDesc':
    'Dodaje vremensku oznaku ispred svakog segmenta koji je model vremenski označio, a inače ispred svake fraze prepoznate detekcijom govora.',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    'Za prijelome odlomaka postavite Oblikovanje transkripta na Pametne odlomke.',
  'settings.timestamps.frequency.paragraphDesc':
    'Dodaje vremensku oznaku na početku sesije i na svakom prijelomu Pametnog odlomka.',
  'settings.timestamps.interval.name': 'Razmak',
  'settings.timestamps.interval.desc': 'Broj sekundi između vremenskih oznaka ({min}-{max}).',
  'settings.timestamps.interval.inactiveDesc':
    'Koristi se samo kada je učestalost postavljena na U razmacima.',
  'settings.timestamps.interval.validation': 'Unesite cijeli broj od {min} do {max} sekundi.',
  'settings.smartParagraph.modal.title': 'Postavke Pametnih odlomaka',
  'settings.smartParagraph.modal.intro':
    'Pametni odlomci dulje stanke pretvaraju u prijelome retka ili odlomka. Ove vrijednosti vrijede samo kada je oblikovanje transkripta postavljeno na Pametne odlomke.',
  'settings.smartParagraph.lineBreakPause.name': 'Stanka za prijelom retka',
  'settings.smartParagraph.lineBreakPause.desc':
    'Broj sekundi prije jednostrukog prijeloma retka ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Stanka za prijelom odlomka',
  'settings.smartParagraph.paragraphPause.desc':
    'Broj sekundi prije prijeloma odlomka ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Uključivanje LLM značajki',
  'settings.llm.enableFeatures.desc':
    'Čini LLM transformacije dostupnima. Transformaciju uključite ili isključite u bočnoj traci.',
  'settings.llm.restoreDefaults.name': 'Vraćanje zadanih postavki transformacije',
  'settings.llm.restoreDefaults.desc':
    'Vraća predložak, vrijeme izvođenja, kontekst, najmanji broj riječi i temperaturu na zadane vrijednosti. Spremljeni predlošci i modeli ostaju sačuvani.',
  'settings.llm.restoreDefaults.button': 'Vrati',
  'settings.llm.restoreDefaults.confirmMessage':
    'Želite li vratiti zadani predložak, vrijeme izvođenja, kontekst, najmanji broj riječi i temperaturu? Spremljeni predlošci i modeli ostaju sačuvani.',
  'settings.llm.migratedPreset': 'Moj predložak',
  'settings.llm.migratedPresetNumbered': 'Moj predložak {number}',
  'settings.recoveryMemory.name': 'Čuvanje teksta za oporavak u memoriji',
  'settings.recoveryMemory.desc':
    'U memoriji čuva najnoviji tekst za oporavak i snimku bilješke. Ništa se ne zapisuje na disk.',
  'settings.modelStoreOverride.name': 'Zamjenska mapa za pohranu modela',
  'settings.modelStoreOverride.desc': 'Prilagođena mapa u koju dodatak preuzima modele.',
  'settings.modelStoreOverride.placeholder': 'Koristi zajedničku zadanu pohranu modela',
  'settings.runSetup.name': 'Pokretanje postavljanja',
  'settings.runSetup.desc': 'Ponovno pokreće čarobnjak za početno postavljanje.',
  'settings.hardwareAcceleration.name': 'Hardversko ubrzanje',
  'settings.hardwareAcceleration.desc': 'Izvodi inferenciju na GPU-u kada je dostupan.',
  'settings.hardwareAcceleration.busy':
    'Hardversko ubrzanje nije moguće promijeniti dok je aktivno diktiranje ili čitanje naglas. Ako se diktiranje nastavi obrađivati nakon što ga zaustavite, pokrenite „Odustani od diktiranja”.',
  'settings.hardwareAcceleration.on': 'Hardversko ubrzanje je uključeno.',
  'settings.hardwareAcceleration.off': 'Hardversko ubrzanje je isključeno.',
  'settings.hardwareAcceleration.saveFailed':
    'Postavku hardverskog ubrzanja nije moguće spremiti. Prethodna postavka i dalje je aktivna.',
  'settings.hardwareAcceleration.restartFailedRolledBack':
    'Govorni modul se nije mogao ponovno pokrenuti s tom postavkom. Vraćena je prethodna postavka.',
  'settings.hardwareAcceleration.rollbackSaveFailed':
    'Govorni modul se nije mogao ponovno pokrenuti, a prethodnu postavku hardverskog ubrzanja nije moguće vratiti. Ponovno pokrenite Obsidian prije novog pokušaja.',
  'settings.hardwareAcceleration.rollbackRestartFailed':
    'Prethodna postavka hardverskog ubrzanja je vraćena, ali se govorni modul nije mogao ponovno pokrenuti. Ponovno pokrenite Obsidian prije diktiranja.',
  'settings.noteContext.name': 'Bilješka kao kontekst',
  'settings.noteContext.desc':
    'Kada je engleski odabran ručno, šalje specifične pojmove iz otvorene bilješke radi točnijeg zapisivanja.',
  'settings.noteContext.tooltip':
    'Šalje pojmovnik vlastitih imena i tehničkih pojmova kao početni upit modulu. Koristi se samo za ručno odabrani engleski, uz module koji podržavaju početne upite.',
  'settings.microphone.name': 'Mikrofon',
  'settings.microphone.desc':
    'Mikrofon koji se koristi za diktiranje. Promjene se primjenjuju na sljedeću sesiju diktiranja.',
  'settings.microphone.default': 'Zadani mikrofon',
  'settings.microphone.labelUnavailable': 'Mikrofon (naziv nije dostupan)',
  'settings.microphone.notConnected': '{microphone} (nije povezan)',
  'settings.microphone.detectTooltip': 'Otkrij mikrofone (traži dopuštenje)',
  'settings.microphone.allowAccessFirst':
    'Najprije dopustite pristup mikrofonu da biste spremili ovaj uređaj.',
  'settings.microphone.stopDictationToDetect': 'Zaustavite diktiranje da biste otkrili mikrofone.',
  'settings.microphone.unavailableRuntime': 'Pristup mikrofonu nije dostupan u ovom okruženju.',
  'settings.microphone.detectFailed':
    'Mikrofone nije moguće otkriti. Provjerite postavke zvuka u sustavu.',
  'settings.microphone.fallbackSaveFailed':
    'Spremljeni mikrofon nije dostupan. Koristi se zadani mikrofon, ali ovu promjenu nije moguće spremiti. U postavkama odaberite dostupan mikrofon prije ponovnog pokretanja Obsidiana.',
  'settings.microphone.fallbackUnchanged':
    'Spremljeni mikrofon nije dostupan. Za ovu sesiju koristi se zadani mikrofon; trenutačna postavka mikrofona ostala je nepromijenjena.',
  'settings.microphone.fallbackCleared':
    'Spremljeni mikrofon nije dostupan. Koristi se zadani mikrofon; spremljeni odabir obrisan je za buduće sesije.',
  'settings.model.notInstalled': 'Nije instalirano',
  'settings.model.validatedExternal': 'Provjeren · vanjski',
  'settings.model.external': 'Vanjski',
  'settings.model.checking': 'Provjera…',
  'settings.model.unavailable': 'Nedostupno',
  'settings.model.noModel': 'Nema modela',
  'settings.model.noModelSelected': 'Nijedan model nije odabran',
  'settings.model.speechToText': 'Model za pretvorbu govora u tekst',
  'settings.model.textToSpeech': 'Model za pretvorbu teksta u govor',
  'settings.model.streaming': 'Streaming',
  'settings.model.manageModels': 'Upravljaj modelima',
  'settings.model.useExternalFile': 'Upotrijebi vanjsku datoteku',
  'settings.model.details': 'Pojedinosti o modelu',
  'settings.install.installingNamed': 'Instalacija: {name}',
  'settings.install.installingSidecar': 'Instalacija: {variant} sidecar',
  'settings.install.installingSidecarMac': 'Instalacija: sidecar',
  'settings.install.cancelling': 'Otkazivanje...',
  'settings.install.cancel': 'Odustani',
  'settings.attention.regionLabel': 'Potrebna pozornost',
  'settings.attention.installCuda.name': 'CUDA ubrzanje je dostupno',
  'settings.attention.installCuda.desc':
    'Otkriveni su kompatibilni NVIDIA GPU i upravljački program. Instalirajte CUDA govorni modul za ubrzanje Whisper modela.',
  'settings.attention.installCuda.action': 'Instaliraj CUDA ubrzanje',
  'settings.attention.enableCuda.name': 'Uključivanje CUDA ubrzanja',
  'settings.attention.enableCuda.desc':
    'CUDA govorni modul je instaliran i ažuran, ali je hardversko ubrzanje isključeno.',
  'settings.attention.enableCuda.action': 'Uključi',
  'settings.missingSidecar.name': 'Postavljanje Speech Kita',
  'settings.missingSidecar.desc':
    'Speech Kit još nije spreman. Pokrenite čarobnjak za postavljanje kako biste instalirali govorni modul i model.',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': '{variant} sidecar',
  'settings.sidecar.desc': 'Modul za pretvorbu govora u tekst.',
  'settings.sidecar.cpuName': 'CPU sidecar',
  'settings.sidecar.cpuDesc': 'Modul za pretvorbu govora u tekst. Obavezan.',
  'settings.sidecar.gpuName': 'GPU sidecar',
  'settings.sidecar.cudaLibraryPath.name': 'Putanja do CUDA biblioteka',
  'settings.sidecar.cudaLibraryPath.desc':
    'Neobavezna putanja u kojoj sidecar traži biblioteke (Flatpak, prilagođene CUDA instalacije).',
  'settings.sidecar.installAnyway': 'Ipak instaliraj',
  'settings.sidecar.installUnverifiedTooltip':
    'Nastavi s CUDA instalacijom iako kompatibilnost nije potvrđena.',
  'settings.sidecar.cudaCompatibility.compatible':
    'Otkriveno je kompatibilno NVIDIA CUDA okruženje. CUDA sidecar može ubrzati Whisper modele.',
  'settings.sidecar.cudaCompatibility.incompatibleDriver':
    'NVIDIA upravljački program je prestar. Ažurirajte ga na R{minimumDriverMajor} ili noviji kako biste koristili objavljeni CUDA sidecar.',
  'settings.sidecar.cudaCompatibility.incompatibleGpu':
    'NVIDIA GPU mora imati compute capability {minimumComputeCapability} ili više za objavljeni CUDA sidecar.',
  'settings.sidecar.cudaCompatibility.absent':
    'NVIDIA upravljački program nije otkriven. CUDA sidecar zahtijeva kompatibilan NVIDIA GPU i upravljački program.',
  'settings.sidecar.cudaCompatibility.unknown':
    'CUDA kompatibilnost nije moguće potvrditi. Provjerite NVIDIA upravljački program i GPU prije instalacije.',
  'settings.sidecar.cudaCompatibility.unsupported':
    'Izdanja CUDA sidecara dostupna su samo za Windows i Linux x64.',
  'settings.sidecar.stopBeforeInstall':
    'Zaustavite diktiranje ili čitanje naglas prije instalacije sidecara — instalacija ponovno pokreće modul. Ako se diktiranje još obrađuje, pokrenite „Odustani od diktiranja” da biste ga odmah zaustavili.',
  'settings.sidecar.stopBeforeUninstall':
    'Prije nego što deinstalirate {sidecar}, zaustavite diktiranje ili čitanje naglas. Ako se diktiranje još obrađuje, pokrenite „Odustani od diktiranja” da biste ga odmah zaustavili.',
  'settings.sidecar.operationInProgress':
    'U tijeku je druga operacija održavanja govornog modula. Pričekajte da završi pa pokušajte ponovno.',
  'settings.sidecar.uninstallFailed':
    '{sidecar} nije moguće deinstalirati. Zatvorite ostale prozore za postavljanje i pokušajte ponovno.',
  'settings.sidecar.uninstalled': 'Sidecar je deinstaliran.',
  'settings.sidecar.cudaUninstalled': 'CUDA sidecar je deinstaliran. Rad se nastavlja na CPU-u.',
  'settings.sidecar.cpuUninstalled': 'CPU sidecar je deinstaliran.',
  'settings.sidecar.restartFailed':
    'Govorni modul se nije mogao ponovno pokrenuti. Ponovno pokrenite Obsidian prije diktiranja.',
  'settings.sidecar.reinstall': 'Ponovno instaliraj',
  'settings.sidecar.uninstall': 'Deinstaliraj',
  'settings.sidecar.install': 'Instaliraj',
  'plugin.name': 'Speech Kit',
  'common.cancel': 'Odustani',
  'common.delete': 'Izbriši',
  'common.duplicate': 'Dupliciraj',
  'common.free': 'Besplatno',
  'common.inherit': 'Naslijeđeno',
  'common.off': 'Isključeno',
  'common.on': 'Uključeno',
  'common.save': 'Spremi',
  'common.unavailable': 'Nedostupno',
  'ribbon.idle': 'Speech Kit — pokreni diktiranje',
  'ribbon.starting': 'Speech Kit — pokretanje…',
  'ribbon.listening': 'Speech Kit — slušanje',
  'ribbon.speechDetected': 'Speech Kit — čuje govor',
  'ribbon.error': 'Speech Kit — pogreška',
  'validation.wholeNumberRange': 'Unesite cijeli broj od {min} do {max}.',
  'validation.numberRange': 'Unesite broj od {min} do {max}.',
  'llm.managedByPreset':
    'Ovime upravlja predložak „{preset}”. Uredite taj predložak da biste promijenili ovu vrijednost.',
  'llm.context.title': 'Postavke konteksta',
  'llm.context.settingsTooltip': 'Postavke konteksta',
  'llm.context.intro':
    'Više konteksta može poboljšati terminologiju, ali može povećati lokalno kašnjenje ili trošak OpenRoutera.',
  'llm.context.noteLength.name': 'Duljina konteksta bilješke',
  'llm.context.noteLength.description':
    'Najveći broj znakova koji se uzimaju iz trenutačne bilješke iznad kursora.',
  'llm.context.previousPhrases.name': 'Prethodne fraze',
  'llm.context.previousPhrases.description':
    'Nedavno diktirane fraze uključene kao povijest razgovora.',
  'llm.context.afterEachPhraseOnly':
    'Koristi se samo kada je Pokretanje transformacije postavljeno na Nakon svake fraze.',
  'llm.context.limit.name': 'Ograničenje konteksta',
  'llm.context.limit.description':
    'Najveći ukupan broj znakova iz konteksta bilješke i prethodnih fraza.',
  'llm.context.useCurrentNote.name': 'Trenutačna bilješka kao kontekst',
  'llm.context.useCurrentNote.description': 'U svaki upit uključuje tekst iznad kursora.',
  'llm.model.title': 'Napredne postavke modela',
  'llm.model.settingsTooltip': 'Napredne postavke modela',
  'llm.model.temperature.name': 'Temperatura',
  'llm.model.temperature.description':
    'Varijacija uzorkovanja koja se šalje svakom pružatelju usluge. 0 je determinističko; više vrijednosti daju veću raznolikost.',
  'llm.model.routingThreshold.name': 'Prag za velike transkripte',
  'llm.model.routingThreshold.description':
    'Iznad ovog broja znakova upotrebljava se pružatelj usluge za velike transkripte.',
  'llm.model.networkTimeout.name': 'Mrežno vremensko ograničenje',
  'llm.model.networkTimeout.description':
    'Nakon ovoliko sekundi prestaje se čekati mrežne pružatelje usluge. Izvorni transkript se zadržava.',
  'llm.model.behavior.name': 'Napredne postavke',
  'llm.model.summary.temperature': 'Temperatura {value}',
  'llm.model.summary.temperatureShared': 'Temperatura {value} za oba pružatelja usluge',
  'llm.model.summary.timeout': 'Mrežno vremensko ograničenje {value} s',
  'llm.failure.authInvalid': 'Pružatelj usluge {provider} odbio je API ključ. Provjerite postavke.',
  'llm.failure.permissionDenied':
    'Pružatelj usluge {provider} odbio je pristup. Provjerite vjerodajnice, dopuštenja računa ili pristup modelu.',
  'llm.failure.rateLimited':
    'Dosegnuto je ograničenje broja zahtjeva pružatelja usluge {provider}. Vraćanje na izvorni tekst.',
  'llm.failure.network': 'Mrežna pogreška pri povezivanju s pružateljem usluge {provider}.',
  'llm.failure.modelNotConfigured':
    'Model za pružatelja usluge {provider} nije konfiguriran. Odaberite ga u odjeljku Model.',
  'llm.failure.unknownModel':
    'Model pružatelja usluge {provider} nije pronađen. Odaberite drugi u odjeljku Model.',
  'llm.failure.unknown': 'LLM transformacija nije uspjela. Pogledajte konzolu.',
  'llm.status.selectOllamaModel': 'Odaberite Ollama model u nastavku.',
  'llm.status.selectOpenRouterModel': 'Odaberite OpenRouter model u nastavku.',
  'llm.status.selectCustomModel': 'Unesite ID modela u nastavku.',
  'llm.status.customModelsUnavailable': 'Modele nije moguće učitati — unesite ID modela ručno.',
  'llm.status.ollamaNotRunning': 'Ollama nije pokrenut.',
  'llm.status.unreachable': 'Povezivanje s pružateljem usluge {provider} nije uspjelo.',
  'llm.status.authInvalid': 'Pružatelj usluge {provider} odbio je API ključ.',
  'llm.status.permissionDenied':
    'Pružatelj usluge {provider} odbio je pristup. Provjerite vjerodajnice, dopuštenja računa ili pristup modelu.',
  'llm.status.rateLimited': 'Dosegnuto je ograničenje broja zahtjeva pružatelja usluge {provider}.',
  'llm.status.noOllamaModels': 'U Ollami nije instaliran nijedan chat model.',
  'llm.status.noModels': 'Nije pronađen nijedan upotrebljiv model pružatelja usluge {provider}.',
  'llm.status.selectedUnavailable': 'Odabrani model nije dostupan.',
  'llm.timing.title': 'Postavke vremena pokretanja',
  'llm.timing.settingsTooltip': 'Postavke vremena pokretanja',
  'llm.timing.minimumWords.name': 'Najmanji broj riječi',
  'llm.timing.minimumWords.description':
    'Transformacija se preskače kada transkript ima manje riječi od ovoga.',
  'llm.timing.timestamps.perUtterance': 'Nakon svake fraze čuva granice vremenskih oznaka.',
  'llm.timing.timestamps.batch':
    'Sve odjednom može prepisati ili ukloniti vremenske oznake, ovisno o predlošku.',
  'llm.timing.option.perUtterance': 'Nakon svake fraze',
  'llm.timing.option.batch': 'Sve odjednom pri zaustavljanju',
  'llm.routing.priceTierTooltip': 'Približan cjenovni razred',
  'llm.routing.providerModel': 'Model pružatelja usluge {provider}',
  'llm.routing.ollamaModelDescription': 'Odaberite lokalni Ollama chat model.',
  'llm.routing.selectModel': 'Odaberi model',
  'llm.routing.refreshModels': 'Osvježi modele pružatelja usluge {provider}',
  'llm.routing.openRouterModel.name': 'OpenRouter model',
  'llm.routing.openRouterModel.description': 'Upišite tekst za pretraživanje OpenRouter modela.',
  'llm.routing.testConnection': 'Testiraj API ključ i model',
  'llm.routing.testingConnection': 'Testiranje veze…',
  'llm.provider.ollama': 'Ollama',
  'llm.provider.openrouter': 'OpenRouter',
  'llm.provider.custom': 'Kompatibilno s OpenAI-jem',
  'llm.routing.provider': 'Pružatelj usluge',
  'llm.routing.defaultProvider': 'Zadani pružatelj usluge',
  'llm.routing.largeProvider': 'Pružatelj usluge za velike transkripte',
  'llm.routing.chooseProvider': 'Odaberi pružatelja usluge',
  'llm.routing.audioPrivacy':
    'Šalju se samo tekst transkripta i uključeni kontekst. Zvuk se nikada ne šalje.',
  'llm.routing.useLargeProvider': 'Drugi pružatelj usluge za velike transkripte',
  'llm.routing.useLargeProviderDescription':
    'Transkripti iznad konfiguriranog praga broja znakova usmjeravaju se drugom pružatelju usluge.',
  'llm.routing.defaultLeg': 'Zadano',
  'llm.routing.largeLeg': 'Veliki transkripti',
  'llm.routing.openRouterApiKey.name': 'OpenRouter API ključ',
  'llm.routing.openRouterApiKey.description': 'Obavezno. Obsidian ga sigurno pohranjuje.',
  'llm.routing.customBaseUrl.name': 'Osnovni URL',
  'llm.routing.customBaseUrl.description':
    'Uključite putanju verzije API-ja kada je potrebna, na primjer http://localhost:1234/v1.',
  'llm.routing.customDestination': 'Odredište transformacije: {host}',
  'llm.routing.insecureHttpWarning':
    'Ova nelokalna krajnja točka upotrebljava nekriptirani HTTP. Tekst transkripta i API ključevi mogu biti izloženi.',
  'llm.routing.customApiKey.name': 'API ključ',
  'llm.routing.customApiKey.description': 'Neobavezno. Obsidian ga sigurno pohranjuje.',
  'llm.routing.customModel.name': 'Model',
  'llm.routing.customModel.description':
    'Odaberite pronađeni model ili unesite ID modela. Ako otkrivanje modela nije dostupno, ručni unos i dalje radi.',
  'llm.readiness.chooseProvider':
    'Odaberite pružatelja usluge da biste upotrebljavali transformacije.',
  'llm.readiness.chooseModel': 'Odaberite model za pružatelja usluge {provider}.',
  'llm.readiness.apiKeyMissing': 'Odaberite OpenRouter API ključ u odjeljku Secret Storage.',
  'llm.readiness.baseUrlInvalid': 'Unesite ispravan osnovni URL kompatibilan s OpenAI-jem.',
  'llm.readiness.routingInvalid':
    'Odaberite dva različita pružatelja usluge za usmjeravanje prema veličini.',
  'llm.validation.baseUrl.empty': 'Unesite osnovni URL kompatibilan s OpenAI-jem.',
  'llm.validation.baseUrl.absolute': 'Unesite apsolutni HTTP ili HTTPS URL.',
  'llm.validation.baseUrl.scheme': 'Osnovni URL mora upotrebljavati HTTP ili HTTPS.',
  'llm.validation.baseUrl.credentials':
    'Uklonite vjerodajnice iz URL-a i upotrijebite Secret Storage.',
  'llm.validation.baseUrl.queryOrFragment':
    'Osnovni URL ne smije sadržavati upitni niz ni fragment.',
  'llm.sidebar.eyebrow': 'Tijek rada s transkriptom',
  'llm.sidebar.title': 'Transformacija diktiranja',
  'llm.sidebar.description':
    'Odaberite kako se izgovoreni tekst oblikuje prije nego što dođe u vašu bilješku.',
  'llm.sidebar.group.preset': 'Predložak',
  'llm.sidebar.group.model': 'Model',
  'llm.sidebar.group.context': 'Kontekst',
  'llm.sidebar.enabled.name': 'Uključeno',
  'llm.sidebar.enabled.description': 'Primjenjuje aktivni predložak na novi diktirani tekst.',
  'llm.sidebar.showOriginal.name': 'Prikaz izvornog transkripta',
  'llm.sidebar.showOriginal.description':
    'Zadržava ga u sklopivom callout okviru ispod svakog transformiranog rezultata.',
  'llm.sidebar.runTransform.name': 'Pokretanje transformacije',
  'llm.sidebar.runTransform.description':
    'Izvodi se nakon svake fraze ili sve odjednom kada zaustavite diktiranje.',
  'llm.sidebar.runTransform.setByPreset': 'Određeno predloškom {preset} — {timing}.',
  'llm.sidebar.activePreset': 'Aktivni predložak',
  'llm.sidebar.unavailable.title': 'LLM značajke nisu dostupne',
  'llm.sidebar.unavailable.description':
    'Uključite LLM značajke u postavkama Speech Kita da biste konfigurirali transformacije.',
  'llm.sidebar.unavailable.summary': 'Uključite LLM značajke u postavkama',
  'llm.sidebar.off.title': 'Način rada s izvornim transkriptom',
  'llm.sidebar.off.description':
    'Diktiranje umeće izvorni lokalni transkript. Uključite transformaciju kada želite čišćenje, prepisivanje ili sažetke.',
  'llm.sidebar.off.summary': 'Izvorni transkript',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Čišćenje',
  'llm.preset.builtin.cleanUp.description':
    'Ispravlja artefakte transkripcije, poštapalice, interpunkciju i velika slova uz očuvanje stila izražavanja i značenja.',
  'llm.preset.builtin.cleanUp.prompt':
    'Očisti diktirani tekst dobiven pretvorbom govora u tekst. Ispravi poštapalice, prekinute započete rečenice, ponavljanja, interpunkciju, velika slova i očite pogreške prepoznavanja. Sačuvaj govornikov stil izražavanja i značenje. Referentni kontekst upotrijebi samo za pravopis. Piši na izvornom jeziku transkripta. Nikada nemoj prevoditi osim ako korisnik izričito ne zatraži prijevod. Vrati samo očišćeni tekst — bez uvoda, bez komentara.',
  'llm.preset.builtin.professionalWriting.label': 'Profesionalno pisanje',
  'llm.preset.builtin.professionalWriting.description':
    'Prepisuje tekst u sažetu, dotjeranu profesionalnu prozu uz očuvanje činjenica, imena, odluka i tehničkih pojmova.',
  'llm.preset.builtin.professionalWriting.prompt':
    'Prepiši diktirani govor kao sažetu profesionalnu prozu. Upotrebljavaj aktiv, bez poštapalica i suzdržanih formulacija. Sačuvaj svaku činjenicu, ime i pojam. Referentni kontekst upotrijebi za pravopis. Piši na izvornom jeziku transkripta. Nikada nemoj prevoditi osim ako korisnik izričito ne zatraži prijevod. Vrati samo prepisani tekst — bez uvoda, bez komentara.',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Dodaje kratak TLDR sažetak iznad vašeg netaknutog transkripta.',
  'llm.preset.builtin.tldr.prompt':
    'Napiši TLDR sažetak diktiranog transkripta: naslov „TLDR” nakon kojeg slijedi jedna do tri kratke natuknice s ključnim točkama. Piši na izvornom jeziku transkripta. Nikada nemoj prevoditi osim ako korisnik izričito ne zatraži prijevod. Vrati samo naslov i natuknice — nemoj ponavljati transkript, bez uvoda, bez komentara.',
  'llm.preset.builtin.markdownFormatting.label': 'Markdown oblikovanje',
  'llm.preset.builtin.markdownFormatting.description':
    'Preoblikuje transkript sesije u strukturirani Markdown s naslovima, popisima i isticanjem.',
  'llm.preset.builtin.markdownFormatting.prompt':
    'Preoblikuj diktirani govor u dobro strukturirani Markdown. Dodaj naslove, natuknice ili numerirane popise, podebljanje, isticanje i ograđene blokove koda ondje gdje sadržaj to opravdava. Lagano očisti poštapalice, prekinute započete rečenice, interpunkciju i velika slova; sačuvaj govornikov izričaj, svaku činjenicu, ime i pojam. Piši na izvornom jeziku transkripta. Nikada nemoj prevoditi osim ako korisnik izričito ne zatraži prijevod. Vrati samo Markdown — bez uvoda, bez komentara.',
  'llm.preset.builtin.actionItems.label': 'Zadaci za izvršenje',
  'llm.preset.builtin.actionItems.description':
    'Dodaje kontrolni popis zadataka ispod vašeg netaknutog transkripta.',
  'llm.preset.builtin.actionItems.prompt':
    'Izdvoji zadatke za izvršenje iz diktiranog transkripta. Ispiši naslov „Zadaci za izvršenje” nakon kojeg slijedi Markdown kontrolni popis konkretnih zadataka, uz navođenje odgovorne osobe kada je govornik spomene. Ako transkript ne sadrži nijedan zadatak za izvršenje, ne vraćaj ništa. Piši na izvornom jeziku transkripta. Nikada nemoj prevoditi osim ako korisnik izričito ne zatraži prijevod. Vrati samo naslov i kontrolni popis — nemoj ponavljati transkript, bez uvoda, bez komentara.',
  'llm.preset.timing.perUtterance': 'Izvodi se nakon svake fraze',
  'llm.preset.timing.batch': 'Izvodi se jednom pri zaustavljanju',
  'llm.preset.timing.either': 'Izvodi se u oba načina rada',
  'llm.preset.behavior.addAbove': 'dodaje novi sadržaj iznad transkripta',
  'llm.preset.behavior.addBelow': 'dodaje novi sadržaj ispod transkripta',
  'llm.preset.behavior.replace': 'prepisuje diktirani tekst',
  'llm.preset.behavior.overrides': 'nadjačava {fields}',
  'llm.preset.override.minimumWords': 'min. broj riječi',
  'llm.preset.override.temperature': 'temperatura',
  'llm.preset.override.noteContext': 'kontekst bilješke',
  'llm.preset.option.perUtterance': '{preset} (nakon svake fraze)',
  'llm.preset.option.batch': '{preset} (pri zaustavljanju)',
  'llm.preset.copySuffix': ' (kopija)',
  'llm.preset.copySuffixNumbered': ' (kopija {number})',
  'llm.preset.validation.nameRequired': 'Unesite naziv ovog predloška.',
  'llm.preset.validation.nameExists': 'Predložak s tim nazivom već postoji.',
  'llm.preset.validation.promptRequired': 'Unesite upit za ovaj predložak.',
  'llm.preset.validation.minimumWords': 'Min. broj riječi mora biti cijeli broj između 0 i {max}.',
  'llm.preset.validation.temperature': 'Temperatura mora biti broj između 0 i {max}.',
  'llm.preset.validation.maximumCount':
    'Možete spremiti najviše {max} predložaka. Najprije izbrišite jedan.',
  'llm.preset.validation.builtinName':
    'Taj naziv već upotrebljava ugrađeni predložak — odaberite drugi naziv.',
  'llm.preset.manager.title': 'Upravljanje predlošcima',
  'llm.preset.manager.newTitle': 'Novi predložak',
  'llm.preset.manager.editTitle': 'Uređivanje predloška',
  'llm.preset.manager.presets.name': 'Predlošci',
  'llm.preset.manager.presets.description':
    'Aktivni predložak je označen. Ugrađeni predlošci samo su za čitanje — duplicirajte jedan da biste ga prilagodili.',
  'llm.preset.manager.new': 'Novi predložak',
  'llm.preset.manager.searchPlaceholder': 'Pretraži predloške...',
  'llm.preset.manager.noMatches': 'Nijedan predložak ne odgovara vašem pretraživanju.',
  'llm.preset.manager.builtinHeading': 'Ugrađeni predlošci',
  'llm.preset.manager.yoursHeading': 'Vaši predlošci',
  'llm.preset.manager.viewTooltip': 'Prikaži predložak',
  'llm.preset.manager.editTooltip': 'Uredi predložak',
  'llm.preset.manager.duplicateTooltip': 'Dupliciraj predložak',
  'llm.preset.manager.deleteTooltip': 'Izbriši predložak „{preset}”',
  'llm.preset.manager.back': '← Svi predlošci',
  'llm.preset.editor.name': 'Naziv',
  'llm.preset.editor.namePlaceholder': 'npr. Bilješke sa sastanka',
  'llm.preset.editor.description': 'Opis (neobavezno)',
  'llm.preset.editor.descriptionPlaceholder': 'Kada upotrijebiti ovaj predložak',
  'llm.preset.editor.prompt': 'Upit',
  'llm.preset.editor.promptDescription': 'Šalje se modelu kao sistemski upit.',
  'llm.preset.editor.promptSize':
    '~{tokens} tokena ({characters} znakova) — šalje se sa svakim zahtjevom',
  'llm.preset.editor.timing': 'Vrijeme pokretanja',
  'llm.preset.editor.timingDescription':
    'Kada se transformacija izvodi. „Bilo koje” slijedi vrijeme postavljeno u bočnoj traci.',
  'llm.preset.editor.timingEither': 'Bilo koje (prati bočnu traku)',
  'llm.preset.editor.timingPerUtterance': 'Nakon svake fraze',
  'llm.preset.editor.timingBatch': 'Jednom pri zaustavljanju',
  'llm.preset.editor.output': 'Izlaz',
  'llm.preset.editor.outputDescription':
    'Zamjena prepisuje vaš diktirani tekst. Dodavanje ga ostavlja netaknutim i umeće novi sadržaj.',
  'llm.preset.editor.outputReplace': 'Zamjena teksta',
  'llm.preset.editor.outputAddAbove': 'Dodavanje iznad transkripta',
  'llm.preset.editor.outputAddBelow': 'Dodavanje ispod transkripta',
  'llm.preset.editor.overrides': 'Nadjačavanja',
  'llm.preset.editor.overridesDescription':
    'Ostavite polje prazno da biste upotrijebili globalnu postavku.',
  'llm.preset.editor.minimumWords': 'Min. broj riječi',
  'llm.preset.delete.title': 'Brisanje predloška',
  'llm.preset.delete.message':
    'Želite li izbrisati predložak „{preset}”? Ovo se ne može poništiti.',
  'llm.preset.delete.activeFallback':
    'Predložak „{preset}” bio je aktivan — prebačeno na Čišćenje.',
  'common.back': 'Natrag',
  'common.close': 'Zatvori',
  'common.done': 'Gotovo',
  'common.install': 'Instaliraj',
  'common.later': 'Poslije',
  'common.next': 'Dalje',
  'common.remove': 'Ukloni',
  'common.tryAgain': 'Pokušaj ponovno',
  'setup.ready.waitForDictation':
    'Pričekajte da završi trenutno diktiranje, zatim pokušajte ponovno.',
  'setup.ready.openMarkdownNote':
    'Otvorite Markdown bilješku u načinu uređivanja, zatim ponovno pokušajte diktirati.',
  'setup.ready.completionFailed': 'Postavljanje nije moguće dovršiti. Pokušajte ponovno.',
  'setup.wizard.welcomeTitle': 'Dobro došli u Speech Kit',
  'setup.wizard.title': 'Postavljanje Speech Kita',
  'setup.wizard.engineReadyTitle': 'Govorni modul je spreman',
  'setup.wizard.engineReadyDesc':
    'Lokalni modul za pretvorbu govora u tekst instaliran je i spreman.',
  'setup.wizard.intro':
    'Diktirajte bilješke izravno u Obsidianu, bez tipkanja i u potpunosti na svom računalu. Bez računa, bez oblaka, bez telemetrije.',
  'setup.wizard.quickSetup': 'Brzo postavljanje u 2 minute:',
  'setup.wizard.downloadEngineStep': 'Preuzimanje govornog modula',
  'setup.wizard.pickModelStep': 'Odabir modela za transkripciju',
  'setup.wizard.startTalking':
    'Zatim kliknite mikrofon na vrpci (ili upotrijebite vlastiti tipkovni prečac) i počnite govoriti.',
  'setup.wizard.cpuBuildNote':
    'Počinje s CPU izdanjem. Imate NVIDIA GPU? CUDA izdanje možete instalirati kasnije kako biste ubrzali Whisper modele.',
  'setup.wizard.downloadEngine': 'Preuzmi govorni modul',
  'setup.wizard.modelSelectedTitle': 'Model je odabran',
  'setup.wizard.pickModelTitle': 'Odaberite model za transkripciju',
  'setup.wizard.modelSelectedDesc':
    'Model za transkripciju instaliran je i odabran. Kasnije možete instalirati druge modele ili promijeniti odabrani u postavkama.',
  'setup.wizard.modelIntro':
    'Instalirajte model za transkripciju kako biste omogućili diktiranje. Dodatne modele možete instalirati kasnije — manji modeli su brži, a veći su točniji.',
  'setup.wizard.modelKinds':
    'Dostupne su dvije vrste: streaming modeli prikazuju riječi uživo dok govorite, a standardni modeli transkribiraju nakon svake stanke. Za diktiranje bez upotrebe ruku počnite s preporučenim modelom Moonshine Small. Nemotron 3.5 ASR je streaming opcija koja traži više resursa.',
  'setup.wizard.gpuNote':
    'Whisper modeli mogu raditi znatno brže uz GPU ubrzanje. Ako imate NVIDIA GPU, CUDA izdanje možete instalirati kasnije u postavkama.',
  'setup.wizard.openModelPicker': 'Otvori odabir modela',
  'setup.wizard.readyTitle': 'Spremni ste za diktiranje',
  'setup.wizard.readyDesc':
    'Isprobajte ga u Markdown bilješci koja je sada otvorena. Izgovorite nekoliko riječi, a zatim zaustavite diktiranje mikrofonom na vrpci ili tipkovnim prečacem.',
  'setup.wizard.ribbonTitle': 'Upotrijebite mikrofon na vrpci',
  'setup.wizard.ribbonDesc':
    'Potražite ovu ikonu na Obsidianovoj vrpci. Kliknite je za početak diktiranja, a ponovnim klikom za zaustavljanje.',
  'setup.wizard.hotkeyTitle': 'Ili dodijelite tipkovni prečac',
  'setup.wizard.hotkeyDescBefore': 'Dodijelite prečac naredbi ',
  'setup.wizard.toggleCommandName': 'Speech Kit: Uključi ili isključi diktiranje',
  'setup.wizard.hotkeyDescAfter': ' za pokretanje i zaustavljanje bilo gdje u Obsidianu.',
  'setup.wizard.openHotkeySettings': 'Otvori postavke tipkovnih prečaca',
  'setup.wizard.tryDictationNow': 'Isprobaj diktiranje odmah',
  'setup.wizard.openHotkeySettingsFallback':
    'Otvorite Postavke → Tipkovni prečaci i potražite „Speech Kit”.',
  'setup.sidecar.modal.download': 'Preuzimanje',
  'setup.sidecar.modal.variantDownload': 'Preuzimanje: {variant}',
  'setup.sidecar.modal.version': 'Verzija',
  'setup.sidecar.modal.cancelling': 'Otkazivanje...',
  'setup.sidecar.modal.downloading': 'Preuzimanje...',
  'setup.sidecar.modal.retryDownload': 'Ponovi preuzimanje',
  'setup.sidecar.modal.installFailureNotice':
    'Instalacija govornog modula nije uspjela. Ponovno otvorite postavljanje ili postavke kako biste pregledali pogrešku i pokušali ponovno.',
  'setup.sidecar.modal.startFailed':
    'Nije moguće pokrenuti instalaciju sidecara. Zatvorite ostale prozore postavljanja i pokušajte ponovno.',
  'setup.sidecar.installCancelled': 'Instalacija sidecara je otkazana.',
  'setup.sidecar.progress.variant': ' {variant} sidecar ({current} od {total})',
  'setup.sidecar.progress.downloading': 'Preuzimanje',
  'setup.sidecar.progress.verifying': 'Provjera kontrolnog zbroja...',
  'setup.sidecar.progress.extracting': 'Raspakiravanje arhive...',
  'models.manage.title': 'Upravljanje modelima',
  'models.manage.loadFailedTitle': 'Modele nije moguće učitati',
  'models.manage.loadFailedDesc':
    'Govorni modul možda nije instaliran ili ne odgovara. Ponovno pokrenite postavljanje kako biste ga ponovno instalirali ili pokušajte ponovno.',
  'models.manage.runSetup': 'Pokreni postavljanje',
  'models.manage.loadingCatalog': 'Učitavanje kataloga modela…',
  'models.manage.loadCatalogFailed': 'Učitavanje kataloga modela nije uspjelo.',
  'models.manage.noneAvailable': 'Za ovaj govorni modul nema dostupnih modela.',
  'models.manage.unsupportedLanguage':
    ' · Ne podržava {language}. Promijenite Jezik diktiranja kako biste instalirali ili upotrijebili ovaj model.',
  'models.manage.use': 'Upotrijebi',
  'models.manage.selected': 'Odabrano',
  'models.manage.cancelling': 'Otkazivanje…',
  'models.manage.details': 'Pojedinosti',
  'models.manage.retryInstall': 'Pokušaj ponovno',
  'models.manage.dismissInstallFailure': 'Odbaci',
  'models.manage.installStartFailed':
    'Nije moguće pokrenuti instalaciju modela. Pokušajte ponovno.',
  'models.manage.selectFailed':
    'Nije moguće odabrati model. Provjerite jesu li njegove datoteke dostupne.',
  'models.manage.selectedNotice': 'Model je odabran.',
  'models.manage.removeFailed':
    'Nije moguće ukloniti model. Zatvorite sve procese koji upotrebljavaju njegove datoteke.',
  'models.manage.stopSpeechFirst':
    'Najprije zaustavite diktiranje ili čitanje naglas — govorni modul upravo sada upotrebljava datoteke modela.',
  'models.manage.removedNotice': 'Model je uklonjen.',
  'models.external.title': 'Upotreba vanjske datoteke',
  'models.external.intro':
    'Vanjski modeli namijenjeni su naprednoj upotrebi. Speech Kit te datoteke ne preuzima, ne ažurira niti im provjerava kontrolni zbroj.',
  'models.external.family.name': 'Obitelj modela',
  'models.external.family.desc':
    'Odaberite učitavač koji odgovara modelu. Obitelj se ne zaključuje iz naziva datoteke.',
  'models.external.path.name': 'Putanja do datoteke modela',
  'models.external.path.desc':
    'Unesite apsolutnu putanju do glavnog artefakta modela. Provjerava se prije nego što se ovaj odabir spremi.',
  'models.external.validateAndUse': 'Provjeri i upotrijebi',
  'models.external.validating': 'Provjeravanje…',
  'models.external.selectedNotice': 'Vanjska datoteka modela provjerena je i odabrana.',
  'models.external.requirementsTitle': 'Zahtjevi za datoteku',
  'models.external.validation.notConfigured': 'Putanja do datoteke modela nije postavljena.',
  'models.external.validation.notAbsolute': 'Putanja do datoteke modela mora biti apsolutna.',
  'models.external.validation.missing': 'Putanja do datoteke modela ne postoji: {path}',
  'models.external.validation.notFile':
    'Putanja do datoteke modela mora upućivati na datoteku: {path}',
  'models.external.validation.selectEntryFile': 'Odaberite {filename}.',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR zahtijeva artefakt encoder.int8.onnx. Odaberite encoder.int8.onnx iz direktorija modela s prozorom od 560 ms.',
  'models.external.validation.moonshineEntryFile':
    'Moonshine zahtijeva svoj glavni artefakt frontend.ort. Odaberite frontend.ort iz direktorija streaming modela.',
  'models.external.validation.generic': 'Govorni modul nije mogao provjeriti ovaj model.',
  'models.external.requirements.nemotron.entry':
    'Odaberite encoder.int8.onnx iz Nemotron 3.5 ASR int8 izvoza s prozorom od 560 ms.',
  'models.external.requirements.nemotron.siblings':
    'Isti direktorij mora sadržavati decoder.int8.onnx, joiner.int8.onnx i tokens.txt.',
  'models.external.requirements.nemotron.compatibility':
    'Ostale veličine odsječaka i ORT GenAI izvozi nisu kompatibilni s ovim adapterom.',
  'models.external.requirements.moonshine.entry':
    'Odaberite frontend.ort iz direktorija Moonshine v2 streaming ORT modela.',
  'models.external.requirements.moonshine.siblings':
    'Isti direktorij mora sadržavati encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json i tokenizer.bin.',
  'models.external.requirements.moonshine.compatibility':
    'Moonshine ONNX izvozi bez streaminga nisu kompatibilni.',
  'models.external.requirements.whisper.entry':
    'Odaberite jednu GGML ili GGUF datoteku modela kompatibilnu s whisper.cpp.',
  'models.external.requirements.whisper.validation':
    'Učitavač provjerava sadržaj datoteke; sam nastavak naziva datoteke ne jamči kompatibilnost.',
  'models.external.requirements.whisper.language':
    'Whisper datoteke s .en težinama podržavaju samo engleski, dok višejezične težine omogućuju odabir provjerenog jezika i automatsko prepoznavanje.',
  'models.details.totalSize': 'Ukupna veličina',
  'models.details.source': 'Izvor',
  'models.details.license': 'Licenca',
  'models.details.capabilities': 'Mogućnosti',
  'models.details.installPath': 'Putanja instalacije',
  'models.details.files': 'Datoteke ({count})',
  'models.details.size': 'Veličina',
  'models.details.modelCard': 'Kartica modela',
  'models.details.languages': 'Jezici',
  'models.details.availableVoices': 'Dostupni glasovi',
  'models.details.installedVoices': 'Instalirani glasovi',
  'models.details.defaultVoice': '{voice} (zadani glas)',
  'models.details.speedControl': 'Upravljanje brzinom',
  'models.details.outputSampleRate': 'Frekvencija uzorkovanja izlaza',
  'models.details.supported': 'Podržano',
  'models.capability.segmentTimestamps': 'Vremenske oznake segmenata',
  'models.capability.wordTimestamps': 'Vremenske oznake riječi',
  'models.capability.initialPrompt': 'Početni upit',
  'models.capability.streaming': 'Streaming',
  'models.capability.autoLanguageDetection': 'Automatsko prepoznavanje jezika',
  'models.capability.punctuation': 'Interpunkcija',
  'models.capability.maxAudio': 'Maks. trajanje zvuka: {seconds} s',
  'models.capability.anyLanguage': 'Bilo koji jezik',
  'models.capability.englishOnly': 'Samo engleski',
  'models.capability.languageCount': 'Broj jezika: {count}',
  'models.capability.languageSelection': 'Odabir jezika',
  'models.tag.fullPrecision': 'Puna preciznost',
  'models.tag.reducedSize': 'Smanjena veličina',
  'models.progress.preparing': 'Priprema instalacije',
  'models.progress.downloading': 'Preuzimanje',
  'models.progress.verifying': 'Provjera preuzimanja',
  'models.progress.validating': 'Provjera valjanosti modela',
  'models.progress.installed': 'Model je instaliran',
  'models.progress.cancelled': 'Instalacija modela je otkazana',
  'models.progress.failed': 'Instalacija modela nije uspjela',
  'models.progress.downloadingFile': 'Preuzimanje datoteke {filename}',
  'models.progress.verifyingFile': 'Provjera datoteke {filename}',
  'models.progress.fileCount': 'Datoteka {current} od {total}',
  'models.current.noneSelected': 'Nijedan model nije odabran',
  'models.current.noneSelectedDesc': 'Odaberite instalirani model ili provjerite vanjsku datoteku.',
  'models.current.notSelected': 'Nije odabrano',
  'models.current.externalFile': 'Vanjska datoteka',
  'models.current.managedNotInstalled': 'Odabrani upravljani model nije instaliran.',
  'models.current.installed': 'Instalirano',
  'models.current.notInstalled': 'Nije instalirano',
  'models.current.managedDownload': 'Upravljano preuzimanje',
  'models.current.externalValidated': 'Provjerena vanjska datoteka',
  'models.current.checking': 'Provjera',
  'models.current.externalUnavailableDesc':
    'Vanjski model nije dostupan. Ponovno provjerite datoteku kako biste vidjeli pojedinosti.',
  'models.current.unavailable': 'Nedostupno',
  'models.current.validateBeforeDictating': 'Provjerite datoteku vanjskog modela prije diktiranja.',
  'sidecarError.audio_too_long':
    'Zvučni isječak premašuje najdulje dopušteno trajanje za ovaj govorni modul.',
  'sidecarError.engine_inference_failed': 'Lokalna transkripcija nije uspjela.',
  'sidecarError.internal_error': 'U govornom modulu došlo je do interne pogreške.',
  'sidecarError.invalid_audio_buffer':
    'Zvučni međuspremnik bio je prazan kada je transkripcija započela.',
  'sidecarError.invalid_audio_frame': 'Govorni modul primio je neispravan zvučni okvir.',
  'sidecarError.invalid_diarization_speaker_limit':
    'Najveći broj govornika mora biti barem 1 ili postavljen na Automatski.',
  'sidecarError.invalid_frame': 'Govorni modul primio je neispravan protokolni okvir.',
  'sidecarError.invalid_model_file': 'Datoteka modela nedostaje, nije čitljiva ili nije podržana.',
  'sidecarError.invalid_model_task': 'Odabrani model nije moguće upotrijebiti za diktiranje.',
  'sidecarError.invalid_model_store': 'Mapa za pohranu modela nije dostupna ili nije ispravna.',
  'sidecarError.invalid_synthesis_request': 'Zahtjev za čitanje naglas nije ispravan.',
  'sidecarError.missing_model_file': 'Datoteka modela ne postoji ili nije obična datoteka.',
  'sidecarError.missing_voice_file': 'Odabrani glas za čitanje naglas nije instaliran.',
  'sidecarError.no_active_install': 'Nema aktivne instalacije modela koja bi se mogla otkazati.',
  'sidecarError.no_active_session': 'Nema aktivne sesije diktiranja.',
  'sidecarError.session_already_exists': 'Sesija diktiranja s ovim ID-om već postoji.',
  'sidecarError.session_capacity_exceeded':
    'Speech Kit već ima najveći dopušteni broj aktivnih sesija.',
  'sidecarError.sidecar_exited': 'Proces sidecara neočekivano je završio.',
  'sidecarError.system_audio_capture_failed': 'Nije moguće pokrenuti snimanje zvuka sustava.',
  'sidecarError.system_audio_permission_denied':
    'Dopuštenje za snimanje zvuka sustava isključeno je za Obsidian. Otvorite Postavke sustava → Privatnost i sigurnost → Snimanje zaslona i zvuka sustava, omogućite Obsidian i pokušajte ponovno.',
  'sidecarError.system_audio_unsupported':
    'Snimanje zvuka sustava još nije dostupno na ovoj platformi. Preusmjerite izlaz ovog računala kroz virtualni zvučni uređaj i odaberite ga kao mikrofon — pogledajte vodič Zvuk sustava.',
  'sidecarError.synthesis_cancelled': 'Čitanje je otkazano.',
  'sidecarError.synthesis_failed': 'Lokalna sinteza govora nije uspjela.',
  'sidecarError.synthesis_worker_unavailable':
    'Lokalni radni proces za sintezu govora nije dostupan.',
  'sidecarError.transcription_failure': 'Lokalna transkripcija nije uspjela.',
  'sidecarError.unsupported_engine': 'Traženi govorni modul nije dostupan u ovom izdanju.',
  'sidecarError.unsupported_language': 'Odabrani model ne podržava ovaj jezik diktiranja.',
  'sidecarError.utterance_dropped_during_overload_drain':
    'Dovršeni iskaz odbačen je dok se red čekanja za transkripciju praznio.',
  'sidecarError.utterance_queue_overload':
    'Diktiranje je zaustavljeno jer je red čekanja za transkripciju preopterećen. Prihvaćeni zvuk bit će obrađen do kraja.',
  'sidecarError.vad_error': 'Otkrivanje glasovne aktivnosti nije uspjelo za zvučni okvir.',
  'sidecarError.vad_init_failed': 'Inicijalizacija ugrađenog Silero VAD-a nije uspjela.',
  'sidecarError.worker_panic':
    'Radni proces za transkripciju u govornom modulu neočekivano se zaustavio.',
  'catalog.whisper_tiny_en_q8_0.summary':
    'Najbrži model uz najmanju potrošnju resursa. Prikladan za testiranje ili slabija računala.',
  'catalog.whisper_base_en_q8_0.summary':
    'Brz model s pristojnom točnošću. Dobar izbor za brze skice na CPU-u.',
  'catalog.whisper_small_en_q5_1.summary':
    'Uravnotežuje kvalitetu transkripcije, veličinu preuzimanja i brzinu na CPU-u.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Vrlo točan model za korisnike kojima je kvaliteta transkripcije važnija od brzine.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'Višejezična transkripcija visoke točnosti s arhitekturom optimiziranom za GPU ubrzanje.',
  'catalog.cohere_transcribe_fp16.summary':
    'Najveća Cohere varijanta, zadržava punu preciznost modela.',
  'catalog.cohere_transcribe_int8.summary':
    'Srednja Cohere varijanta po veličini preuzimanja, uz 8-bitnu kvantizaciju.',
  'catalog.cohere_transcribe_q4.summary':
    'Najmanja Cohere varijanta; 4-bitna kvantizacija smanjuje veličinu nauštrb kvalitete.',
  'catalog.moonshine_tiny_streaming_en.summary':
    'Najbrži Moonshine streaming model s 34 milijuna parametara, namijenjen slabijim CPU-ima.',
  'catalog.moonshine_small_streaming_en.summary':
    'Uravnotežen model za diktiranje uživo sa 123 milijuna parametara.',
  'catalog.moonshine_medium_streaming_en.summary':
    'Najtočniji Moonshine streaming model s 245 milijuna parametara.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'NVIDIA-in višejezični RNNT s 0,6 milijardi parametara, izvezen u int8 ONNX za transkripciju uživo s predmemorijom konteksta na osam provjerenih jezika.',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Prirodna lokalna sinteza čitanja naglas na engleskom uz izbor pomno odabranih glasova.',
  'catalog.pocket_tts_french_24l_int8.summary':
    'Kvalitetnija lokalna sinteza na francuskom; ovaj model s 24 sloja više opterećuje CPU i može zastajkivati pri većim brzinama čitanja.',
  'catalog.pocket_tts_german_int8.summary':
    'Prirodna lokalna sinteza čitanja naglas na njemačkom uz izbor pomno odabranih glasova.',
  'catalog.pocket_tts_spanish_int8.summary':
    'Prirodna lokalna sinteza čitanja naglas na španjolskom uz izbor pomno odabranih glasova.',
  'catalog.pocket_tts_portuguese_int8.summary':
    'Prirodna lokalna sinteza čitanja naglas na portugalskom uz izbor pomno odabranih glasova.',
  'catalog.pocket_tts_italian_int8.summary':
    'Prirodna lokalna sinteza čitanja naglas na talijanskom uz izbor pomno odabranih glasova.',
  'catalog.supertonic_3_multilingual_2026_05.summary':
    'Munjevito brza lokalna višejezična sinteza čitanja naglas za osam podržanih jezika aplikacije.',
  'catalog.family.whisper.summary':
    'Transkribira nakon svake stanke. Whisper daje točnije vremenske oznake od ostalih obitelji modela, uključujući neobavezno mjerenje vremena na razini riječi. Tiny i Base naginju brzini, Small uravnotežuje brzinu i kvalitetu, a Medium i Large naginju kvaliteti.',
  'catalog.family.cohere_transcribe.summary':
    'Visokokvalitetna skupna transkripcija uz preuzimanje i memorijske zahtjeve od više gigabajta.',
  'catalog.family.moonshine.summary':
    'Prikazuje riječi dok govorite. Tiny naginje manjoj potrošnji resursa, Small uravnotežuje brzinu i kvalitetu, a Medium naginje kvaliteti.',
  'catalog.family.nemotron_asr.summary':
    'Višejezični streaming visoke točnosti uz veće preuzimanje i veću potrošnju resursa. Moonshine Small i dalje je preporučeni zadani izbor za diktiranje na engleskom uživo.',
  'catalog.family.supertonic.summary':
    'Munjevito brz višejezični TTS na uređaju putem ONNX Runtimea.',
  'catalog.family.pocket_tts.summary':
    'Lokalno čita bilješke naglas na engleskom, francuskom, njemačkom, španjolskom, portugalskom i talijanskom, uz izbor glasova i upravljanje brzinom koje čuva visinu tona.',
  'catalog.firefox_translations_release_2026_07.summary':
    'Brz lokalni prijevod između engleskog i sedam jezika proizvoda, s modelima koje objavljuje Firefox.',
  'catalog.family.firefox_translations.summary':
    'Lokalno prevodi tekst bilješke uz kompaktni Bergamot modul i objavljene Firefox modele.',
  'setup.sidecar.modal.unsupportedPlatform':
    'Ovo izdanje govornog modula nije dostupno za vašu platformu ili arhitekturu.',
  'setup.sidecar.modal.genericInstallError':
    'Govorni modul nije moguće instalirati. Pojedinosti potražite u zapisnicima dodatka, a zatim pokušajte ponovno.',
} as const satisfies TranslationCatalog;
