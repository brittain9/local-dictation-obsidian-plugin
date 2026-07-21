import type { TranslationCatalog } from '.';

export const de = {
  'notice.dictationNotActive': 'Das Diktat ist derzeit nicht aktiv.',
  'notice.dictationStartFailed': 'Das Diktat konnte nicht gestartet werden.',
  'notice.dictationStopFailed': 'Das Diktat konnte nicht gestoppt werden.',
  'notice.lastUtteranceCleared': 'Die zuletzt gespeicherte Äußerung wurde gelöscht.',
  'notice.lastUtteranceReinsertFailed':
    'Die letzte abgeschlossene Äußerung konnte nicht erneut eingefügt werden.',
  'notice.lastUtteranceReinserted': 'Die letzte endgültige Äußerung wurde erneut eingefügt.',
  'notice.lastUtteranceUnavailable':
    'Es ist keine endgültige Äußerung zum erneuten Einfügen verfügbar.',
  'notice.llmTransformEmpty': 'Die LLM-Transformation hat nichts zum Hinzufügen zurückgegeben.',
  'notice.microphoneDisconnected':
    'Mikrofon nicht angeschlossen. Das Diktat wurde gestoppt und die Verarbeitung der bereits aufgenommenen Audiodaten wird abgeschlossen. Schließen Sie das Mikrofon wieder an und beginnen Sie dann erneut mit dem Diktieren.',
  'notice.rawTranscriptChanged':
    'Das Rohtranskript konnte nicht wiederhergestellt werden, da sich die Notiz nach der Bereinigung geändert hat.',
  'notice.rawTranscriptCleared': 'Die Wiederherstellung des Rohtranskripts wurde gelöscht.',
  'notice.rawTranscriptCopied': 'Rohtranskript kopiert.',
  'notice.rawTranscriptCopyFailed': 'Das Rohtranskript konnte nicht kopiert werden.',
  'notice.rawTranscriptRestored': 'Das Rohtranskript wurde wiederhergestellt.',
  'notice.rawTranscriptRestoreFailed': 'Das Rohtranskript konnte nicht wiederhergestellt werden.',
  'notice.rawTranscriptTargetUnavailable':
    'Das Rohtranskript konnte nicht wiederhergestellt werden, da die Originalnotiz nicht mehr im selben Editor geöffnet ist.',
  'notice.rawTranscriptUnavailable': 'Es ist keine Wiederherstellung des Rohtranskripts verfügbar.',
  'notice.sidecarHealthCheckFailed': 'Sidecar-Zustandsprüfung fehlgeschlagen',
  'notice.sidecarReady': 'Sidecar ist bereit ({version}).',
  'notice.sidecarRestarted': 'sidecar ({version}) neu gestartet.',
  'notice.sidecarRestartFailed': 'Sidecar-Neustart fehlgeschlagen',
  'notice.sidecarRestartRequiresIdle':
    'Starten Sie den sidecar nur neu, wenn Diktat und Vorlesen inaktiv sind.',
  'notice.transcriptRecordFailed': 'Das Transkript konnte nicht aufgezeichnet werden.',
  'notice.sidecarSessionError': 'Die Sprach-Engine hat einen Fehler gemeldet.',
  'notice.sidecarVersionDrift.actionMultiple': 'Sprach-Engines aktualisieren',
  'notice.sidecarVersionDrift.actionOne': 'Sprach-Engine aktualisieren',
  'notice.sidecarVersionDrift.cpu':
    'Auf {version} aktualisiert, aber die installierte Sprach-Engine ist veraltet. Aktualisieren Sie jetzt, um sie synchron zu halten.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Auf {version} aktualisiert, aber die installierten Sprach-Engines CPU und CUDA sind veraltet. Aktualisieren Sie jetzt, um sie synchron zu halten.',
  'notice.sidecarVersionDrift.cuda':
    'Auf {version} aktualisiert, aber die installierte Sprach-Engine CUDA ist veraltet. Aktualisieren Sie jetzt, um sie synchron zu halten.',
  'notice.surfaceDesynchronized':
    'Das Diktat wurde gestoppt, weil sich die Notiz auf eine Weise geändert hat, die Local Dictation nicht sicher nachverfolgen konnte. Starten Sie das Diktat erneut, um fortzufahren.',
  'notice.targetNoteClosed':
    'Das Diktat wurde angehalten, weil die Zielnotiz geschlossen oder ersetzt wurde. Starten Sie das Diktat erneut, um fortzufahren.',
  'notice.targetNoteDeleted':
    'Das Diktat wurde gestoppt, da die Zielnotiz gelöscht wurde. Stellen Sie die Notiz wieder her oder erstellen Sie sie neu und beginnen Sie dann erneut mit dem Diktat.',
  'notice.transcriptWriteFailed':
    'Das Diktat wurde gestoppt, weil Local Dictation nicht sicher in die Notiz schreiben konnte. Starten Sie das Diktat erneut, um fortzufahren.',
  'setup.sidecar.cpu.firstRun.body':
    'Für Local Dictation ist ein einmaliger Download der Speech-to-Text-Engine CPU aus den GitHub-Versionen erforderlich. Nach Abschluss dieses Vorgangs wird die Transkription lokal auf Ihrem Computer ausgeführt. Sie können die CUDA-Beschleunigung später über die Einstellungen installieren.',
  'setup.sidecar.cpu.firstRun.primaryButton': 'CPU-Sidecar herunterladen',
  'setup.sidecar.cpu.firstRun.success': 'Local Dictation sidecar installiert und gestartet.',
  'setup.sidecar.cpu.firstRun.title': 'Beenden Sie die Einrichtung von Local Dictation',
  'setup.sidecar.cpu.install.body':
    'Laden Sie die CPU Speech-to-Text-Engine aus den GitHub-Versionen herunter. Nach Abschluss dieses Vorgangs wird die Transkription lokal auf Ihrem Computer ausgeführt.',
  'setup.sidecar.cpu.install.primaryButton': 'CPU-Sidecar herunterladen',
  'setup.sidecar.cpu.install.success': 'CPU sidecar installiert und gestartet.',
  'setup.sidecar.cpu.install.title': 'CPU-Sidecar installieren',
  'setup.sidecar.cpu.reinstall.body':
    'Laden Sie die Speech-to-Text-Engine CPU aus den GitHub-Versionen erneut herunter. Dies ersetzt die aktuelle CPU-Installation.',
  'setup.sidecar.cpu.reinstall.primaryButton': 'CPU-Sidecar erneut herunterladen',
  'setup.sidecar.cpu.reinstall.success': 'CPU sidecar neu installiert und neu gestartet.',
  'setup.sidecar.cpu.reinstall.title': 'CPU-Sidecar neu installieren',
  'setup.sidecar.cuda.install.body':
    'Laden Sie den CUDA-beschleunigten Sidecar für NVIDIA-GPUs herunter. Dieser ersetzt den CPU-Sidecar, solange er aktiv ist. Der CPU-Sidecar bleibt als Ausweichlösung installiert.',
  'setup.sidecar.cuda.install.primaryButton': 'CUDA-Sidecar herunterladen',
  'setup.sidecar.cuda.install.success': 'CUDA sidecar installiert und gestartet.',
  'setup.sidecar.cuda.install.title': 'CUDA-Beschleunigung installieren',
  'setup.sidecar.mac.firstRun.body':
    'Local Dictation benötigt einen einmaligen Download seiner Speech-to-Text-Engine aus den GitHub-Versionen. Nach der Installation läuft die Transkription vollständig auf Ihrem Mac – Audio verlässt nie Ihren Computer.',
  'setup.sidecar.mac.firstRun.primaryButton': 'Sidecar herunterladen',
  'setup.sidecar.mac.firstRun.success': 'Local Dictation sidecar installiert und gestartet.',
  'setup.sidecar.mac.firstRun.title': 'Beenden Sie die Einrichtung von Local Dictation',
  'setup.sidecar.mac.install.body':
    'Laden Sie die Speech-to-Text-Engine aus den GitHub-Versionen herunter. Nach Abschluss dieses Vorgangs wird die Transkription lokal auf Ihrem Mac ausgeführt.',
  'setup.sidecar.mac.install.primaryButton': 'Sidecar herunterladen',
  'setup.sidecar.mac.install.success': 'Sidecar installiert und gestartet.',
  'setup.sidecar.mac.install.title': 'Sidecar installieren',
  'setup.sidecar.mac.reinstall.body':
    'Laden Sie die Speech-to-Text-Engine der GitHub-Versionen erneut herunter. Dies ersetzt die aktuelle Installation.',
  'setup.sidecar.mac.reinstall.primaryButton': 'Sidecar erneut herunterladen',
  'setup.sidecar.mac.reinstall.success': 'Sidecar neu installiert und neu gestartet.',
  'setup.sidecar.mac.reinstall.title': 'Sidecar neu installieren',
  'setup.sidecar.update.body':
    'Laden Sie das aktuelle {engineLabel} herunter, um dieser Version von Local Dictation zu entsprechen. Vorhandene Installationen werden vor Ort ersetzt.',
  'setup.sidecar.update.engine.cpuAndCuda': 'Sprach-Engines CPU und CUDA',
  'setup.sidecar.update.engine.cuda': 'CUDA Sprach-Engine',
  'setup.sidecar.update.engine.default': 'Sprach-Engine',
  'setup.sidecar.update.primaryButton_one': 'Sprach-Engine aktualisieren',
  'setup.sidecar.update.primaryButton_other': 'Sprach-Engines aktualisieren',
  'setup.sidecar.update.success_one':
    'Local Dictation-Sprach-Engine aktualisiert und neu gestartet.',
  'setup.sidecar.update.success_other':
    'Local Dictation-Sprach-Engines aktualisiert und neu gestartet.',
  'setup.sidecar.update.title_one': 'Sprach-Engine aktualisieren',
  'setup.sidecar.update.title_other': 'Sprach-Engines aktualisieren',
  'audio.microphone.permissionDeniedMac':
    'Mikrofonberechtigung verweigert. Öffnen Sie Systemeinstellungen → Datenschutz und Sicherheit → Mikrofon, aktivieren Sie Obsidian, starten Sie Obsidian neu und versuchen Sie es erneut.',
  'audio.microphone.permissionDenied':
    'Mikrofonberechtigung verweigert. Gewähren Sie den Zugriff in Ihren Betriebssystemeinstellungen und versuchen Sie es erneut.',
  'audio.microphone.notFound':
    'Kein Mikrofon erkannt. Schließen Sie ein Mikrofon oder ein USB-Headset an oder aktivieren Sie ein Eingabegerät in den Soundeinstellungen Ihres Betriebssystems und versuchen Sie es dann erneut.',
  'audio.microphone.notReadable':
    'Mikrofon konnte nicht geöffnet werden. Möglicherweise wird es von einer anderen App verwendet oder das Audiogerät weist einen Fehler auf. Schließen Sie andere Apps mit dem Mikrofon und versuchen Sie es erneut.',
  'audio.systemAudio.notReady': 'Systemaudio ist nicht bereit.',
  'audio.systemAudio.outdatedInstaller':
    '{message} Ihr Obsidian-Installationsprogramm ist älter als die System-Audio-Berechtigung macOS. Laden Sie ein neues Installationsprogramm von obsidian.md herunter, installieren Sie es erneut und versuchen Sie es dann erneut.',
  'commands.toggleDictation': 'Diktat umschalten',
  'commands.startDictation': 'Diktat starten',
  'commands.stopDictation': 'Diktat stoppen',
  'commands.cancelDictation': 'Diktat abbrechen',
  'commands.reinsertLastUtterance': 'Letzte Äußerung erneut einfügen',
  'commands.clearLastUtterance': 'Letzte Äußerung löschen',
  'commands.restoreRawTranscript': 'Rohtranskript wiederherstellen',
  'commands.copyRawTranscript': 'Rohtranskript kopieren',
  'commands.clearRawRecovery': 'Rohtranskript-Wiederherstellung löschen',
  'commands.checkSidecarHealth': 'Sidecar-Zustand prüfen',
  'commands.restartSidecar': 'Sidecar neu starten',
  'common.reset': 'Zurücksetzen',
  'settings.acceleration.pending': 'ausstehend (sidecar nicht bereit)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} nicht verfügbar)',
  'settings.acceleration.unknownReason': 'unbekannter Grund',
  'settings.dictationLanguage.autoDetect': 'Automatische Erkennung',
  'settings.dictationLanguage.name': 'Diktatsprache',
  'settings.dictationLanguage.englishOnlyDesc':
    'Das ausgewählte Modell {model} unterstützt nur Englisch.',
  'settings.dictationLanguage.desc':
    'Wählen Sie die Sprache, die Sie sprechen möchten. Die manuelle Auswahl ermöglicht die vorhersehbarste Bereinigung. Die automatische Erkennung startet möglicherweise langsamer und wählt eine Sprache pro Äußerung aus.',
  'settings.dictationLanguage.unsupported': '{language} (nicht unterstützt)',
  'settings.engine.named': '{engine}-Engine',
  'settings.groups.model': 'Modell',
  'settings.groups.capture': 'Aufnahme',
  'settings.groups.transcriptOutput': 'Transkriptausgabe',
  'settings.groups.timestamps': 'Zeitstempel',
  'settings.groups.llmTransformation': 'LLM-Transformation',
  'settings.groups.engine': 'Engine',
  'settings.groups.advanced': 'Erweitert',
  'settings.listeningMode.alwaysOn': 'Immer an',
  'settings.listeningMode.oneSentence': 'Ein Satz',
  'settings.listeningMode.name': 'Hörmodus',
  'settings.listeningMode.desc': 'Kontinuierlich oder nach einem Satz stoppen.',
  'settings.insertText.atCursor': 'Am Cursor',
  'settings.insertText.endOfNote': 'Ende der Notiz',
  'settings.insertText.name': 'Text einfügen',
  'settings.insertText.desc': 'Wo diktierter Text erscheint.',
  'settings.transcriptFormatting.smartParagraphs': 'Intelligente Absätze',
  'settings.transcriptFormatting.space': 'Leerzeichen',
  'settings.transcriptFormatting.newLine': 'Neue Zeile',
  'settings.transcriptFormatting.newParagraph': 'Neuer Absatz',
  'settings.transcriptFormatting.name': 'Transkriptformatierung',
  'settings.transcriptFormatting.desc': 'Wie Phrasen zusammengefügt werden.',
  'settings.phraseFinalization.responsiveOption': 'Reaktionsfreudig – kurze Pausen',
  'settings.phraseFinalization.balancedOption': 'Ausgewogen – Standard',
  'settings.phraseFinalization.patientOption': 'Geduldig – lange Pausen',
  'settings.phraseFinalization.name': 'Finalisierung der Phrase',
  'settings.phraseFinalization.responsive':
    'Wird nach kürzeren Pausen abgeschlossen, um den Text schneller fertigzustellen.',
  'settings.phraseFinalization.balanced':
    'Verwendet die standardmäßige Pausentoleranz für das alltägliche Diktat.',
  'settings.phraseFinalization.patient':
    'Wartet längere Pausen ab, damit ein Gedanke weniger wahrscheinlich geteilt wird.',
  'settings.phraseFinalization.tooltip':
    'Gilt für alle Transkriptionsmodelle. Live-Wörter können noch aktualisiert werden, bevor die Phrase abgeschlossen ist. Dies ändert die Grenzen der Sprachaktivität, nicht den Schreibstil oder die Modellgenauigkeit. Reaktionsfreudig bevorzugt Geschwindigkeit; Geduldig hält Pausen eher innerhalb einer Phrase.',
  'settings.systemAudio.name': 'Systemaudio einbinden',
  'settings.systemAudio.desc':
    'Erfassen Sie außerdem die Standard-Audioausgabe dieses Computers für Besprechungen, Anrufe und Videos.',
  'settings.systemAudio.ready': 'Systemaudio ist bereit.',
  'settings.systemAudio.testFailed':
    'Systemaudio konnte nicht getestet werden. Überprüfen Sie, ob die Sprach-Engine installiert ist, und versuchen Sie es erneut.',
  'settings.speakerLabels.name': 'Sprecherbezeichnungen',
  'settings.speakerLabels.desc': 'Beschriften Sie jeden Satz nach Sprecher.',
  'settings.speakerLabels.streamingLimitation': 'Sprecherbezeichnungen erfordern ein Batch-Modell.',
  'settings.speakerLabels.modal.title': 'Einstellungen für Sprecherbezeichnungen',
  'settings.speakerLabels.modal.intro':
    'Nach jeder spracherkannten Phrase werden Sprecherbezeichnungen auf dem Gerät ausgeführt. Sie erfordern ein Batch-Transkriptionsmodell.',
  'settings.speakerLabels.maximumSpeakers.name': 'Maximale Sprecherzahl',
  'settings.speakerLabels.maximumSpeakers.desc':
    'Automatisch ermittelt die Anzahl der Sprecher. Legen Sie nur dann eine Grenze fest, wenn zusätzliche Sprecherbezeichnungen angezeigt werden.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Aktivieren Sie Sprecherbezeichnungen, bevor Sie eine Sprechergrenze festlegen.',
  'settings.speakerLabels.automatic': 'Automatisch',
  'settings.timestamps.enable.name': 'Verwenden Sie Zeitstempel',
  'settings.timestamps.enable.desc':
    'Fügen Sie Zeitstempel-Orientierungspunkte zu diktierten Transkripten hinzu.',
  'settings.timestamps.modal.title': 'Zeitstempeleinstellungen',
  'settings.timestamps.modal.intro':
    'Wählen Sie Orientierungspunkte in Abständen, Phrasengrenzen oder intelligente Absatzumbrüche.',
  'settings.timestamps.clock.elapsed': 'Vergangen',
  'settings.timestamps.clock.wallClock': 'Wanduhr',
  'settings.timestamps.frequency.atIntervals': 'In Abständen',
  'settings.timestamps.frequency.everyPhrase': 'Jeder Satz',
  'settings.timestamps.frequency.atParagraphBreaks': 'Bei Absatzumbrüchen',
  'settings.timestamps.sessionHeader.name': 'Sitzungsheader',
  'settings.timestamps.sessionHeader.desc':
    'Beginnen Sie jede Sitzung mit Zeitstempel mit [JJJJ-MM-TT HH:MM].',
  'settings.timestamps.referenceClock.name': 'Referenzuhr',
  'settings.timestamps.referenceClock.desc':
    'Verstrichene Zeit seit Beginn des Diktats oder lokale Uhrzeit.',
  'settings.timestamps.frequency.name': 'Frequenz',
  'settings.timestamps.frequency.desc': 'Wählen Sie aus, wie oft Zeitstempel angezeigt werden.',
  'settings.timestamps.frequency.sparseDesc':
    'Fügen Sie im konfigurierten Intervall lesbare Orientierungspunkte hinzu.',
  'settings.timestamps.frequency.everyPhraseDesc':
    'Fügen Sie vor jedem modellgesteuerten Segment einen Zeitstempel hinzu, sofern verfügbar, andernfalls bei jeder spracherkannten Phrase.',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    'Stellen Sie die Transkriptformatierung auf „Intelligente Absätze“ ein, um Absatzumbrüche zu erhalten.',
  'settings.timestamps.frequency.paragraphDesc':
    'Fügen Sie zu Beginn der Sitzung und bei jedem intelligenten Absatzumbruch einen Zeitstempel hinzu.',
  'settings.timestamps.interval.name': 'Intervall',
  'settings.timestamps.interval.desc': 'Sekunden zwischen Zeitstempelmarkierungen ({min}-{max}).',
  'settings.timestamps.interval.inactiveDesc':
    'Wird nur verwendet, wenn die Frequenz auf „In Intervallen“ eingestellt ist.',
  'settings.timestamps.interval.validation':
    'Geben Sie eine ganze Zahl von {min} bis {max} Sekunden ein.',
  'settings.smartParagraph.modal.title': 'Intelligente Absatzeinstellungen',
  'settings.smartParagraph.modal.intro':
    'Intelligente Absätze verwandeln längere Pausen in Zeilen- oder Absatzumbrüche. Diese Werte gelten nur, wenn die Transkriptformatierung auf „Intelligente Absätze“ eingestellt ist.',
  'settings.smartParagraph.lineBreakPause.name': 'Zeilenumbruchpause',
  'settings.smartParagraph.lineBreakPause.desc':
    'Sekunden vor einem einzelnen Zeilenumbruch ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Absatzpause',
  'settings.smartParagraph.paragraphPause.desc': 'Sekunden vor einem Absatzumbruch ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Aktivieren Sie die LLM-Funktionen',
  'settings.llm.enableFeatures.desc':
    'Machen Sie LLM-Transformationen verfügbar. Schalten Sie die Transformation in der Seitenleiste ein oder aus.',
  'settings.llm.enableRemote.name': 'Remote-LLM aktivieren',
  'settings.llm.enableRemote.desc':
    'Zulassen, dass Transkripttext und enthaltener Notizkontext an OpenRouter gesendet werden. Audio wird nie gesendet.',
  'settings.llm.restoreDefaults.name': 'Transformationsstandardwerte wiederherstellen',
  'settings.llm.restoreDefaults.desc':
    'Voreinstellung, Timing, Kontext, Mindestanzahl an Wörtern und Temperatur zurücksetzen. Gespeicherte Voreinstellungen und Modelle bleiben erhalten.',
  'settings.llm.restoreDefaults.button': 'Wiederherstellen',
  'settings.llm.restoreDefaults.confirmMessage':
    'Standardvorgabe, Timing, Kontext, Mindestanzahl an Wörtern und Temperatur wiederherstellen? Gespeicherte Voreinstellungen und Modelle bleiben erhalten.',
  'settings.llm.migratedPreset': 'Meine Voreinstellung',
  'settings.llm.migratedPresetNumbered': 'Mein Preset {number}',
  'settings.recoveryMemory.name': 'Behalten Sie den Wiederherstellungstext im Gedächtnis',
  'settings.recoveryMemory.desc':
    'Behalten Sie den neuesten wiederherstellbaren Text und Notizen-Snapshot im Speicher. Es wird nichts auf die Festplatte geschrieben.',
  'settings.modelStoreOverride.name': 'Überschreibung des Modellspeicherordners',
  'settings.modelStoreOverride.desc': 'Benutzerdefinierter Ordner für verwaltete Modell-Downloads.',
  'settings.modelStoreOverride.placeholder':
    'Verwenden Sie den gemeinsam genutzten Standardmodellspeicher',
  'settings.runSetup.name': 'Führen Sie das Setup aus',
  'settings.runSetup.desc': 'Führen Sie den Ersteinrichtungsassistenten erneut aus.',
  'settings.hardwareAcceleration.name': 'Hardwarebeschleunigung',
  'settings.hardwareAcceleration.desc': 'Inferenz auf der GPU ausführen, sofern verfügbar.',
  'settings.hardwareAcceleration.busy':
    'Die Hardwarebeschleunigung kann beim Diktieren nicht geändert werden.',
  'settings.hardwareAcceleration.on': 'Hardwarebeschleunigung aktiviert.',
  'settings.hardwareAcceleration.off': 'Hardwarebeschleunigung ausgeschaltet.',
  'settings.hardwareAcceleration.restartFailed':
    'Die Hardwarebeschleunigung wurde gespeichert, aber die Sprach-Engine konnte nicht neu gestartet werden. Starten Sie Obsidian neu, um es anzuwenden.',
  'settings.noteContext.name': 'Verwenden Sie die Notiz als Kontext',
  'settings.noteContext.desc':
    'Sendet bei manuell ausgewähltem Englisch markante Begriffe aus der offenen Notiz, um die Rechtschreibung zu verbessern.',
  'settings.noteContext.tooltip':
    'Sendet ein Glossar mit Eigennamen und Fachbegriffen als initialen Prompt der Engine. Wird nur bei manuell ausgewähltem Englisch mit Engines verwendet, die initiale Prompts unterstützen.',
  'settings.microphone.name': 'Mikrofon',
  'settings.microphone.desc':
    'Welches Mikrofon zum Diktieren verwendet werden soll. Änderungen gelten ab der nächsten Diktatsitzung.',
  'settings.microphone.default': 'Standardmikrofon',
  'settings.microphone.labelUnavailable': 'Mikrofon (Bezeichnung nicht verfügbar)',
  'settings.microphone.notConnected': '{microphone} (nicht verbunden)',
  'settings.microphone.detectTooltip': 'Mikrofone erkennen (bitte um Erlaubnis)',
  'settings.microphone.allowAccessFirst':
    'Erlauben Sie zuerst den Mikrofonzugriff, um dieses Gerät zu speichern.',
  'settings.microphone.stopDictationToDetect': 'Stoppen Sie das Diktat, um Mikrofone zu erkennen.',
  'settings.microphone.unavailableRuntime':
    'Der Mikrofonzugriff ist in dieser Laufzeit nicht verfügbar.',
  'settings.microphone.detectFailed':
    'Mikrofone konnten nicht erkannt werden. Überprüfen Sie Ihre Systemaudioeinstellungen.',
  'settings.microphone.fallbackSaveFailed':
    'Gespeichertes Mikrofon nicht verfügbar. Verwendung des Standardmikrofons, diese Änderung konnte jedoch nicht gespeichert werden. Wählen Sie in den Einstellungen ein verfügbares Mikrofon aus, bevor Sie Obsidian neu starten.',
  'settings.microphone.fallbackUnchanged':
    'Gespeichertes Mikrofon nicht verfügbar. Verwendung des Standardmikrofons für diese Sitzung; Die aktuelle Mikrofoneinstellung wurde unverändert gelassen.',
  'settings.microphone.fallbackCleared':
    'Gespeichertes Mikrofon nicht verfügbar. Verwendung des Standardmikrofons; Die gespeicherte Auswahl wurde für zukünftige Sitzungen gelöscht.',
  'settings.model.notInstalled': 'Nicht installiert',
  'settings.model.validatedExternal': 'Validiert · extern',
  'settings.model.external': 'Extern',
  'settings.model.checking': 'Überprüfung…',
  'settings.model.unavailable': 'Nicht verfügbar',
  'settings.model.noModel': 'Kein Modell',
  'settings.model.streaming': 'Streaming',
  'settings.model.manageModels': 'Modelle verwalten',
  'settings.model.useExternalFile': 'Externe Datei verwenden',
  'settings.model.details': 'Modelldetails',
  'settings.install.installingNamed': 'Installation: {name}',
  'settings.install.installingSidecar': 'Installieren: {variant} sidecar',
  'settings.install.installingSidecarMac': 'Installation von sidecar',
  'settings.install.cancelling': 'Wird abgebrochen...',
  'settings.install.cancel': 'Stornieren',
  'settings.missingSidecar.name': 'Richten Sie Local Dictation ein',
  'settings.missingSidecar.desc':
    'Local Dictation ist noch nicht fertig. Führen Sie den Setup-Assistenten aus, um die Sprach-Engine und ein Modell zu installieren.',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': '{variant} sidecar',
  'settings.sidecar.desc': 'Speech-to-Text-Engine.',
  'settings.sidecar.cpuName': 'CPU sidecar',
  'settings.sidecar.cpuDesc': 'Speech-to-Text-Engine. Erforderlich.',
  'settings.sidecar.gpuName': 'GPU sidecar',
  'settings.sidecar.cudaActive': 'CUDA Beschleunigung aktiv.',
  'settings.sidecar.cudaLibraryPath.name': 'CUDA Bibliothekspfad',
  'settings.sidecar.cudaLibraryPath.desc':
    'Optionaler Bibliothekssuchpfad für sidecar (Flatpak, benutzerdefinierte CUDA-Installationen).',
  'settings.sidecar.installAnyway': 'Trotzdem installieren',
  'settings.sidecar.installAnywayTooltip':
    'Fahren Sie mit der Installation von CUDA fort, auch wenn kein NVIDIA-Treiber erkannt wurde.',
  'settings.sidecar.stopBeforeInstall':
    'Stoppen Sie das Diktat, bevor Sie einen sidecar installieren — die Installation startet den Motor neu. Wenn ein Transkript noch verarbeitet wird, führen Sie "Diktat abbrechen" aus, um es jetzt zu stoppen.',
  'settings.sidecar.stopBeforeUpdate':
    'Stoppen Sie das Diktat, bevor Sie sidecars aktualisieren – das Update startet die Engine neu. Wenn ein Transkript noch verarbeitet wird, führen Sie „Diktat abbrechen“ aus, um es jetzt zu stoppen.',
  'settings.sidecar.stopBeforeUninstall':
    'Stoppen Sie das Diktat, bevor Sie {sidecar} deinstallieren. Wenn ein Transkript noch verarbeitet wird, führen Sie „Diktat abbrechen“ aus, um es jetzt zu stoppen.',
  'settings.sidecar.uninstallFailed':
    '{sidecar} konnte nicht deinstalliert werden. Schließen Sie andere Setup-Fenster und versuchen Sie es erneut.',
  'settings.sidecar.uninstalled': 'Sidecar deinstalliert.',
  'settings.sidecar.cudaUninstalled': 'CUDA sidecar deinstalliert. Läuft auf CPU.',
  'settings.sidecar.cpuUninstalled': 'CPU sidecar deinstalliert.',
  'settings.sidecar.restartFailed':
    'Die Sprach-Engine konnte nicht neu gestartet werden. Starten Sie Obsidian neu, bevor Sie diktieren.',
  'settings.sidecar.becameActive':
    'Das Diktat wurde aktiviert, bevor die sidecar-Dateien geändert werden konnten. Stoppen oder brechen Sie das Diktat ab und versuchen Sie es erneut.',
  'settings.sidecar.reinstall': 'Neu installieren',
  'settings.sidecar.uninstall': 'Deinstallieren',
  'settings.sidecar.install': 'Installieren',
  'settings.sidecar.driver.present': 'NVIDIA GPU erkannt — schnellere Transkription.',
  'settings.sidecar.driver.presentTooltip':
    'Lädt das CUDA sidecar-Archiv von den GitHub-Versionen herunter.',
  'settings.sidecar.driver.absent':
    'Erfordert einen NVIDIA GPU. Installieren Sie es trotzdem, wenn Sie wissen, dass Ihr Gerät unterstützt wird.',
  'settings.sidecar.driver.absentTooltip':
    'nvidia-smi wurde auf PATH nicht gefunden. Verwenden Sie „Trotzdem installieren“, wenn Sie sicher sind, dass Ihr System CUDA unterstützt.',
  'settings.sidecar.driver.unknown':
    'Konnte nicht nach NVIDIA suchen – installieren Sie es nur, wenn Sie sicher sind.',
  'settings.sidecar.driver.unknownTooltip':
    'Es konnte nicht nach einem NVIDIA-Treiber gesucht werden. Fahren Sie nur fort, wenn Sie wissen, dass Ihr GPU CUDA unterstützt.',
  'plugin.name': 'Local Dictation',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.duplicate': 'Duplizieren',
  'common.free': 'Kostenlos',
  'common.inherit': 'Übernehmen',
  'common.off': 'Aus',
  'common.on': 'An',
  'common.save': 'Speichern',
  'common.unavailable': 'Nicht verfügbar',
  'ribbon.idle': 'Local Dictation – Diktat starten',
  'ribbon.starting': 'Local Dictation – wird gestartet…',
  'ribbon.listening': 'Local Dictation – hört zu',
  'ribbon.speechDetected': 'Local Dictation – Sprache erkannt',
  'ribbon.error': 'Local Dictation – Fehler',
  'validation.wholeNumberRange': 'Geben Sie eine ganze Zahl von {min} bis {max} ein.',
  'validation.numberRange': 'Geben Sie eine Zahl von {min} bis {max} ein.',
  'llm.managedByPreset':
    'Verwaltet von „{preset}“. Bearbeiten Sie diese Voreinstellung, um diesen Wert zu ändern.',
  'llm.context.title': 'Kontexteinstellungen',
  'llm.context.settingsTooltip': 'Kontexteinstellungen',
  'llm.context.intro':
    'Mehr Kontext kann die Terminologie verbessern, kann jedoch die lokale Latenz oder die OpenRouter-Kosten erhöhen.',
  'llm.context.noteLength.name': 'Länge des Notizkontexts',
  'llm.context.noteLength.description':
    'Maximale Zeichenanzahl aus der aktuellen Notiz über dem Cursor.',
  'llm.context.previousPhrases.name': 'Vorherige Sätze',
  'llm.context.previousPhrases.description':
    'Kürzlich diktierte Phrasen, die als Gesprächsverlauf enthalten sind.',
  'llm.context.afterEachPhraseOnly':
    'Wird nur verwendet, wenn „Transformation ausführen“ auf „Nach jeder Phrase“ eingestellt ist.',
  'llm.context.limit.name': 'Kontextlimit',
  'llm.context.limit.description':
    'Maximale kombinierte Zeichen aus Notizkontext und vorherigen Phrasen.',
  'llm.context.useCurrentNote.name': 'Aktuelle Notiz als Kontext verwenden',
  'llm.context.useCurrentNote.description':
    'Fügen Sie in jede Eingabeaufforderung Text über dem Cursor ein.',
  'llm.model.title': 'Modelleinstellungen',
  'llm.model.settingsTooltip': 'Modelleinstellungen',
  'llm.model.temperature.name': 'Temperatur',
  'llm.model.temperature.description':
    'Probenahmevariation. 0 ist deterministisch; Höhere Werte sind vielfältiger.',
  'llm.model.remoteThreshold.name': 'Schwellenwert für Remote-Routing',
  'llm.model.remoteThreshold.description':
    'Transkriptlänge, die automatische Transformationen an OpenRouter (Zeichen) sendet.',
  'llm.model.remoteTimeout.name': 'Remote-Timeout',
  'llm.model.remoteTimeout.description':
    'Hören Sie nach diesen vielen Sekunden auf, auf OpenRouter zu warten. Das Originalprotokoll wird aufbewahrt.',
  'llm.model.behavior.name': 'Modellverhalten',
  'llm.model.summary.temperature': 'Temperatur {value}',
  'llm.model.summary.remoteThreshold': 'Remote bei {value}+ Zeichen',
  'llm.model.summary.timeout': '{value}s Zeitüberschreitung',
  'llm.failure.authInvalid':
    '{provider} API Schlüssel abgelehnt. Überprüfen Sie die Einstellungen.',
  'llm.failure.rateLimited': '{provider} Ratenlimit erreicht. Zurückgreifen auf Rohtext.',
  'llm.failure.network': 'Netzwerkfehler beim Erreichen von {provider}.',
  'llm.failure.modelNotConfigured':
    'Das {provider}-Modell ist nicht konfiguriert. Wählen Sie unter „Modell“ ein Modell aus.',
  'llm.failure.unknownModel':
    '{provider}-Modell nicht gefunden. Wählen Sie unter Modell ein anderes aus.',
  'llm.failure.unknown': 'LLM-Transformation fehlgeschlagen. Siehe Konsole.',
  'llm.status.selectOllamaModel': 'Wählen Sie unten ein Ollama-Modell aus.',
  'llm.status.selectOpenRouterModel': 'Wählen Sie unten ein OpenRouter-Modell aus.',
  'llm.status.ollamaNotRunning': 'Ollama läuft nicht.',
  'llm.status.unreachable': '{provider} ist nicht erreichbar.',
  'llm.status.authInvalid': '{provider} API Schlüssel abgelehnt.',
  'llm.status.rateLimited': '{provider} Ratenlimit erreicht.',
  'llm.status.noOllamaModels': 'In Ollama sind keine Chat-Modelle installiert.',
  'llm.status.noModels': 'Keine verwendbaren {provider}-Modelle gefunden.',
  'llm.status.selectedUnavailable': 'Das ausgewählte Modell ist nicht verfügbar.',
  'llm.timing.title': 'Timing-Einstellungen',
  'llm.timing.settingsTooltip': 'Timing-Einstellungen',
  'llm.timing.minimumWords.name': 'Minimale Wörter',
  'llm.timing.minimumWords.description':
    'Überspringen Sie die Transformation, wenn das Transkript weniger Wörter als diese enthält.',
  'llm.timing.timestamps.perUtterance':
    'Nach jeder Phrase werden die Zeitstempelgrenzen beibehalten.',
  'llm.timing.timestamps.batch':
    'Je nach Voreinstellung kann „Alle auf einmal“ Zeitstempel neu schreiben oder entfernen.',
  'llm.timing.option.perUtterance': 'Nach jedem Satz',
  'llm.timing.option.batch': 'Auf einmal auf Stopp',
  'llm.routing.local': 'Lokal',
  'llm.routing.remote': 'Remote',
  'llm.routing.auto': 'Auto',
  'llm.routing.ariaLabel': 'Ausführen von Transformationen mit',
  'llm.routing.localHint': 'Läuft mit Ollama vollständig auf Ihrem Gerät.',
  'llm.routing.remoteHint': 'Sendet jedes Transkript zur Transformation an OpenRouter.',
  'llm.routing.autoHint': 'Bleibt am Gerät und übergibt große Transkripte an OpenRouter.',
  'llm.routing.localLeg': 'Lokal · Ollama',
  'llm.routing.remoteLeg': 'Remote · OpenRouter',
  'llm.routing.priceTierTooltip': 'Ungefähre Preisstufe',
  'llm.routing.providerModel': '{provider}-Modell',
  'llm.routing.ollamaModelDescription': 'Wählen Sie ein lokales Ollama-Chat-Modell.',
  'llm.routing.selectModel': 'Wählen Sie ein Modell aus',
  'llm.routing.refreshModels': '{provider}-Modelle aktualisieren',
  'llm.routing.apiKey.name': 'OpenRouter API Schlüssel',
  'llm.routing.apiKey.description': 'Sicher aufbewahrt von Obsidian.',
  'llm.routing.openRouterModel.name': 'Modell OpenRouter',
  'llm.routing.openRouterModel.description':
    'Geben Sie ein, um nach OpenRouter-Modellen zu suchen.',
  'llm.routing.testConnection': 'Testen Sie den Schlüssel und das Modell API',
  'llm.sidebar.eyebrow': 'Transkript-Workflow',
  'llm.sidebar.title': 'Diktat umwandeln',
  'llm.sidebar.description':
    'Wählen Sie aus, wie gesprochener Text geformt wird, bevor er Ihre Notiz erreicht.',
  'llm.sidebar.group.preset': 'Voreinstellung',
  'llm.sidebar.group.model': 'Modell',
  'llm.sidebar.group.context': 'Kontext',
  'llm.sidebar.enabled.name': 'Aktiviert',
  'llm.sidebar.enabled.description':
    'Wenden Sie die aktive Voreinstellung auf neuen diktierten Text an.',
  'llm.sidebar.showOriginal.name': 'Originaltranskript anzeigen',
  'llm.sidebar.showOriginal.description':
    'Bewahren Sie es in einem zusammenklappbaren Callout unter jedem transformierten Ergebnis auf.',
  'llm.sidebar.runTransform.name': 'Transformation ausführen',
  'llm.sidebar.runTransform.description': 'Nach jedem Satz oder einmal beim Beenden ausführen.',
  'llm.sidebar.runTransform.setByPreset': 'Eingestellt von {preset} – {timing}.',
  'llm.sidebar.activePreset': 'Aktive Voreinstellung',
  'llm.sidebar.unavailable.title': 'LLM-Funktionen sind nicht verfügbar',
  'llm.sidebar.unavailable.description':
    'Aktivieren Sie die LLM-Funktionen in den Local Dictation-Einstellungen, um Transformationen zu konfigurieren.',
  'llm.sidebar.unavailable.summary': 'Aktivieren Sie die LLM-Funktionen in den Einstellungen',
  'llm.sidebar.off.title': 'RAW-Transkriptmodus',
  'llm.sidebar.off.description':
    'Diktat fügt das rohe lokale Transkript ein. Aktivieren Sie Transformieren, wenn Sie Bereinigungen, Neuschreibungen oder Zusammenfassungen wünschen.',
  'llm.sidebar.off.summary': 'Rohes Transkript',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Bereinigung',
  'llm.preset.builtin.cleanUp.description':
    'Beheben Sie Transkriptionsartefakte, Füller, Zeichensetzung und Großschreibung, während Stimme und Bedeutung erhalten bleiben.',
  'llm.preset.builtin.cleanUp.prompt':
    'Bereinigen Sie den diktierten Text. Korrigieren Sie Füllwörter, Fehlstarts, Wiederholungen, Zeichensetzung, Groß- und Kleinschreibung sowie offensichtliche Erkennungsfehler. Bewahren Sie Stimme und Bedeutung des Sprechers. Verwenden Sie den Referenzkontext nur für die Rechtschreibung. Schreiben Sie in der Originalsprache des Transkripts. Übersetzen Sie nur auf ausdrücklichen Wunsch des Benutzers. Geben Sie ausschließlich den bereinigten Text zurück, ohne Einleitung oder Kommentar.',
  'llm.preset.builtin.professionalWriting.label': 'Berufliches Texten',
  'llm.preset.builtin.professionalWriting.description':
    'Schreiben Sie Ihre Texte in prägnante, ausgefeilte Fachprosa um und behalten Sie dabei Fakten, Namen, Entscheidungen und Fachbegriffe bei.',
  'llm.preset.builtin.professionalWriting.prompt':
    'Schreiben Sie den diktierten Text als prägnante professionelle Prosa um. Verwenden Sie aktive Formulierungen ohne Füllwörter oder Relativierungen. Bewahren Sie alle Fakten, Namen und Begriffe. Verwenden Sie den Referenzkontext für die Rechtschreibung. Schreiben Sie in der Originalsprache des Transkripts. Übersetzen Sie nur auf ausdrücklichen Wunsch des Benutzers. Geben Sie ausschließlich den umgeschriebenen Text zurück, ohne Einleitung oder Kommentar.',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Fügen Sie über Ihrem unberührten Transkript eine kurze TLDR-Zusammenfassung hinzu.',
  'llm.preset.builtin.tldr.prompt':
    'Schreiben Sie eine TLDR-Zusammenfassung des diktierten Transkripts: eine „TLDR“-Überschrift, gefolgt von 1–3 kurzen Aufzählungszeichen, die die wichtigsten Punkte abdecken. Schreiben Sie in der Originalsprache des Transkripts. Übersetzen Sie niemals, es sei denn, der Benutzer fordert ausdrücklich eine Übersetzung an. Geben Sie nur die Überschrift und die Aufzählungszeichen zurück – wiederholen Sie nicht das Transkript, keine Einleitung, keinen Kommentar.',
  'llm.preset.builtin.markdownFormatting.label': 'Markdown-Formatierung',
  'llm.preset.builtin.markdownFormatting.description':
    'Formatieren Sie das Sitzungsprotokoll als strukturiertes Markdown mit Überschriften, Listen und Hervorhebungen neu.',
  'llm.preset.builtin.markdownFormatting.prompt':
    'Formatieren Sie den diktierten Text als gut strukturiertes Markdown. Fügen Sie bei Bedarf Überschriften, Aufzählungen oder nummerierte Listen, Fettdruck, Hervorhebungen und umschlossene Codeblöcke hinzu. Bereinigen Sie Füllwörter, Fehlstarts, Zeichensetzung und Großschreibung behutsam; bewahren Sie den Wortlaut des Sprechers sowie alle Fakten, Namen und Begriffe. Schreiben Sie in der Originalsprache des Transkripts. Übersetzen Sie nur auf ausdrücklichen Wunsch des Benutzers. Geben Sie ausschließlich Markdown zurück, ohne Einleitung oder Kommentar.',
  'llm.preset.builtin.actionItems.label': 'Aktionselemente',
  'llm.preset.builtin.actionItems.description':
    'Fügen Sie unter Ihrem unberührten Transkript eine Checkliste mit Aktionspunkten hinzu.',
  'llm.preset.builtin.actionItems.prompt':
    'Extrahieren Sie Aktionselemente aus dem diktierten Transkript. Geben Sie eine Überschrift „Aktionspunkte“ aus, gefolgt von einer Markdown-Checkliste mit konkreten Aufgaben, und nennen Sie einen Eigentümer, wenn der Sprecher einen erwähnt. Wenn das Transkript keine Aktionselemente enthält, wird nichts zurückgegeben. Schreiben Sie in der Originalsprache des Transkripts. Übersetzen Sie niemals, es sei denn, der Benutzer fordert ausdrücklich eine Übersetzung an. Geben Sie nur die Überschrift und die Checkliste zurück – wiederholen Sie nicht das Transkript, keine Einleitung, keinen Kommentar.',
  'llm.preset.timing.perUtterance': 'Läuft nach jeder Phrase',
  'llm.preset.timing.batch': 'Läuft einmal bei Stopp',
  'llm.preset.timing.either': 'Läuft in beiden Modi',
  'llm.preset.behavior.addAbove': 'fügt über dem Transkript neuen Inhalt hinzu',
  'llm.preset.behavior.addBelow': 'Fügt neuen Inhalt unterhalb des Transkripts hinzu',
  'llm.preset.behavior.replace': 'schreibt den diktierten Text neu',
  'llm.preset.behavior.overrides': 'überschreibt {fields}',
  'llm.preset.override.minimumWords': 'Mindestwörter',
  'llm.preset.override.temperature': 'Temperatur',
  'llm.preset.override.noteContext': 'Notizkontext',
  'llm.preset.option.perUtterance': '{preset} (nach jeder Phrase)',
  'llm.preset.option.batch': '{preset} (bei Stopp)',
  'llm.preset.copySuffix': ' (Kopie)',
  'llm.preset.copySuffixNumbered': '(Kopie {number})',
  'llm.preset.validation.nameRequired': 'Geben Sie einen Namen für diese Voreinstellung ein.',
  'llm.preset.validation.nameExists': 'Eine Voreinstellung mit diesem Namen ist bereits vorhanden.',
  'llm.preset.validation.promptRequired':
    'Geben Sie eine Eingabeaufforderung für diese Voreinstellung ein.',
  'llm.preset.validation.minimumWords':
    'Min. Wörter müssen eine ganze Zahl zwischen 0 und {max} sein.',
  'llm.preset.validation.temperature': 'Die Temperatur muss eine Zahl zwischen 0 und {max} sein.',
  'llm.preset.validation.maximumCount':
    'Sie können bis zu {max} Voreinstellungen speichern. Löschen Sie zuerst eine.',
  'llm.preset.validation.builtinName':
    'Dieser Name wird von einer integrierten Voreinstellung verwendet – wählen Sie einen anderen Namen.',
  'llm.preset.manager.title': 'Voreinstellungen verwalten',
  'llm.preset.manager.newTitle': 'Neue Voreinstellung',
  'llm.preset.manager.editTitle': 'Voreinstellung bearbeiten',
  'llm.preset.manager.presets.name': 'Voreinstellungen',
  'llm.preset.manager.presets.description':
    'Das aktive Preset ist markiert. Integrierte Voreinstellungen sind schreibgeschützt – duplizieren Sie eine, um sie anzupassen.',
  'llm.preset.manager.new': 'Neue Voreinstellung',
  'llm.preset.manager.searchPlaceholder': 'Voreinstellungen suchen...',
  'llm.preset.manager.noMatches': 'Keine Voreinstellungen entsprechen Ihrer Suche.',
  'llm.preset.manager.builtinHeading': 'Integriert',
  'llm.preset.manager.yoursHeading': 'Ihre Voreinstellungen',
  'llm.preset.manager.viewTooltip': 'Voreinstellung anzeigen',
  'llm.preset.manager.editTooltip': 'Voreinstellung bearbeiten',
  'llm.preset.manager.duplicateTooltip': 'Voreinstellung duplizieren',
  'llm.preset.manager.deleteTooltip': 'Voreinstellung „{preset}“ löschen',
  'llm.preset.manager.back': '← Alle Voreinstellungen',
  'llm.preset.editor.name': 'Name',
  'llm.preset.editor.namePlaceholder': 'z.B. Besprechungsnotizen',
  'llm.preset.editor.description': 'Beschreibung (optional)',
  'llm.preset.editor.descriptionPlaceholder': 'Wann diese Voreinstellung verwendet werden soll',
  'llm.preset.editor.prompt': 'Prompt',
  'llm.preset.editor.promptDescription': 'Wird als Systemaufforderung an das Modell gesendet.',
  'llm.preset.editor.promptSize':
    '~{tokens}-Token ({characters}-Zeichen) — mit jeder Anfrage gesendet',
  'llm.preset.editor.timing': 'Zeitpunkt',
  'llm.preset.editor.timingDescription':
    'Wenn die Transformation ausgeführt wird. „Entweder“ folgt dem Timing der Seitenleiste.',
  'llm.preset.editor.timingEither': 'Entweder (Seitenleiste folgen)',
  'llm.preset.editor.timingPerUtterance': 'Nach jedem Satz',
  'llm.preset.editor.timingBatch': 'Einmal auf Stopp',
  'llm.preset.editor.output': 'Ausgabe',
  'llm.preset.editor.outputDescription':
    'Durch Ersetzen wird Ihr diktierter Text neu geschrieben. „Hinzufügen“ lässt es unberührt und fügt neuen Inhalt ein.',
  'llm.preset.editor.outputReplace': 'Text ersetzen',
  'llm.preset.editor.outputAddAbove': 'Oberhalb des Transkripts hinzufügen',
  'llm.preset.editor.outputAddBelow': 'Unterhalb des Transkripts hinzufügen',
  'llm.preset.editor.overrides': 'Überschreibt',
  'llm.preset.editor.overridesDescription':
    'Lassen Sie ein Feld leer, um die globale Einstellung zu verwenden.',
  'llm.preset.editor.minimumWords': 'Mindestwörter',
  'llm.preset.delete.title': 'Voreinstellung löschen',
  'llm.preset.delete.message':
    'Voreinstellung „{preset}“ löschen? Dies kann nicht rückgängig gemacht werden.',
  'llm.preset.delete.activeFallback': '„{preset}“ war aktiv – auf „Aufräumen“ umgestellt.',
  'common.back': 'Zurück',
  'common.close': 'Schließen',
  'common.done': 'Erledigt',
  'common.install': 'Installieren',
  'common.later': 'Später',
  'common.next': 'Weiter',
  'common.remove': 'Entfernen',
  'common.tryAgain': 'Erneut versuchen',
  'setup.ready.waitForDictation':
    'Warten Sie, bis das aktuelle Diktat beendet ist, und versuchen Sie es dann erneut.',
  'setup.ready.openMarkdownNote':
    'Öffnen Sie eine Markdown-Notiz im Bearbeitungsmodus und versuchen Sie es dann erneut mit dem Diktieren.',
  'setup.ready.completionFailed':
    'Setup konnte nicht abgeschlossen werden. Versuchen Sie es erneut.',
  'setup.wizard.welcomeTitle': 'Willkommen bei Local Dictation',
  'setup.wizard.title': 'Richten Sie Local Dictation ein',
  'setup.wizard.engineReadyTitle': 'Sprachmodul bereit',
  'setup.wizard.engineReadyDesc': 'Die lokale Sprache-zu-Text-Engine ist installiert und bereit.',
  'setup.wizard.intro':
    'Diktieren Sie Notizen freihändig, direkt im Obsidian – vollständig auf Ihrem Gerät. Kein Konto, keine Cloud, keine Telemetrie.',
  'setup.wizard.quickSetup': 'Ein schnelles 2-Minuten-Setup:',
  'setup.wizard.downloadEngineStep': 'Laden Sie die Sprach-Engine herunter',
  'setup.wizard.pickModelStep': 'Wählen Sie ein Transkriptionsmodell',
  'setup.wizard.startTalking':
    'Drücken Sie dann das Mikrofon im Menüband (oder Ihren eigenen Hotkey) und beginnen Sie zu sprechen.',
  'setup.wizard.cpuBuildNote':
    'Beginnt mit dem CPU-Build. NVIDIA GPU? Sie können den CUDA-beschleunigten Build später in den Einstellungen installieren.',
  'setup.wizard.downloadEngine': 'Engine herunterladen',
  'setup.wizard.modelSelectedTitle': 'Modell ausgewählt',
  'setup.wizard.pickModelTitle': 'Wählen Sie ein Transkriptionsmodell',
  'setup.wizard.modelSelectedDesc':
    'Ein Transkriptionsmodell wird installiert und ausgewählt. Sie können mehr installieren oder später aus den Einstellungen wechseln.',
  'setup.wizard.modelIntro':
    'Installieren Sie ein Transkriptionsmodell, um das Diktat zu ermöglichen. Sie können später mehr installieren – kleinere Modelle sind schneller, größere Modelle sind genauer.',
  'setup.wizard.modelKinds':
    'Es stehen zwei Arten zur Verfügung: Streaming-Modelle zeigen Wörter live an, während Sie sprechen; Standardmodelle transkribieren nach jeder Pause. Beginnen Sie für freihändiges Diktieren mit dem empfohlenen Modell Moonshine Small. Nemotron 3.5 ASR ist eine experimentelle Streaming-Option mit höherem Ressourcenbedarf.',
  'setup.wizard.gpuNote':
    'Größere Modelle laufen mit der GPU-Beschleunigung viel schneller. Wenn Sie einen NVIDIA GPU haben, können Sie den CUDA-beschleunigten Build später in den Einstellungen installieren.',
  'setup.wizard.openModelPicker': 'Modellauswahl öffnen',
  'setup.wizard.readyTitle': 'Sie sind bereit zu diktieren',
  'setup.wizard.readyDesc':
    'Probieren Sie es in der aktuell geöffneten Markdown-Notiz aus. Sprechen Sie ein paar Worte und stoppen Sie dann über das Mikrofonsymbol in der Ribbon-Leiste oder mit Ihrem Hotkey.',
  'setup.wizard.ribbonTitle': 'Mikrofonsymbol in der Ribbon-Leiste verwenden',
  'setup.wizard.ribbonDesc':
    'Suchen Sie nach diesem Symbol im Obsidian-Band. Klicken Sie darauf, um mit dem Diktieren zu beginnen; klicken Sie erneut, um zu stoppen.',
  'setup.wizard.hotkeyTitle': 'Oder binden Sie eine Kurztaste',
  'setup.wizard.hotkeyDescBefore': 'Binden Sie eine Verknüpfung an die',
  'setup.wizard.toggleCommandName': 'Local Dictation: Diktat umschalten',
  'setup.wizard.hotkeyDescAfter': 'Befehl zum Starten und Stoppen von überall in Obsidian.',
  'setup.wizard.openHotkeySettings': 'Öffnen Sie die Hotkey-Einstellungen',
  'setup.wizard.tryDictationNow': 'Jetzt Diktat ausprobieren',
  'setup.wizard.openHotkeySettingsFallback':
    'Öffnen Sie Einstellungen → Hotkeys und suchen Sie nach „Local Dictation“.',
  'setup.sidecar.modal.download': 'Herunterladen',
  'setup.sidecar.modal.variantDownload': '{variant} herunterladen',
  'setup.sidecar.modal.version': 'Version',
  'setup.sidecar.modal.cancelling': 'Wird abgebrochen...',
  'setup.sidecar.modal.downloading': 'Herunterladen...',
  'setup.sidecar.modal.retryDownload': 'Versuchen Sie den Download erneut',
  'setup.sidecar.modal.installFailureNotice':
    'Die Installation der Sprach-Engine ist fehlgeschlagen. Öffnen Sie Setup oder Einstellungen erneut, um den Fehler zu überprüfen und es erneut zu versuchen.',
  'setup.sidecar.modal.startFailed':
    'Die sidecar-Installation konnte nicht gestartet werden. Schließen Sie andere Setup-Fenster und versuchen Sie es erneut.',
  'setup.sidecar.installCancelled': 'Sidecar-Installation abgebrochen.',
  'setup.sidecar.progress.variant': '{variant} sidecar ({current} von {total})',
  'setup.sidecar.progress.downloading': 'Wird heruntergeladen',
  'setup.sidecar.progress.verifying': 'Prüfsumme wird überprüft...',
  'setup.sidecar.progress.extracting': 'Archiv wird extrahiert...',
  'models.manage.title': 'Modelle verwalten',
  'models.manage.loadFailedTitle': 'Modelle konnten nicht geladen werden',
  'models.manage.loadFailedDesc':
    'Möglicherweise ist die Sprach-Engine nicht installiert oder reagiert nicht. Führen Sie das Setup erneut aus, um es neu zu installieren, oder versuchen Sie es erneut.',
  'models.manage.runSetup': 'Installation starten',
  'models.manage.loadingCatalog': 'Modellkatalog wird geladen…',
  'models.manage.loadCatalogFailed': 'Modellkatalog konnte nicht geladen werden.',
  'models.manage.noneAvailable': 'Für diesen Motor sind keine Modelle verfügbar.',
  'models.manage.unsupportedLanguage':
    ' · Unterstützt {language} nicht. Ändern Sie die Diktiersprache, um dieses Modell zu installieren oder zu verwenden.',
  'models.manage.use': 'Verwenden',
  'models.manage.selected': 'Ausgewählt',
  'models.manage.cancelling': 'Wird abgebrochen…',
  'models.manage.details': 'Details',
  'models.manage.installStartFailed':
    'Die Modellinstallation konnte nicht gestartet werden. Versuchen Sie es erneut.',
  'models.manage.selectFailed':
    'Das Modell konnte nicht ausgewählt werden. Überprüfen Sie, ob die Dateien verfügbar sind.',
  'models.manage.selectedNotice': 'Modell ausgewählt.',
  'models.manage.removeFailed':
    'Das Modell konnte nicht entfernt werden. Schließen Sie jeden Prozess mit seinen Dateien.',
  'models.manage.removedNotice': 'Modell entfernt.',
  'models.external.title': 'Externe Datei',
  'models.external.intro':
    'Externe Modelle sind für den erweiterten Gebrauch bestimmt. Local Dictation lädt diese Dateien nicht herunter, aktualisiert sie nicht und überprüft sie nicht.',
  'models.external.family.name': 'Modellfamilie',
  'models.external.family.desc':
    'Wählen Sie den Lader, der zum Modell passt. Die Familie wird nicht aus ihrem Dateinamen abgeleitet.',
  'models.external.path.name': 'Modelldateipfad',
  'models.external.path.desc':
    'Geben Sie den absoluten Pfad zum primären Modellartefakt ein. Es wird validiert, bevor diese Auswahl gespeichert wird.',
  'models.external.validateAndUse': 'Validieren und verwenden',
  'models.external.validating': 'Wird validiert',
  'models.external.selectedNotice': 'Externe Modelldatei validiert und ausgewählt.',
  'models.external.requirementsTitle': 'Dateianforderungen',
  'models.external.validation.notConfigured': 'Der Pfad der Modelldatei ist nicht konfiguriert.',
  'models.external.validation.notAbsolute':
    'Der Pfad der Modelldatei muss ein absoluter Pfad sein.',
  'models.external.validation.missing': 'Modelldateipfad existiert nicht: {path}',
  'models.external.validation.notFile':
    'Der Dateipfad des Modells muss auf eine Datei zeigen: {path}',
  'models.external.validation.selectEntryFile': 'Wählen Sie {filename} aus.',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR benötigt sein Artefakt encoder.int8.onnx. Wählen Sie encoder.int8.onnx aus dem angehefteten 560 ms Modellverzeichnis.',
  'models.external.validation.moonshineEntryFile':
    'Moonshine erfordert sein primäres frontend.ort-Artefakt. Wählen Sie frontend.ort aus dem Streaming-Modellverzeichnis aus.',
  'models.external.validation.generic': 'Die Sprach-Engine konnte dieses Modell nicht validieren.',
  'models.external.requirements.nemotron.entry':
    'Wählen Sie encoder.int8.onnx aus dem gepinnten Nemotron 3.5 ASR 560 ms int8-Export.',
  'models.external.requirements.nemotron.siblings':
    'Das gleiche Verzeichnis muss decoder.int8.onnx, joiner.int8.onnx und tokens.txt enthalten.',
  'models.external.requirements.nemotron.compatibility':
    'Andere Blockgrößen und ORT GenAI-Exporte sind mit diesem Adapter nicht kompatibel.',
  'models.external.requirements.moonshine.entry':
    'Wählen Sie frontend.ort aus einem Verzeichnis für Moonshine-v2-Streaming-ORT-Modelle.',
  'models.external.requirements.moonshine.siblings':
    'Das gleiche Verzeichnis muss encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json und tokenizer.bin enthalten.',
  'models.external.requirements.moonshine.compatibility':
    'Nicht-streamende Moonshine ONNX-Exporte sind nicht kompatibel.',
  'models.external.requirements.whisper.entry':
    'Wählen Sie eine whisper.cpp-kompatible GGML- oder GGUF-Modelldatei aus.',
  'models.external.requirements.whisper.validation':
    'Der Loader validiert den Dateiinhalt; Eine Dateinamenerweiterung allein stellt keine Kompatibilität her.',
  'models.external.requirements.whisper.language':
    'Whisper-Dateien mit .en-Gewichten sind nur auf Englisch verfügbar; mehrsprachige Gewichte zeigen den verifizierten Sprachwähler und die automatische Erkennung an.',
  'models.details.totalSize': 'Gesamtgröße',
  'models.details.source': 'Quelle',
  'models.details.license': 'Lizenz',
  'models.details.capabilities': 'Funktionen',
  'models.details.installPath': 'Installationspfad',
  'models.details.files': 'Dateien ({count})',
  'models.details.size': 'Größe',
  'models.capability.segmentTimestamps': 'Segment-Zeitstempel',
  'models.capability.wordTimestamps': 'Wort-Zeitstempel',
  'models.capability.initialPrompt': 'Initiale Eingabeaufforderung',
  'models.capability.streaming': 'Streaming',
  'models.capability.autoLanguageDetection': 'Automatische Spracherkennung',
  'models.capability.punctuation': 'Interpunktion',
  'models.capability.maxAudio': 'Max. Audio: {seconds}s',
  'models.capability.anyLanguage': 'Jede Sprache',
  'models.capability.englishOnly': 'Nur Englisch',
  'models.capability.languageCount': '{count} Sprachen',
  'models.capability.languageSelection': 'Sprachauswahl',
  'models.tag.fullPrecision': 'Volle Präzision',
  'models.tag.reducedSize': 'Reduzierte Größe',
  'models.progress.preparing': 'Installation wird vorbereitet',
  'models.progress.downloading': 'Herunterladen',
  'models.progress.verifying': 'Download wird verifiziert',
  'models.progress.validating': 'Modell wird validiert',
  'models.progress.installed': 'Modell installiert',
  'models.progress.cancelled': 'Modellinstallation abgebrochen',
  'models.progress.failed': 'Modellinstallation fehlgeschlagen',
  'models.progress.downloadingFile': '{filename} wird heruntergeladen',
  'models.progress.verifyingFile': 'Überprüfung von {filename}',
  'models.progress.fileCount': 'Datei {current} von {total}',
  'models.current.noneSelected': 'Kein Modell ausgewählt',
  'models.current.noneSelectedDesc':
    'Wählen Sie ein installiertes Modell oder validieren Sie eine externe Datei.',
  'models.current.notSelected': 'nicht ausgewählt',
  'models.current.externalFile': 'Externe Datei',
  'models.current.managedNotInstalled': 'Das ausgewählte verwaltete Modell ist nicht installiert.',
  'models.current.installed': 'Installiert',
  'models.current.notInstalled': 'Nicht installiert',
  'models.current.managedDownload': 'Verwalteter Download',
  'models.current.externalValidated': 'Extern validiert',
  'models.current.checking': 'Überprüfung',
  'models.current.externalUnavailableDesc':
    'Das externe Modell ist nicht verfügbar. Überprüfen Sie die Datei erneut, um Details anzuzeigen.',
  'models.current.unavailable': 'Nicht verfügbar',
  'models.current.validateBeforeDictating':
    'Validieren Sie die externe Modelldatei, bevor Sie diktieren.',
  'sidecarError.audio_too_long': 'Der Audioclip überschreitet die maximale Dauer für diese Engine.',
  'sidecarError.engine_inference_failed': 'Lokale Transkription fehlgeschlagen.',
  'sidecarError.internal_error': 'Die Sprach-Engine hat einen internen Fehler festgestellt.',
  'sidecarError.invalid_audio_buffer':
    'Der Audiopuffer war leer, als die Transkription gestartet wurde.',
  'sidecarError.invalid_audio_frame':
    'Die Sprach-Engine hat einen ungültigen Audio-Frame empfangen.',
  'sidecarError.invalid_diarization_speaker_limit':
    'Die maximale Sprecherzahl muss mindestens 1 betragen oder auf „Automatisch“ eingestellt sein.',
  'sidecarError.invalid_frame': 'Die Sprach-Engine hat einen ungültigen Protokollrahmen empfangen.',
  'sidecarError.invalid_model_file':
    'Die Modelldatei fehlt, ist nicht lesbar oder wird nicht unterstützt.',
  'sidecarError.invalid_model_task':
    'Das ausgewählte Modell kann nicht zum Diktieren verwendet werden.',
  'sidecarError.invalid_model_store': 'Der Modellspeicherordner ist nicht verfügbar oder ungültig.',
  'sidecarError.missing_model_file': 'Modelldatei existiert nicht oder ist keine normale Datei.',
  'sidecarError.no_active_install': 'Es gibt keine aktive Modellinstallation zum Abbrechen.',
  'sidecarError.no_active_session': 'Es gibt keine aktive Diktatsitzung.',
  'sidecarError.session_already_exists': 'Es existiert bereits eine Diktiersitzung mit dieser ID.',
  'sidecarError.session_capacity_exceeded':
    'Local Dictation verfügt bereits über die maximale Anzahl aktiver Sitzungen.',
  'sidecarError.system_audio_capture_failed': 'System-Audio-Capture konnte nicht gestartet werden.',
  'sidecarError.system_audio_permission_denied':
    'Die Berechtigung zur Systemaudioaufnahme ist für Obsidian deaktiviert. Öffnen Sie Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- und Systemaudioaufnahme, aktivieren Sie Obsidian und versuchen Sie es erneut.',
  'sidecarError.system_audio_unsupported':
    'System-Audio-Capture ist auf dieser Plattform noch nicht verfügbar. Leiten Sie die Ausgabe dieses Computers über ein virtuelles Audiogerät und wählen Sie es als Ihr Mikrofon aus — siehe Audioguide des Systems.',
  'sidecarError.transcription_failure': 'Die lokale Transkription ist fehlgeschlagen.',
  'sidecarError.unsupported_engine': 'Die angeforderte Engine ist in diesem Build nicht verfügbar.',
  'sidecarError.unsupported_language':
    'Das ausgewählte Modell unterstützt diese Diktiersprache nicht.',
  'sidecarError.utterance_dropped_during_overload_drain':
    'Eine abgeschlossene Äußerung wurde verworfen, während die Transkriptionswarteschlange geleert wurde.',
  'sidecarError.utterance_queue_overload':
    'Das Diktat wurde gestoppt, weil die Transkriptionswarteschlange überlastet ist. Akzeptierte Audiodaten werden verarbeitet.',
  'sidecarError.vad_error':
    'Die Erkennung der Sprachaktivität in einem Audio-Frame ist fehlgeschlagen.',
  'sidecarError.vad_init_failed': 'Das gebündelte Silero-VAD konnte nicht initialisiert werden.',
  'sidecarError.worker_panic':
    'Der Transkriptions-Worker der Sprach-Engine wurde unerwartet gestoppt.',
  'catalog.whisper_tiny_en_q8_0.summary':
    'Schnellstes Modell mit niedrigsten Ressourcenkosten. Gut zum Testen oder für Maschinen mit geringer Leistung.',
  'catalog.whisper_base_en_q8_0.summary':
    'Schnelles Modell mit ordentlicher Genauigkeit. Eine gute Wahl für schnelle Entwürfe auf CPU.',
  'catalog.whisper_small_en_q5_1.summary':
    'Gleicht Transkriptionsqualität, Downloadgröße und CPU-Geschwindigkeit aus.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Hochpräzises Modell für Benutzer, denen die Qualität der Transkription wichtiger ist als die Geschwindigkeit.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'Mehrsprachige, hochpräzise Transkription mit einer für die GPU-Beschleunigung optimierten Architektur.',
  'catalog.cohere_transcribe_fp16.summary':
    'Größte Cohere-Variante unter Beibehaltung der vollen Modellpräzision.',
  'catalog.cohere_transcribe_int8.summary':
    'Mittlere Cohere-Variante nach Download-Größe, unter Verwendung von 8-Bit-Quantisierung.',
  'catalog.cohere_transcribe_q4.summary':
    'Kleinste Cohere-Variante; 4-Bit-Quantisierung reduziert die Größe zu Qualitätskosten.',
  'catalog.moonshine_tiny_streaming_en.summary':
    'Schnellstes Moonshine-Streaming-Modell mit 34M-Parametern, entwickelt für Low-End-CPUs.',
  'catalog.moonshine_small_streaming_en.summary':
    'Ausgewogenes Live-Diktiermodell mit 123 Millionen Parametern.',
  'catalog.moonshine_medium_streaming_en.summary':
    'Genauestes Moonshine-Streaming-Modell mit 245 M Parametern.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'NVIDIAs mehrsprachiges RNNT mit 0,6 Milliarden Parametern, als int8-ONNX exportiert für cachegestützte Live-Transkription in acht geprüften Sprachen.',
  'catalog.family.whisper.summary':
    'Transkribiert nach jeder Pause. Whisper bietet genauere Zeitstempel als andere Modellfamilien, einschließlich optionaler Timing auf Wortebene. Tiny und Base begünstigen Geschwindigkeit, Small balanciert Geschwindigkeit und Qualität und Medium und Large begünstigen Qualität.',
  'catalog.family.cohere_transcribe.summary':
    'Hochwertige Batch-Transkription mit Download- und Speicherbedarf von mehreren Gigabyte.',
  'catalog.family.moonshine.summary':
    'Zeigt Wörter an, während du sprichst. Tiny begünstigt einen geringeren Ressourcenverbrauch, Small balanciert Geschwindigkeit und Qualität und Medium begünstigt Qualität.',
  'catalog.family.nemotron_asr.summary':
    'Experimentelles hochpräzises mehrsprachiges Streaming mit größerem Download und höherer Ressourcennutzung. Moonshine Small bleibt der empfohlene englische Live-Diktat-Standard.',
  'setup.sidecar.modal.unsupportedPlatform':
    'Dieser Sprach-Engine-Build ist für Ihre Plattform oder Architektur nicht verfügbar.',
  'setup.sidecar.modal.genericInstallError':
    'Die Sprach-Engine konnte nicht installiert werden. Überprüfen Sie die Plugin-Protokolle auf Details und versuchen Sie es dann erneut.',
  'commands.readAloud': 'Vorlesen',
  'commands.readEntireNote': 'Ganze Notiz vorlesen',
  'commands.pauseResumeReadAloud': 'Vorlesen pausieren oder fortsetzen',
  'commands.stopReadAloud': 'Vorlesen beenden',
  'settings.groups.readAloud': 'Vorlesen',
  'settings.readAloud.noModel': 'Kein Vorlesemodell ausgewählt',
  'settings.readAloud.modelDesc': 'Das lokale Modell zum Vorlesen von Notiztext.',
  'settings.readAloud.voice': 'Stimme',
  'settings.readAloud.voiceDesc': 'Wähle eine für das ausgewählte Modell installierte Stimme.',
  'settings.readAloud.noVoices': 'Keine installierten Stimmen',
  'settings.readAloud.speed': 'Lesegeschwindigkeit',
  'settings.readAloud.speedDesc':
    'Eine Änderung während des Vorlesens startet am aktuellen Satz neu.',
  'models.manage.dictationModels': 'Sprache zu Text',
  'models.manage.readAloudModels': 'Text zu Sprache',
  'models.manage.allLanguages': 'Alle Sprachen',
  'models.manage.familiesLabel': 'Modellfamilien',
  'models.manage.noneForLanguage': 'Für diese Aufgabe und Sprache sind keine Modelle verfügbar.',
  'models.manage.optionalVoice': 'Optionale lokale Stimme',
  'models.manage.voiceInstalled': 'Installiert',
  'tts.status.reading': 'Wird vorgelesen…',
  'tts.status.paused': 'Vorlesen pausiert',
  'tts.notice.noText': 'Hier gibt es keinen vorlesbaren Text.',
  'tts.notice.modelRequired': 'Installiere und wähle zuerst ein Vorlesemodell.',
  'tts.notice.voiceRequired': 'Wähle zuerst eine installierte Stimme.',
  'tts.notice.startFailed': 'Vorlesen konnte nicht gestartet werden.',
  'tts.notice.playbackFailed': 'Audiowiedergabe fehlgeschlagen.',
  'tts.notice.sidecarExited':
    'Das Vorlesen wurde beendet, weil der Sidecar unerwartet beendet wurde.',
  'sidecarError.invalid_synthesis_request': 'Die Vorleseanfrage ist ungültig.',
  'sidecarError.missing_voice_file': 'Die ausgewählte Vorlesestimme ist nicht installiert.',
  'sidecarError.sidecar_exited': 'Der Sidecar-Prozess wurde unerwartet beendet.',
  'sidecarError.synthesis_cancelled': 'Das Vorlesen wurde abgebrochen.',
  'sidecarError.synthesis_failed': 'Die lokale Sprachsynthese ist fehlgeschlagen.',
  'sidecarError.synthesis_worker_unavailable':
    'Der lokale Sprachsynthese-Worker ist nicht verfügbar.',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Natürliches lokales Vorlesen auf Englisch mit auswählbaren Stimmen.',
  'catalog.family.pocket_tts.summary':
    'Liest Notizen lokal auf Englisch, Französisch, Deutsch, Spanisch, Portugiesisch und Italienisch mit auswählbaren Stimmen und tonhöhentreuer Geschwindigkeitssteuerung vor.',
} as const satisfies TranslationCatalog;
