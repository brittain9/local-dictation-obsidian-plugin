import type { TranslationCatalog } from '.';

export const es = {
  'notice.dictationNotActive': 'El dictado no está activo actualmente.',
  'notice.dictationStartFailed': 'No se pudo iniciar el dictado.',
  'notice.dictationStopFailed': 'No se pudo detener el dictado.',
  'notice.lastUtteranceCleared': 'Se borró la última frase retenida.',
  'notice.lastUtteranceReinsertFailed': 'No se pudo volver a insertar la última frase finalizada.',
  'notice.lastUtteranceReinserted': 'Se reinsertó la última frase finalizada.',
  'notice.lastUtteranceUnavailable': 'No hay ninguna frase finalizada disponible para reinsertar.',
  'notice.llmTransformEmpty': 'La transformación LLM no devolvió nada que agregar.',
  'notice.microphoneDisconnected':
    'Micrófono desconectado. El dictado se detuvo y terminará de procesar el audio ya capturado. Vuelva a conectar el micrófono y luego comience a dictar nuevamente.',
  'notice.rawTranscriptChanged':
    'No se pudo restaurar la transcripción sin procesar porque la nota cambió después de la limpieza.',
  'notice.rawTranscriptCleared': 'Se borró la recuperación de la transcripción sin procesar.',
  'notice.rawTranscriptCopied': 'Se copió la transcripción sin procesar.',
  'notice.rawTranscriptCopyFailed': 'No se pudo copiar la transcripción sin procesar.',
  'notice.rawTranscriptRestored': 'Se restauró la transcripción sin procesar.',
  'notice.rawTranscriptRestoreFailed': 'No se pudo restaurar la transcripción sin procesar.',
  'notice.rawTranscriptTargetUnavailable':
    'No se pudo restaurar la transcripción sin procesar porque su nota original ya no está abierta en el mismo editor.',
  'notice.rawTranscriptUnavailable':
    'No hay recuperación de transcripción sin procesar disponible.',
  'notice.sidecarHealthCheckFailed': 'Error en la comprobación de estado de Sidecar',
  'notice.sidecarReady': 'Sidecar está listo ({version}).',
  'notice.sidecarRestarted': 'Se reinició sidecar ({version}).',
  'notice.sidecarRestartFailed': 'Error al reiniciar Sidecar',
  'notice.sidecarRestartRequiresIdle':
    'Reinicie el sidecar solo cuando el dictado y la lectura estén inactivos.',
  'notice.transcriptRecordFailed': 'No se pudo grabar la transcripción.',
  'notice.sidecarSessionError': 'El motor de voz informó un error.',
  'notice.sidecarVersionDrift.actionMultiple': 'Actualizar motores de voz',
  'notice.sidecarVersionDrift.actionOne': 'Actualizar motor de voz',
  'notice.sidecarVersionDrift.cpu':
    'Speech Kit se actualizó a {version}, pero el motor de voz instalado está desactualizado. Actualícelo ahora para mantenerlos sincronizados.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Speech Kit se actualizó a {version}, pero los motores de voz CPU y CUDA instalados están desactualizados. Actualícelos ahora para mantenerlos sincronizados.',
  'notice.sidecarVersionDrift.cuda':
    'Speech Kit se actualizó a {version}, pero el motor de voz CUDA instalado está desactualizado. Actualícelo ahora para mantenerlos sincronizados.',
  'notice.surfaceDesynchronized':
    'El dictado se detuvo porque la nota cambió de una manera que Speech Kit no pudo rastrear con seguridad. Inicie el dictado nuevamente para continuar.',
  'notice.targetNoteClosed':
    'El dictado se detuvo porque la nota de destino se cerró o se reemplazó. Inicie el dictado nuevamente para continuar.',
  'notice.targetNoteDeleted':
    'El dictado se detuvo porque se eliminó la nota de destino. Restaure o vuelva a crear la nota y luego comience a dictar nuevamente.',
  'notice.transcriptWriteFailed':
    'El dictado se detuvo porque Speech Kit no pudo escribir la nota de forma segura. Inicie el dictado nuevamente para continuar.',
  'setup.sidecar.cpu.firstRun.body':
    'Speech Kit necesita una descarga única del motor de voz a texto CPU de las versiones GitHub. La transcripción se ejecuta localmente en su máquina una vez que se completa. Puede instalar la aceleración CUDA más tarde desde la configuración.',
  'setup.sidecar.cpu.firstRun.primaryButton': 'Descargar CPU sidecar',
  'setup.sidecar.cpu.firstRun.success': 'Speech Kit sidecar instalado e iniciado.',
  'setup.sidecar.cpu.firstRun.title': 'Terminar de configurar Speech Kit',
  'setup.sidecar.cpu.install.body':
    'Descargue el motor de voz a texto CPU de las versiones GitHub. La transcripción se ejecuta localmente en su máquina una vez que se completa.',
  'setup.sidecar.cpu.install.primaryButton': 'Descargar CPU sidecar',
  'setup.sidecar.cpu.install.success': 'CPU sidecar instalado e iniciado.',
  'setup.sidecar.cpu.install.title': 'Instalar CPU sidecar',
  'setup.sidecar.cpu.reinstall.body':
    'Vuelva a descargar el motor de voz a texto CPU de las versiones GitHub. Esto reemplaza la instalación actual de CPU.',
  'setup.sidecar.cpu.reinstall.primaryButton': 'Volver a descargar CPU sidecar',
  'setup.sidecar.cpu.reinstall.success': 'CPU sidecar reinstalado y reiniciado.',
  'setup.sidecar.cpu.reinstall.title': 'Reinstale CPU sidecar',
  'setup.sidecar.cuda.install.primaryButton': 'Descargar CUDA sidecar',
  'setup.sidecar.cuda.install.success': 'CUDA sidecar instalado e iniciado.',
  'setup.sidecar.cuda.install.title': 'Instalar aceleración CUDA',
  'setup.sidecar.mac.firstRun.body':
    'Speech Kit necesita una descarga única de su motor de voz a texto de las versiones GitHub. Una vez instalada, la transcripción se ejecuta completamente en tu Mac: el audio nunca sale de tu máquina.',
  'setup.sidecar.mac.firstRun.primaryButton': 'Descargar sidecar',
  'setup.sidecar.mac.firstRun.success': 'Speech Kit sidecar instalado e iniciado.',
  'setup.sidecar.mac.firstRun.title': 'Terminar de configurar Speech Kit',
  'setup.sidecar.mac.install.body':
    'Descargue el motor de voz a texto de las versiones GitHub. La transcripción se ejecuta localmente en su Mac una vez que se completa.',
  'setup.sidecar.mac.install.primaryButton': 'Descargar sidecar',
  'setup.sidecar.mac.install.success': 'Sidecar instalado e iniciado.',
  'setup.sidecar.mac.install.title': 'Instalar sidecar',
  'setup.sidecar.mac.reinstall.body':
    'Vuelva a descargar el motor de voz a texto de las versiones GitHub. Esto reemplaza la instalación actual.',
  'setup.sidecar.mac.reinstall.primaryButton': 'Volver a descargar sidecar',
  'setup.sidecar.mac.reinstall.success': 'Sidecar reinstalado y reiniciado.',
  'setup.sidecar.mac.reinstall.title': 'Reinstale sidecar',
  'setup.sidecar.update.body':
    'Descargue el {engineLabel} actual para que coincida con esta versión de Speech Kit. Las instalaciones existentes se reemplazan en su lugar.',
  'setup.sidecar.update.engine.cpuAndCuda': 'Motores de voz CPU y CUDA',
  'setup.sidecar.update.engine.cuda': 'Motor de voz CUDA',
  'setup.sidecar.update.engine.default': 'motor de voz',
  'setup.sidecar.update.primaryButton_one': 'Actualizar motor de voz',
  'setup.sidecar.update.primaryButton_other': 'Actualizar motores de voz',
  'setup.sidecar.update.success_one': 'Motor de voz de Speech Kit actualizado y reiniciado.',
  'setup.sidecar.update.success_other': 'Motores de voz de Speech Kit actualizados y reiniciados.',
  'setup.sidecar.update.title_one': 'Actualizar motor de voz',
  'setup.sidecar.update.title_other': 'Actualizar motores de voz',
  'audio.microphone.permissionDeniedMac':
    'Permiso de micrófono denegado. Abra Configuración del sistema → Privacidad y seguridad → Micrófono, habilite Obsidian, luego reinicie Obsidian e intente nuevamente.',
  'audio.microphone.permissionDenied':
    'Permiso de micrófono denegado. Concede acceso en la configuración de tu sistema operativo e inténtalo de nuevo.',
  'audio.microphone.notFound':
    'No se detectó ningún micrófono. Conecte un micrófono o unos auriculares USB, o habilite un dispositivo de entrada en la configuración de sonido de su sistema operativo y vuelva a intentarlo.',
  'audio.microphone.notReadable':
    'No se pudo abrir el micrófono. Es posible que otra aplicación lo esté usando o que el dispositivo de audio tenga un error. Cierra otras aplicaciones usando el micrófono y vuelve a intentarlo.',
  'audio.systemAudio.notReady': 'El audio del sistema no está listo.',
  'audio.systemAudio.outdatedInstaller':
    '{message} Su instalador Obsidian es anterior al permiso de audio del sistema macOS. Descargue un instalador nuevo desde obsidian.md y reinstálelo, luego intente nuevamente.',
  'commands.toggleDictation': 'Alternar dictado',
  'commands.startDictation': 'Iniciar dictado',
  'commands.stopDictation': 'Detener dictado',
  'commands.cancelDictation': 'Cancelar dictado',
  'commands.reinsertLastUtterance': 'Reinsertar la última frase',
  'commands.clearLastUtterance': 'Borrar la última frase',
  'commands.restoreRawTranscript': 'Restaurar transcripción sin procesar',
  'commands.copyRawTranscript': 'Copiar transcripción sin procesar',
  'commands.clearRawRecovery': 'Borrar recuperación sin procesar',
  'commands.checkSidecarHealth': 'Comprobar el estado de sidecar',
  'commands.restartSidecar': 'Reiniciar sidecar',
  'common.reset': 'Restablecer',
  'settings.acceleration.pending': 'pendiente (sidecar no está listo)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} no disponible)',
  'settings.acceleration.unknownReason': 'razón desconocida',
  'settings.dictationLanguage.autoDetect': 'Detección automática',
  'settings.dictationLanguage.name': 'Idioma de dictado',
  'settings.dictationLanguage.englishOnlyDesc':
    'El modelo seleccionado, {model}, solo admite inglés.',
  'settings.dictationLanguage.desc':
    'Elija el idioma que hablará. La selección manual ofrece una limpieza más predecible. La detección automática puede tardar más en iniciarse y elige un idioma por frase.',
  'settings.dictationLanguage.unsupported': '{language} (no compatible)',
  'settings.engine.named': 'Motor {engine}',
  'settings.groups.model': 'Modelos',
  'settings.groups.capture': 'Captura',
  'settings.groups.transcriptOutput': 'Salida de transcripción',
  'settings.groups.llmTransformation': 'Transformación LLM',
  'settings.groups.engine': 'Motor',
  'settings.groups.advanced': 'Avanzado',
  'settings.listeningMode.alwaysOn': 'Siempre encendido',
  'settings.listeningMode.oneSentence': 'una frase',
  'settings.listeningMode.name': 'Modo de escucha',
  'settings.listeningMode.desc': 'Continuo o detenido después de una oración.',
  'settings.insertText.atCursor': 'En el cursor',
  'settings.insertText.endOfNote': 'Fin de la nota',
  'settings.insertText.name': 'Insertar texto',
  'settings.insertText.desc': 'Donde aparece el texto dictado.',
  'settings.transcriptFormatting.smartParagraphs': 'Párrafos inteligentes',
  'settings.transcriptFormatting.space': 'Espacio',
  'settings.transcriptFormatting.newLine': 'Nueva línea',
  'settings.transcriptFormatting.newParagraph': 'Punto y aparte',
  'settings.transcriptFormatting.name': 'Formato de transcripción',
  'settings.transcriptFormatting.desc': 'Cómo se unen las frases.',
  'settings.phraseFinalization.responsiveOption': 'Responsivo: pausas breves',
  'settings.phraseFinalization.balancedOption': 'Equilibrado - estándar',
  'settings.phraseFinalization.patientOption': 'Paciente: pausas largas',
  'settings.phraseFinalization.name': 'Finalización de frase',
  'settings.phraseFinalization.responsive':
    'Finaliza después de pausas más cortas para completar el texto más rápido.',
  'settings.phraseFinalization.balanced':
    'Utiliza la tolerancia de pausa estándar para el dictado diario.',
  'settings.phraseFinalization.patient':
    'Espera durante pausas más largas para que sea menos probable que un pensamiento se divida.',
  'settings.phraseFinalization.tooltip':
    'Se aplica a todos los modelos de transcripción. Las palabras en curso aún pueden actualizarse antes de que la frase sea definitiva. Esto cambia los límites de la actividad de voz, no el estilo de escritura ni la precisión del modelo. La opción Responsivo favorece la velocidad; Paciente favorece mantener las pausas dentro de una frase.',
  'settings.systemAudio.name': 'Incluir audio del sistema',
  'settings.systemAudio.desc':
    'Capture también la salida de audio predeterminada de esta computadora para reuniones, llamadas y videos.',
  'settings.systemAudio.ready': 'El audio del sistema está listo.',
  'settings.systemAudio.testFailed':
    'No se pudo probar el audio del sistema. Verifique que el motor de voz esté instalado e inténtelo nuevamente.',
  'settings.speakerLabels.name': 'Etiquetas de hablante',
  'settings.speakerLabels.desc': 'Etiqueta cada frase por hablante.',
  'settings.speakerLabels.streamingLimitation':
    'Las etiquetas de hablante requieren un modelo por lotes.',
  'settings.speakerLabels.modal.title': 'Configuración de etiquetas de hablante',
  'settings.speakerLabels.modal.intro':
    'Las etiquetas de hablante se generan en el dispositivo después de cada frase detectada por voz. Requieren un modelo de transcripción por lotes.',
  'settings.speakerLabels.maximumSpeakers.name': 'Número máximo de hablantes',
  'settings.speakerLabels.maximumSpeakers.desc':
    'Automático determina el número de hablantes. Establezca un límite solo si aparecen etiquetas de hablante adicionales.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Habilite las etiquetas de hablante antes de configurar un límite de hablantes.',
  'settings.speakerLabels.automatic': 'Automático',
  'settings.timestamps.enable.name': 'Usar marcas de tiempo',
  'settings.timestamps.enable.desc':
    'Agregue puntos de referencia de marca de tiempo a las transcripciones dictadas.',
  'settings.timestamps.modal.title': 'Configuración de marca de tiempo',
  'settings.timestamps.modal.intro':
    'Elija puntos de referencia a intervalos, límites de frases o saltos de párrafo inteligentes.',
  'settings.timestamps.clock.elapsed': 'Transcurrido',
  'settings.timestamps.clock.wallClock': 'Reloj de pared',
  'settings.timestamps.frequency.atIntervals': 'A intervalos',
  'settings.timestamps.frequency.everyPhrase': 'cada frase',
  'settings.timestamps.frequency.atParagraphBreaks': 'En los saltos de párrafo',
  'settings.timestamps.sessionHeader.name': 'encabezado de sesión',
  'settings.timestamps.sessionHeader.desc':
    'Inicie cada sesión con marca de tiempo con [AAAA-MM-DD HH:MM].',
  'settings.timestamps.referenceClock.name': 'Reloj de referencia',
  'settings.timestamps.referenceClock.desc':
    'Tiempo transcurrido desde que comenzó el dictado o hora del reloj de pared local.',
  'settings.timestamps.frequency.name': 'Frecuencia',
  'settings.timestamps.frequency.desc': 'Elija con qué frecuencia aparecen las marcas de tiempo.',
  'settings.timestamps.frequency.sparseDesc':
    'Agregue puntos de referencia legibles en el intervalo configurado.',
  'settings.timestamps.frequency.everyPhraseDesc':
    'Agregue una marca de tiempo antes de cada segmento cronometrado por el modelo cuando esté disponible; de ​​lo contrario, en cada frase detectada por voz.',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    'Configure el formato de transcripción en Párrafos inteligentes para obtener saltos de párrafo.',
  'settings.timestamps.frequency.paragraphDesc':
    'Agregue una marca de tiempo al inicio de la sesión y en cada salto de párrafo inteligente.',
  'settings.timestamps.interval.name': 'Intervalo',
  'settings.timestamps.interval.desc':
    'Segundos entre puntos de referencia de marca de tiempo ({min}-{max}).',
  'settings.timestamps.interval.inactiveDesc':
    'Se utiliza sólo cuando la frecuencia está configurada en A intervalos.',
  'settings.timestamps.interval.validation':
    'Ingrese un número entero desde {min} hasta {max} segundos.',
  'settings.smartParagraph.modal.title': 'Configuración de párrafo inteligente',
  'settings.smartParagraph.modal.intro':
    'Los párrafos inteligentes convierten pausas más largas en saltos de línea o de párrafo. Estos valores se aplican solo cuando el formato de transcripción está configurado en Párrafos inteligentes.',
  'settings.smartParagraph.lineBreakPause.name': 'Pausa de salto de línea',
  'settings.smartParagraph.lineBreakPause.desc':
    'Segundos antes de un salto de línea ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Pausa de párrafo',
  'settings.smartParagraph.paragraphPause.desc':
    'Segundos antes de un salto de párrafo ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Habilitar funciones LLM',
  'settings.llm.enableFeatures.desc':
    'Poner a disposición las transformaciones LLM. Activa o desactiva la transformación en la barra lateral.',
  'settings.llm.restoreDefaults.name': 'Restaurar los valores predeterminados de transformación',
  'settings.llm.restoreDefaults.desc':
    'Restablezca el valor preestablecido, el tiempo, el contexto, las palabras mínimas y la temperatura. Se conservan los ajustes preestablecidos y los modelos guardados.',
  'settings.llm.restoreDefaults.button': 'Restaurar',
  'settings.llm.restoreDefaults.confirmMessage':
    '¿Restaurar el valor preestablecido, el tiempo, el contexto, el mínimo de palabras y la temperatura predeterminados? Se conservan los ajustes preestablecidos y los modelos guardados.',
  'settings.llm.migratedPreset': 'Mi preajuste',
  'settings.llm.migratedPresetNumbered': 'Mi preajuste {number}',
  'settings.recoveryMemory.name': 'Mantener el texto de recuperación en la memoria',
  'settings.recoveryMemory.desc':
    'Mantenga en la memoria el último texto recuperable y la instantánea de notas. No se escribe nada en el disco.',
  'settings.modelStoreOverride.name': 'Anulación de carpeta de tienda de modelos',
  'settings.modelStoreOverride.desc':
    'Carpeta personalizada para descargas de modelos administrados.',
  'settings.modelStoreOverride.placeholder':
    'Utilice la tienda de modelos predeterminada compartida',
  'settings.runSetup.name': 'Ejecutar configuración',
  'settings.runSetup.desc': 'Vuelva a ejecutar el asistente de configuración inicial.',
  'settings.hardwareAcceleration.name': 'Aceleración de hardware',
  'settings.hardwareAcceleration.desc': 'Ejecute la inferencia en la GPU cuando esté disponible.',
  'settings.hardwareAcceleration.busy':
    'No se puede cambiar la aceleración del hardware mientras el dictado o la lectura en voz alta estén activos. Si el dictado sigue procesándose después de detenerlo, ejecute "Cancelar dictado".',
  'settings.hardwareAcceleration.on': 'Aceleración de hardware activada.',
  'settings.hardwareAcceleration.off': 'Aceleración de hardware desactivada.',
  'settings.noteContext.name': 'Usar nota como contexto',
  'settings.noteContext.desc':
    'Para inglés seleccionado manualmente, envía términos distintivos de la nota abierta para mejorar la ortografía.',
  'settings.noteContext.tooltip':
    'Envía un glosario de nombres propios y términos técnicos como indicación inicial del motor. Solo se usa para inglés seleccionado manualmente con motores que admiten indicaciones iniciales.',
  'settings.microphone.name': 'Micrófono',
  'settings.microphone.desc':
    'Qué micrófono usar para dictar. Los cambios se aplican en la próxima sesión de dictado.',
  'settings.microphone.default': 'Micrófono predeterminado',
  'settings.microphone.labelUnavailable': 'Micrófono (etiqueta no disponible)',
  'settings.microphone.notConnected': '{microphone} (no conectado)',
  'settings.microphone.detectTooltip': 'Detectar micrófonos (pide permiso)',
  'settings.microphone.allowAccessFirst':
    'Primero permita el acceso al micrófono para guardar este dispositivo.',
  'settings.microphone.stopDictationToDetect': 'Detener el dictado para detectar micrófonos.',
  'settings.microphone.unavailableRuntime':
    'El acceso al micrófono no está disponible en este tiempo de ejecución.',
  'settings.microphone.detectFailed':
    'No se pudieron detectar micrófonos. Verifique la configuración de audio de su sistema.',
  'settings.microphone.fallbackSaveFailed':
    'El micrófono guardado no está disponible. Usando el micrófono predeterminado, pero este cambio no se pudo guardar. Seleccione un micrófono disponible en Configuración antes de reiniciar Obsidian.',
  'settings.microphone.fallbackUnchanged':
    'El micrófono guardado no está disponible. Usando el micrófono predeterminado para esta sesión; la configuración actual del micrófono no se modificó.',
  'settings.microphone.fallbackCleared':
    'El micrófono guardado no está disponible. Usando el micrófono predeterminado; la selección guardada se borró para sesiones futuras.',
  'settings.model.notInstalled': 'No instalado',
  'settings.model.validatedExternal': 'Validado · externo',
  'settings.model.external': 'Externo',
  'settings.model.checking': 'Comprobando…',
  'settings.model.unavailable': 'No disponible',
  'settings.model.noModel': 'Sin modelo',
  'settings.model.streaming': 'Transmisión',
  'settings.model.manageModels': 'Administrar modelos',
  'settings.model.useExternalFile': 'Usar archivo externo',
  'settings.model.details': 'Detalles del modelo',
  'settings.install.installingNamed': 'Instalando: {name}',
  'settings.install.installingSidecar': 'Instalando sidecar {variant}',
  'settings.install.installingSidecarMac': 'Instalación de sidecar',
  'settings.install.cancelling': 'Cancelando...',
  'settings.install.cancel': 'Cancelar',
  'settings.missingSidecar.name': 'Configurar Speech Kit',
  'settings.missingSidecar.desc':
    'Speech Kit aún no está listo. Ejecute el asistente de configuración para instalar el motor de voz y un modelo.',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': 'Sidecar {variant}',
  'settings.sidecar.desc': 'Motor de voz a texto.',
  'settings.sidecar.cpuName': 'CPU sidecar',
  'settings.sidecar.cpuDesc': 'Motor de voz a texto. Requerido.',
  'settings.sidecar.gpuName': 'GPU sidecar',
  'settings.sidecar.cudaLibraryPath.name': 'Ruta de la biblioteca CUDA',
  'settings.sidecar.cudaLibraryPath.desc':
    'Ruta de búsqueda de biblioteca opcional para sidecar (Flatpak, instalaciones personalizadas de CUDA).',
  'settings.sidecar.installAnyway': 'Instalar de todos modos',
  'settings.sidecar.stopBeforeInstall':
    'Detenga el dictado o la lectura en voz alta antes de instalar un sidecar: la instalación reinicia el motor. Si el dictado sigue procesándose, ejecute "Cancelar dictado" para detenerlo ahora.',
  'settings.sidecar.stopBeforeUninstall':
    'Detenga el dictado o la lectura en voz alta antes de desinstalar {sidecar}. Si el dictado sigue procesándose, ejecute "Cancelar dictado" para detenerlo ahora.',
  'settings.sidecar.uninstallFailed':
    'No se pudo desinstalar {sidecar}. Cierra las demás ventanas de configuración e inténtalo de nuevo.',
  'settings.sidecar.uninstalled': 'Sidecar desinstalado.',
  'settings.sidecar.cudaUninstalled': 'CUDA sidecar desinstalado. Ejecutando en CPU.',
  'settings.sidecar.cpuUninstalled': 'CPU sidecar desinstalado.',
  'settings.sidecar.restartFailed':
    'El motor de voz no pudo reiniciarse. Reinicie Obsidian antes de dictar.',
  'settings.sidecar.reinstall': 'Reinstalar',
  'settings.sidecar.uninstall': 'Desinstalar',
  'settings.sidecar.install': 'Instalar',
  'plugin.name': 'Speech Kit',
  'common.cancel': 'Cancelar',
  'common.delete': 'Borrar',
  'common.duplicate': 'Duplicar',
  'common.free': 'Gratis',
  'common.inherit': 'Heredar',
  'common.off': 'Desactivado',
  'common.on': 'Activado',
  'common.save': 'Guardar',
  'common.unavailable': 'No disponible',
  'ribbon.idle': 'Speech Kit — iniciar dictado',
  'ribbon.starting': 'Speech Kit — empezando…',
  'ribbon.listening': 'Speech Kit - escuchando',
  'ribbon.speechDetected': 'Speech Kit — detectando voz',
  'ribbon.error': 'Speech Kit — error',
  'validation.wholeNumberRange': 'Ingrese un número entero desde {min} hasta {max}.',
  'validation.numberRange': 'Ingrese un número de {min} a {max}.',
  'llm.managedByPreset':
    'Gestionado por “{preset}”. Edite ese ajuste preestablecido para cambiar este valor.',
  'llm.context.title': 'Configuración de contexto',
  'llm.context.settingsTooltip': 'Configuración de contexto',
  'llm.context.intro':
    'Más contexto puede mejorar la terminología, pero puede aumentar la latencia local o el costo de OpenRouter.',
  'llm.context.noteLength.name': 'Longitud del contexto de la nota',
  'llm.context.noteLength.description':
    'Máximo de caracteres tomados de la nota actual encima del cursor.',
  'llm.context.previousPhrases.name': 'Frases anteriores',
  'llm.context.previousPhrases.description':
    'Frases dictadas recientes incluidas como historial de conversación.',
  'llm.context.afterEachPhraseOnly':
    'Se usa solo cuando Ejecutar transformación está configurado en Después de cada frase.',
  'llm.context.limit.name': 'Límite de contexto',
  'llm.context.limit.description':
    'Máximo de caracteres combinados del contexto de la nota y frases anteriores.',
  'llm.context.useCurrentNote.name': 'Usar la nota actual como contexto',
  'llm.context.useCurrentNote.description': 'Incluya texto encima del cursor en cada mensaje.',
  'llm.model.title': 'Configuración del modelo',
  'llm.model.settingsTooltip': 'Configuración del modelo',
  'llm.model.temperature.name': 'Temperatura',
  'llm.model.temperature.description':
    'Variación muestral. 0 es determinista; los valores más altos son más variados.',
  'llm.model.behavior.name': 'Comportamiento del modelo',
  'llm.model.summary.temperature': 'Temperatura {value}',
  'llm.model.summary.timeout': 'Tiempo de espera de {value}s',
  'llm.failure.authInvalid': 'Clave de API de {provider} rechazada. Verifique la configuración.',
  'llm.failure.rateLimited': 'Límite de tasa {provider} alcanzado. Volviendo al texto sin formato.',
  'llm.failure.network': 'Error de red al llegar a {provider}.',
  'llm.failure.modelNotConfigured':
    'El modelo {provider} no está configurado. Elija uno en Modelo.',
  'llm.failure.unknownModel': 'Modelo {provider} no encontrado. Elija otro en Modelo.',
  'llm.failure.unknown': 'Error en la transformación LLM. Ver consola.',
  'llm.status.selectOllamaModel': 'Seleccione un modelo Ollama a continuación.',
  'llm.status.selectOpenRouterModel': 'Seleccione un modelo OpenRouter a continuación.',
  'llm.status.ollamaNotRunning': 'Ollama no se está ejecutando.',
  'llm.status.unreachable': '{provider} es inalcanzable.',
  'llm.status.authInvalid': 'Clave de API de {provider} rechazada.',
  'llm.status.rateLimited': 'Límite de tasa {provider} alcanzado.',
  'llm.status.noOllamaModels': 'No hay modelos de chat instalados en Ollama.',
  'llm.status.noModels': 'No se encontraron modelos {provider} utilizables.',
  'llm.status.selectedUnavailable': 'El modelo seleccionado no está disponible.',
  'llm.timing.title': 'Configuración de tiempo',
  'llm.timing.settingsTooltip': 'Configuración de tiempo',
  'llm.timing.minimumWords.name': 'Palabras mínimas',
  'llm.timing.minimumWords.description':
    'Omita la transformación cuando la transcripción tenga menos palabras que esta.',
  'llm.timing.timestamps.perUtterance':
    'Después de cada frase se conservan los límites de la marca de tiempo.',
  'llm.timing.timestamps.batch':
    'Todos a la vez pueden reescribirse o eliminar marcas de tiempo, según el ajuste preestablecido.',
  'llm.timing.option.perUtterance': 'Después de cada frase',
  'llm.timing.option.batch': 'Todo a la vez al detenerse',
  'llm.routing.priceTierTooltip': 'Nivel de precio aproximado',
  'llm.routing.providerModel': 'Modelo de {provider}',
  'llm.routing.ollamaModelDescription': 'Elija un modelo de chat Ollama local.',
  'llm.routing.selectModel': 'Selecciona un modelo',
  'llm.routing.refreshModels': 'Actualizar modelos {provider}',
  'llm.routing.openRouterModel.name': 'Modelo OpenRouter',
  'llm.routing.openRouterModel.description': 'Escriba para buscar modelos OpenRouter.',
  'llm.routing.testConnection': 'Probar clave de API y modelo',
  'llm.sidebar.eyebrow': 'Flujo de trabajo de transcripción',
  'llm.sidebar.title': 'Transformar el dictado',
  'llm.sidebar.description':
    'Elija cómo se le da forma al texto hablado antes de que llegue a su nota.',
  'llm.sidebar.group.preset': 'Preajuste',
  'llm.sidebar.group.model': 'Modelo',
  'llm.sidebar.group.context': 'Contexto',
  'llm.sidebar.enabled.name': 'Activado',
  'llm.sidebar.enabled.description':
    'Aplique el ajuste preestablecido activo al nuevo texto dictado.',
  'llm.sidebar.showOriginal.name': 'Mostrar transcripción original',
  'llm.sidebar.showOriginal.description':
    'Guárdelo en una leyenda plegable debajo de cada resultado transformado.',
  'llm.sidebar.runTransform.name': 'Ejecutar transformación',
  'llm.sidebar.runTransform.description':
    'Corre después de cada frase, o todas a la vez cuando te detengas.',
  'llm.sidebar.runTransform.setByPreset': 'Establecido por {preset} — {timing}.',
  'llm.sidebar.activePreset': 'Preajuste activo',
  'llm.sidebar.unavailable.title': 'Las funciones de LLM no están disponibles',
  'llm.sidebar.unavailable.description':
    'Habilite las funciones de LLM en la configuración de Speech Kit para configurar transformaciones.',
  'llm.sidebar.unavailable.summary': 'Habilite las funciones de LLM en la configuración',
  'llm.sidebar.off.title': 'Modo de transcripción sin formato',
  'llm.sidebar.off.description':
    'El dictado inserta la transcripción local sin procesar. Active Transformar cuando desee realizar limpieza, reescritura o resúmenes.',
  'llm.sidebar.off.summary': 'Transcripción sin procesar',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Limpiar',
  'llm.preset.builtin.cleanUp.description':
    'Corrija los artefactos de transcripción, el relleno, la puntuación y el uso de mayúsculas, preservando al mismo tiempo la voz y el significado.',
  'llm.preset.builtin.cleanUp.prompt':
    'Limpie el texto dictado. Corrija muletillas, comienzos en falso, repeticiones, puntuación, mayúsculas y errores evidentes de reconocimiento. Preserve la voz y el significado del hablante. Utilice el contexto de referencia solo para la ortografía. Escriba en el idioma original de la transcripción. No traduzca a menos que el usuario lo solicite explícitamente. Devuelva únicamente el texto limpio, sin preámbulo ni comentarios.',
  'llm.preset.builtin.professionalWriting.label': 'Escritura profesional',
  'llm.preset.builtin.professionalWriting.description':
    'Reescriba en prosa profesional concisa y pulida preservando hechos, nombres, decisiones y términos técnicos.',
  'llm.preset.builtin.professionalWriting.prompt':
    'Reescriba el texto dictado como prosa profesional y concisa. Use la voz activa, sin muletillas ni evasivas. Preserve todos los hechos, nombres y términos. Utilice el contexto de referencia para la ortografía. Escriba en el idioma original de la transcripción. No traduzca a menos que el usuario lo solicite explícitamente. Devuelva únicamente el texto reescrito, sin preámbulo ni comentarios.',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Agregue un breve resumen de TLDR encima de su transcripción intacta.',
  'llm.preset.builtin.tldr.prompt':
    "Escriba un resumen TLDR de la transcripción dictada: un título 'TLDR' seguido de entre 1 y 3 viñetas breves que cubran los puntos clave. Escriba en el idioma original de la transcripción. No traduzca a menos que el usuario lo solicite explícitamente. Devuelva únicamente el título y las viñetas; no repita la transcripción ni añada un preámbulo o comentarios.",
  'llm.preset.builtin.markdownFormatting.label': 'Formato Markdown',
  'llm.preset.builtin.markdownFormatting.description':
    'Vuelva a formatear la transcripción de la sesión como estructurada Markdown con títulos, listas y énfasis.',
  'llm.preset.builtin.markdownFormatting.prompt':
    'Reformatee el texto dictado como Markdown bien estructurado. Añada encabezados, listas numeradas o con viñetas, negrita, énfasis y bloques de código delimitados donde el contenido lo requiera. Corrija ligeramente las muletillas, los comienzos en falso, la puntuación y las mayúsculas; preserve la redacción del hablante y todos los hechos, nombres y términos. Escriba en el idioma original de la transcripción. No traduzca a menos que el usuario lo solicite explícitamente. Devuelva únicamente el Markdown, sin preámbulo ni comentarios.',
  'llm.preset.builtin.actionItems.label': 'Elementos de acción',
  'llm.preset.builtin.actionItems.description':
    'Agregue una lista de verificación de elementos de acción debajo de su transcripción intacta.',
  'llm.preset.builtin.actionItems.prompt':
    "Extraiga elementos de acción de la transcripción dictada. Genere un encabezado 'Elementos de acción' seguido de una lista de verificación Markdown con tareas concretas e indique al responsable cuando el hablante lo mencione. Si la transcripción no contiene elementos de acción, no devuelva nada. Escriba en el idioma original de la transcripción. No traduzca a menos que el usuario lo solicite explícitamente. Devuelva únicamente el título y la lista de verificación; no repita la transcripción ni añada un preámbulo o comentarios.",
  'llm.preset.timing.perUtterance': 'Se ejecuta después de cada frase.',
  'llm.preset.timing.batch': 'Se ejecuta una vez al detenerse',
  'llm.preset.timing.either': 'Se ejecuta en cualquier modo',
  'llm.preset.behavior.addAbove': 'agrega contenido nuevo encima de la transcripción',
  'llm.preset.behavior.addBelow': 'agrega contenido nuevo debajo de la transcripción',
  'llm.preset.behavior.replace': 'reescribe el texto dictado',
  'llm.preset.behavior.overrides': 'anula {fields}',
  'llm.preset.override.minimumWords': 'palabras mínimas',
  'llm.preset.override.temperature': 'temperatura',
  'llm.preset.override.noteContext': 'contexto de la nota',
  'llm.preset.option.perUtterance': '{preset} (después de cada frase)',
  'llm.preset.option.batch': '{preset} (al detenerse)',
  'llm.preset.copySuffix': '(Copiar)',
  'llm.preset.copySuffixNumbered': '(copia {number})',
  'llm.preset.validation.nameRequired': 'Introduzca un nombre para este ajuste preestablecido.',
  'llm.preset.validation.nameExists': 'Ya existe un preajuste con ese nombre.',
  'llm.preset.validation.promptRequired': 'Ingrese un mensaje para este ajuste preestablecido.',
  'llm.preset.validation.minimumWords':
    'Las palabras mínimas deben ser un número entero entre 0 y {max}.',
  'llm.preset.validation.temperature': 'La temperatura debe ser un número entre 0 y {max}.',
  'llm.preset.validation.maximumCount':
    'Puede guardar hasta {max} ajustes preestablecidos. Elimine uno primero.',
  'llm.preset.validation.builtinName':
    'Ese nombre lo utiliza un ajuste preestablecido integrado; elija un nombre diferente.',
  'llm.preset.manager.title': 'Administrar ajustes preestablecidos',
  'llm.preset.manager.newTitle': 'Nuevo preajuste',
  'llm.preset.manager.editTitle': 'Editar preajuste',
  'llm.preset.manager.presets.name': 'Preajustes',
  'llm.preset.manager.presets.description':
    'El preset activo está marcado. Los ajustes preestablecidos integrados son de solo lectura; duplique uno para personalizarlo.',
  'llm.preset.manager.new': 'Nuevo preajuste',
  'llm.preset.manager.searchPlaceholder': 'Buscar ajustes preestablecidos...',
  'llm.preset.manager.noMatches': 'No hay ajustes preestablecidos que coincidan con su búsqueda.',
  'llm.preset.manager.builtinHeading': 'Incorporado',
  'llm.preset.manager.yoursHeading': 'Tus ajustes preestablecidos',
  'llm.preset.manager.viewTooltip': 'Ver preajuste',
  'llm.preset.manager.editTooltip': 'Editar preajuste',
  'llm.preset.manager.duplicateTooltip': 'Duplicar preajuste',
  'llm.preset.manager.deleteTooltip': 'Eliminar preajuste "{preset}"',
  'llm.preset.manager.back': '← Todos los ajustes preestablecidos',
  'llm.preset.editor.name': 'Nombre',
  'llm.preset.editor.namePlaceholder': 'p.ej. notas de la reunión',
  'llm.preset.editor.description': 'Descripción (opcional)',
  'llm.preset.editor.descriptionPlaceholder': 'Cuándo usar este ajuste preestablecido',
  'llm.preset.editor.prompt': 'Instrucción',
  'llm.preset.editor.promptDescription': 'Enviado al modelo como mensaje del sistema.',
  'llm.preset.editor.promptSize':
    '~{tokens} tokens ({characters} caracteres) — enviados con cada solicitud',
  'llm.preset.editor.timing': 'Momento',
  'llm.preset.editor.timingDescription':
    'Cuando se ejecuta la transformación. "Cualquiera de los dos" sigue el tiempo de la barra lateral.',
  'llm.preset.editor.timingEither': 'Cualquiera (según la barra lateral)',
  'llm.preset.editor.timingPerUtterance': 'Después de cada frase',
  'llm.preset.editor.timingBatch': 'Una vez al detenerse',
  'llm.preset.editor.output': 'Salida',
  'llm.preset.editor.outputDescription':
    'Reemplazar reescribe el texto dictado. Agregar lo mantiene intacto e inserta contenido nuevo.',
  'llm.preset.editor.outputReplace': 'Reemplazar texto',
  'llm.preset.editor.outputAddAbove': 'Añadir encima de la transcripción',
  'llm.preset.editor.outputAddBelow': 'Añadir debajo de la transcripción',
  'llm.preset.editor.overrides': 'Anulaciones',
  'llm.preset.editor.overridesDescription':
    'Deje un campo en blanco para utilizar la configuración global.',
  'llm.preset.editor.minimumWords': 'palabras mínimas',
  'llm.preset.delete.title': 'Eliminar preajuste',
  'llm.preset.delete.message': '¿Eliminar el preajuste "{preset}"? Esto no se puede deshacer.',
  'llm.preset.delete.activeFallback': '"{preset}" estaba activo; cambió a Limpiar.',
  'common.back': 'Atrás',
  'common.close': 'Cerrar',
  'common.done': 'Hecho',
  'common.install': 'Instalar',
  'common.later': 'Más tarde',
  'common.next': 'Siguiente',
  'common.remove': 'Eliminar',
  'common.tryAgain': 'Intentar otra vez',
  'setup.ready.waitForDictation': 'Espere a que termine el dictado actual y vuelva a intentarlo.',
  'setup.ready.openMarkdownNote':
    'Abra una nota Markdown en modo de edición y luego intente dictarla nuevamente.',
  'setup.ready.completionFailed': 'No se pudo finalizar la configuración. Intentar otra vez.',
  'setup.wizard.welcomeTitle': 'Bienvenido a Speech Kit',
  'setup.wizard.title': 'Configurar Speech Kit',
  'setup.wizard.engineReadyTitle': 'Motor de voz listo',
  'setup.wizard.engineReadyDesc':
    'El motor local de conversión de voz a texto está instalado y listo.',
  'setup.wizard.intro':
    'Dicte notas con manos libres dentro de Obsidian y completamente en su equipo. Sin cuenta, sin nube y sin telemetría.',
  'setup.wizard.quickSetup': 'Una configuración rápida de 2 minutos:',
  'setup.wizard.downloadEngineStep': 'Descargar el motor de voz',
  'setup.wizard.pickModelStep': 'Elija un modelo de transcripción',
  'setup.wizard.startTalking':
    'Luego presiona el micrófono en la cinta (o tu propia tecla de acceso rápido) y comienza a hablar.',
  'setup.wizard.downloadEngine': 'Descargar motor',
  'setup.wizard.modelSelectedTitle': 'Modelo seleccionado',
  'setup.wizard.pickModelTitle': 'Elija un modelo de transcripción',
  'setup.wizard.modelSelectedDesc':
    'Se instala y selecciona un modelo de transcripción. Puede instalar más o cambiar más tarde desde Configuración.',
  'setup.wizard.modelIntro':
    'Instale un modelo de transcripción para habilitar el dictado. Puede instalar más más adelante: los modelos más pequeños son más rápidos, los modelos más grandes son más precisos.',
  'setup.wizard.modelKinds':
    'Hay dos tipos disponibles: los modelos de transmisión muestran las palabras en directo mientras habla; los modelos estándar transcriben después de cada pausa. Para el dictado con manos libres, comience con el modelo Moonshine Small recomendado. Nemotron 3.5 ASR es una opción de transmisión que consume más recursos.',
  'setup.wizard.openModelPicker': 'Abrir selector de modelo',
  'setup.wizard.readyTitle': 'Estás listo para dictar',
  'setup.wizard.readyDesc':
    'Pruébelo en la nota Markdown que ya está abierta. Diga algunas palabras y luego use el micrófono de la cinta o su tecla de acceso rápido para detener el dictado.',
  'setup.wizard.ribbonTitle': 'Use el micrófono de la cinta',
  'setup.wizard.ribbonDesc':
    'Busque este icono en la cinta Obsidian. Haga clic en él para comenzar a dictar; haga clic nuevamente para detener.',
  'setup.wizard.hotkeyTitle': 'O vincular una tecla de acceso rápido',
  'setup.wizard.hotkeyDescBefore': 'Vincular un acceso directo al',
  'setup.wizard.toggleCommandName': 'Speech Kit: alternar dictado',
  'setup.wizard.hotkeyDescAfter':
    'comando para iniciar y detener desde cualquier lugar de Obsidian.',
  'setup.wizard.openHotkeySettings': 'Abrir configuración de teclas de acceso rápido',
  'setup.wizard.tryDictationNow': 'Prueba el dictado ahora',
  'setup.wizard.openHotkeySettingsFallback':
    'Abra Configuración → Teclas de acceso rápido y busque "Speech Kit".',
  'setup.sidecar.modal.download': 'Descargar',
  'setup.sidecar.modal.variantDownload': 'Descargar {variant}',
  'setup.sidecar.modal.version': 'Versión',
  'setup.sidecar.modal.cancelling': 'Cancelando...',
  'setup.sidecar.modal.downloading': 'Descargando...',
  'setup.sidecar.modal.retryDownload': 'Reintentar descargar',
  'setup.sidecar.modal.installFailureNotice':
    'La instalación del motor de voz falló. Vuelva a abrir la configuración o Configuración para revisar el error y volver a intentarlo.',
  'setup.sidecar.modal.startFailed':
    'No se pudo iniciar la instalación de sidecar. Cierre otras ventanas de configuración y vuelva a intentarlo.',
  'setup.sidecar.installCancelled': 'Instalación de Sidecar cancelada.',
  'setup.sidecar.progress.variant': '{variant} sidecar ({current} de {total})',
  'setup.sidecar.progress.downloading': 'Descargando',
  'setup.sidecar.progress.verifying': 'Verificando suma de comprobación...',
  'setup.sidecar.progress.extracting': 'Extrayendo archivo...',
  'models.manage.title': 'Administrar modelos',
  'models.manage.loadFailedTitle': 'No se pudieron cargar los modelos',
  'models.manage.loadFailedDesc':
    'Es posible que el motor de voz no esté instalado o que no responda. Vuelva a ejecutar la instalación para reinstalarlo o inténtelo nuevamente.',
  'models.manage.runSetup': 'Ejecutar configuración',
  'models.manage.loadingCatalog': 'Cargando catálogo de modelos…',
  'models.manage.loadCatalogFailed': 'No se pudo cargar el catálogo de modelos.',
  'models.manage.noneAvailable': 'No hay modelos disponibles para este motor.',
  'models.manage.unsupportedLanguage':
    '· No es compatible con {language}. Cambie el idioma de dictado para instalar o utilizar este modelo.',
  'models.manage.use': 'Usar',
  'models.manage.selected': 'Seleccionado',
  'models.manage.cancelling': 'Cancelando…',
  'models.manage.details': 'Detalles',
  'models.manage.installStartFailed':
    'No se pudo iniciar la instalación del modelo. Intentar otra vez.',
  'models.manage.selectFailed':
    'No se pudo seleccionar el modelo. Compruebe que sus archivos estén disponibles.',
  'models.manage.selectedNotice': 'Modelo seleccionado.',
  'models.manage.removeFailed':
    'No se pudo eliminar el modelo. Cierra cualquier proceso usando sus archivos.',
  'models.manage.removedNotice': 'Modelo eliminado.',
  'models.external.title': 'Usar archivo externo',
  'models.external.intro':
    'Los modelos externos son para uso avanzado. Speech Kit no descarga, actualiza ni verifica la suma de comprobación de estos archivos.',
  'models.external.family.name': 'Familia del modelo',
  'models.external.family.desc':
    'Elija el cargador que coincida con el modelo. La familia no se deduce de su nombre de archivo.',
  'models.external.path.name': 'Ruta del archivo del modelo',
  'models.external.path.desc':
    'Introduzca la ruta absoluta al artefacto del modelo principal. Se valida antes de guardar esta selección.',
  'models.external.validateAndUse': 'Validar y utilizar',
  'models.external.validating': 'Validando…',
  'models.external.selectedNotice': 'Archivo de modelo externo validado y seleccionado.',
  'models.external.requirementsTitle': 'Requisitos del archivo',
  'models.external.validation.notConfigured': 'La ruta del archivo del modelo no está configurada.',
  'models.external.validation.notAbsolute':
    'La ruta del archivo del modelo debe ser una ruta absoluta.',
  'models.external.validation.missing': 'La ruta del archivo del modelo no existe: {path}',
  'models.external.validation.notFile':
    'La ruta del archivo del modelo debe apuntar a un archivo: {path}',
  'models.external.validation.selectEntryFile': 'Selecciona {filename}.',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR requiere su artefacto encoder.int8.onnx. Seleccione encoder.int8.onnx del directorio del modelo de 560 ms anclado.',
  'models.external.validation.moonshineEntryFile':
    'Moonshine requiere su artefacto frontend.ort principal. Seleccione frontend.ort en el directorio del modelo de transmisión.',
  'models.external.validation.generic': 'El motor de voz no pudo validar este modelo.',
  'models.external.requirements.nemotron.entry':
    'Seleccione encoder.int8.onnx de la exportación int8 Nemotron 3.5 ASR 560 ms fijada.',
  'models.external.requirements.nemotron.siblings':
    'El mismo directorio debe contener decoder.int8.onnx, joiner.int8.onnx y tokens.txt.',
  'models.external.requirements.nemotron.compatibility':
    'Otros tamaños de fragmentos y exportaciones ORT GenAI no son compatibles con este adaptador.',
  'models.external.requirements.moonshine.entry':
    'Seleccione frontend.ort de un directorio de modelo ORT de transmisión Moonshine v2.',
  'models.external.requirements.moonshine.siblings':
    'El mismo directorio debe contener encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json y tokenizer.bin.',
  'models.external.requirements.moonshine.compatibility':
    'Las exportaciones Moonshine ONNX sin transmisión no son compatibles.',
  'models.external.requirements.whisper.entry':
    'Seleccione un archivo de modelo GGML o GGUF compatible con whisper.cpp.',
  'models.external.requirements.whisper.validation':
    'El cargador valida el contenido del archivo; una extensión de nombre de archivo por sí sola no establece compatibilidad.',
  'models.external.requirements.whisper.language':
    'Los archivos Whisper con pesos .en solo admiten inglés; los pesos multilingües ofrecen el selector de idioma verificado y la detección automática.',
  'models.details.totalSize': 'tamaño total',
  'models.details.source': 'Fuente',
  'models.details.license': 'Licencia',
  'models.details.capabilities': 'Capacidades',
  'models.details.installPath': 'Ruta de instalación',
  'models.details.files': 'Archivos ({count})',
  'models.details.size': 'Tamaño',
  'models.capability.segmentTimestamps': 'Marcas de tiempo de segmentos',
  'models.capability.wordTimestamps': 'Marcas de tiempo de palabras',
  'models.capability.initialPrompt': 'Mensaje inicial',
  'models.capability.streaming': 'Transmisión',
  'models.capability.autoLanguageDetection': 'Detección automática de idioma',
  'models.capability.punctuation': 'Puntuación',
  'models.capability.maxAudio': 'Audio máximo: {seconds}s',
  'models.capability.anyLanguage': 'Cualquier idioma',
  'models.capability.englishOnly': 'Solo inglés',
  'models.capability.languageCount': '{count} idiomas',
  'models.capability.languageSelection': 'Selección de idioma',
  'models.tag.fullPrecision': 'Precisión total',
  'models.tag.reducedSize': 'Tamaño reducido',
  'models.progress.preparing': 'Preparando la instalación',
  'models.progress.downloading': 'Descargando',
  'models.progress.verifying': 'Verificando descarga',
  'models.progress.validating': 'Validando modelo',
  'models.progress.installed': 'Modelo instalado',
  'models.progress.cancelled': 'Instalación del modelo cancelada',
  'models.progress.failed': 'Error en la instalación del modelo',
  'models.progress.downloadingFile': 'Descargando {filename}',
  'models.progress.verifyingFile': 'Verificando {filename}',
  'models.progress.fileCount': 'Archivo {current} de {total}',
  'models.current.noneSelected': 'Ningún modelo seleccionado',
  'models.current.noneSelectedDesc': 'Elija un modelo instalado o valide un archivo externo.',
  'models.current.notSelected': 'No seleccionado',
  'models.current.externalFile': 'archivo externo',
  'models.current.managedNotInstalled': 'El modelo administrado seleccionado no está instalado.',
  'models.current.installed': 'Instalado',
  'models.current.notInstalled': 'No instalado',
  'models.current.managedDownload': 'Descarga gestionada',
  'models.current.externalValidated': 'Validado externamente',
  'models.current.checking': 'Comprobando',
  'models.current.externalUnavailableDesc':
    'El modelo externo no está disponible. Valide el archivo nuevamente para ver los detalles.',
  'models.current.unavailable': 'No disponible',
  'models.current.validateBeforeDictating': 'Valide el archivo de modelo externo antes de dictar.',
  'sidecarError.audio_too_long': 'El clip de audio supera la duración máxima para este motor.',
  'sidecarError.engine_inference_failed': 'La transcripción local falló.',
  'sidecarError.internal_error': 'El motor de voz encontró un error interno.',
  'sidecarError.invalid_audio_buffer':
    'El búfer de audio estaba vacío cuando comenzó la transcripción.',
  'sidecarError.invalid_audio_frame': 'El motor de voz recibió una trama de audio no válida.',
  'sidecarError.invalid_diarization_speaker_limit':
    'El número máximo de hablantes debe ser al menos 1 o estar configurado en Automático.',
  'sidecarError.invalid_frame': 'El motor de voz recibió una trama de protocolo no válida.',
  'sidecarError.invalid_model_file': 'Falta el archivo del modelo, es ilegible o no es compatible.',
  'sidecarError.invalid_model_task': 'El modelo seleccionado no se puede usar para dictar.',
  'sidecarError.invalid_model_store':
    'La carpeta de almacenamiento de modelos no está disponible o no es válida.',
  'sidecarError.missing_model_file': 'El archivo de modelo no existe o no es un archivo normal.',
  'sidecarError.no_active_install': 'No hay ninguna instalación de modelo activa para cancelar.',
  'sidecarError.no_active_session': 'No hay sesión de dictado activa.',
  'sidecarError.session_already_exists': 'Ya existe una sesión de dictado con este identificador.',
  'sidecarError.session_capacity_exceeded':
    'Speech Kit ya tiene el número máximo de sesiones activas.',
  'sidecarError.system_audio_capture_failed': 'No se pudo iniciar la captura de audio del sistema.',
  'sidecarError.system_audio_permission_denied':
    'El permiso de grabación de audio del sistema está desactivado para Obsidian. Abra Configuración del sistema → Privacidad y seguridad → Grabación de audio del sistema y pantalla, habilite Obsidian e intente nuevamente.',
  'sidecarError.system_audio_unsupported':
    'La captura de audio del sistema aún no está disponible en esta plataforma. Enrute la salida de esta computadora a través de un dispositivo de audio virtual y selecciónelo como su micrófono; consulte la guía de audio del sistema.',
  'sidecarError.transcription_failure': 'La transcripción local falló.',
  'sidecarError.unsupported_engine': 'El motor solicitado no está disponible en esta compilación.',
  'sidecarError.unsupported_language': 'El modelo seleccionado no admite este idioma de dictado.',
  'sidecarError.utterance_dropped_during_overload_drain':
    'Se eliminó una expresión finalizada mientras se agotaba la cola de transcripción.',
  'sidecarError.utterance_queue_overload':
    'El dictado se detuvo porque la cola de transcripción está sobrecargada. El audio aceptado terminará de procesarse.',
  'sidecarError.vad_error': 'La detección de actividad de voz falló en una trama de audio.',
  'sidecarError.vad_init_failed': 'No se pudo inicializar el Silero VAD incluido.',
  'sidecarError.worker_panic':
    'El trabajador de transcripción del motor de voz se detuvo inesperadamente.',
  'catalog.whisper_tiny_en_q8_0.summary':
    'El modelo más rápido con el menor coste de recursos. Bueno para pruebas o máquinas de baja potencia.',
  'catalog.whisper_base_en_q8_0.summary':
    'Modelo rápido con precisión decente. Una buena opción para borradores rápidos en CPU.',
  'catalog.whisper_small_en_q5_1.summary':
    'Equilibra la calidad de la transcripción, el tamaño de la descarga y la velocidad de la CPU.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Modelo de alta precisión para usuarios que priorizan la calidad de la transcripción sobre la velocidad.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'Transcripción multilingüe de alta precisión con una arquitectura optimizada para la aceleración por GPU.',
  'catalog.cohere_transcribe_fp16.summary':
    'La variante Cohere más grande, que conserva la precisión total del modelo.',
  'catalog.cohere_transcribe_int8.summary':
    'Variante media de Cohere por tamaño de descarga, utilizando cuantificación de 8 bits.',
  'catalog.cohere_transcribe_q4.summary':
    'La variante más pequeña de Cohere; la cuantificación de 4 bits reduce el tamaño a costa de la calidad.',
  'catalog.moonshine_tiny_streaming_en.summary':
    'El modelo de transmisión Moonshine más rápido con parámetros de 34M, diseñado para CPU de gama baja.',
  'catalog.moonshine_small_streaming_en.summary':
    'Modelo equilibrado de dictado en vivo con parámetros de 123M.',
  'catalog.moonshine_medium_streaming_en.summary':
    'Modelo de transmisión Moonshine más preciso con parámetros de 245M.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'RNNT multilingüe 0.6B de NVIDIA, exportado a int8 ONNX para transcripción en vivo con reconocimiento de caché en ocho idiomas verificados.',
  'catalog.family.whisper.summary':
    'Transcribe después de cada pausa. Whisper proporciona marcas de tiempo más precisas que otras familias de modelos, incluida la sincronización opcional por palabra. Tiny y Base favorecen la velocidad, Small equilibra la velocidad y la calidad, y Medium y Large favorecen la calidad.',
  'catalog.family.cohere_transcribe.summary':
    'Transcripción por lotes de alta calidad con descarga de varios gigabytes y requisitos de memoria.',
  'catalog.family.moonshine.summary':
    'Muestra las palabras mientras habla. Tiny favorece un menor uso de recursos, Small equilibra la velocidad y la calidad, y Medium favorece la calidad.',
  'catalog.family.nemotron_asr.summary':
    'Transmisión multilingüe de alta precisión con una mayor descarga y mayor uso de recursos. Moonshine Small sigue siendo el valor predeterminado recomendado para el dictado en vivo en inglés.',
  'setup.sidecar.modal.unsupportedPlatform':
    'Esta compilación de motor de voz no está disponible para su plataforma o arquitectura.',
  'setup.sidecar.modal.genericInstallError':
    'No se pudo instalar el motor de voz. Consulte los registros del complemento para obtener más detalles y vuelva a intentarlo.',
  'commands.readAloud': 'Leer en voz alta',
  'commands.readAloudFromCursor': 'Leer en voz alta desde el cursor',
  'commands.pauseResumeReadAloud': 'Pausar o reanudar la lectura',
  'commands.stopReadAloud': 'Detener la lectura',
  'settings.groups.readAloud': 'Lectura en voz alta',
  'settings.model.noModelSelected': 'Ningún modelo seleccionado',
  'settings.model.speechToText': 'Modelo de voz a texto',
  'settings.model.textToSpeech': 'Modelo de texto a voz',
  'settings.readAloud.hotkey': 'Atajo recomendado',
  'settings.readAloud.hotkeyDesc':
    'Asigna un atajo a Leer en voz alta. Lee el texto seleccionado o toda la nota si no hay selección.',
  'settings.readAloud.highlightSpokenText': 'Resaltar texto leído',
  'settings.readAloud.highlightSpokenTextDesc':
    'Resalta la frase o el fragmento de texto actual en el editor mientras se reproduce la lectura en voz alta.',
  'settings.readAloud.voice': 'Voz',
  'settings.readAloud.voiceDesc': 'Elige una voz instalada para el modelo seleccionado.',
  'settings.readAloud.noVoices': 'No hay voces instaladas',
  'settings.readAloud.speed': 'Velocidad de lectura',
  'settings.readAloud.speedDesc':
    'Cambiar la velocidad durante la lectura reinicia desde la frase actual.',
  'models.manage.dictationModels': 'Voz a texto',
  'models.manage.readAloudModels': 'Texto a voz',
  'models.manage.allLanguages': 'Todos los idiomas',
  'models.manage.familiesLabel': 'Familias de modelos',
  'models.manage.noneForLanguage': 'No hay modelos disponibles para esta tarea e idioma.',
  'models.manage.optionalVoice': 'Voz local opcional',
  'models.manage.voiceInstalled': 'Instalada',
  'tts.status.reading': 'Leyendo…',
  'tts.status.paused': 'Lectura en pausa',
  'tts.control.model': 'Modelo: {model}',
  'tts.control.speed': 'Velocidad: {speed}',
  'tts.notice.noText': 'Aquí no hay texto que se pueda leer.',
  'tts.notice.modelRequired': 'Primero instala y selecciona un modelo de lectura.',
  'tts.notice.voiceRequired': 'Primero selecciona una voz instalada.',
  'tts.notice.startFailed': 'No se pudo iniciar la lectura.',
  'tts.notice.playbackFailed': 'La reproducción de audio falló.',
  'tts.notice.sidecarExited': 'La lectura se detuvo porque el sidecar terminó inesperadamente.',
  'sidecarError.invalid_synthesis_request': 'La solicitud de lectura no es válida.',
  'sidecarError.missing_voice_file': 'La voz seleccionada no está instalada.',
  'sidecarError.sidecar_exited': 'El proceso sidecar terminó inesperadamente.',
  'sidecarError.synthesis_cancelled': 'La lectura se canceló.',
  'sidecarError.synthesis_failed': 'La síntesis de voz local falló.',
  'sidecarError.synthesis_worker_unavailable':
    'El proceso de síntesis de voz local no está disponible.',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Lectura local natural en inglés con voces seleccionables.',
  'catalog.family.pocket_tts.summary':
    'Lee notas localmente en inglés, francés, alemán, español, portugués e italiano con voces seleccionables y control de velocidad sin alterar el tono.',
  'commands.translateNote': 'Traducir nota',
  'commands.translateSelection': 'Traducir selección',
  'models.manage.translationModels': 'Traducción',
  'translation.modal.privacy': 'La traducción se ejecuta completamente en este dispositivo.',
  'translation.modal.from': 'Origen',
  'translation.modal.to': 'Destino',
  'translation.modal.swap': 'Intercambiar',
  'translation.modal.largeNote': 'Nota grande: la traducción puede tardar unos segundos.',
  'translation.modal.sourceSelection': 'Selección original',
  'translation.modal.sourceNote': 'Nota original',
  'translation.modal.previewAria': 'Vista previa de la traducción',
  'translation.modal.readAloud': 'Leer la traducción en voz alta en {language}',
  'translation.modal.preparing': 'Preparando la traducción local…',
  'translation.modal.loading': 'Cargando el modelo local…',
  'translation.modal.translating': 'Traduciendo…',
  'translation.modal.translatingProgress': 'Traduciendo… {completed}/{total}',
  'translation.modal.ready': 'Traducción lista.',
  'translation.modal.readyPartial_one':
    'Traducción lista. 1 bloque conservó su idioma original porque no se pudo preservar su formato.',
  'translation.modal.readyPartial_other':
    'Traducción lista. {count} bloques conservaron su idioma original porque no se pudo preservar su formato.',
  'translation.modal.canceled': 'Traducción cancelada.',
  'translation.modal.failed': 'La traducción falló.',
  'translation.modal.missingModel':
    'Instala el paquete de traducción local para usar este par de idiomas.',
  'translation.modal.missingEngineModel':
    '{style} no está instalado. Instala su modelo local para traducir este par de idiomas.',
  'translation.modal.unsupportedPairModel':
    'Los modelos de traducción instalados no admiten este par de idiomas.',
  'translation.modal.incompleteModel':
    'Al modelo de traducción le faltan archivos. Vuelve a instalarlo para continuar.',
  'translation.modal.installModel': 'Instalar modelo de traducción',
  'translation.modal.translateAgain': 'Traducir de nuevo',
  'translation.modal.cancel': 'Cancelar',
  'translation.modal.replace': 'Reemplazar',
  'translation.modal.insertBelow': 'Insertar debajo',
  'translation.modal.copy': 'Copiar',
  'translation.modal.dismiss': 'Descartar',
  'settings.translation.engine.name': 'Estilo de traducción predeterminado',
  'settings.translation.engine.desc':
    'Rápido es más literal; Natural usa el modelo opcional Tencent HY-MT.',
  'translation.engine.bergamot': 'Rápida y literal — Firefox Translations',
  'translation.engine.tencentHyMt': 'Natural — Tencent HY-MT',
  'translation.engine.notInstalled': '{style} (no instalado)',
  'translation.engine.unsupportedPair': '{style} (no disponible para este par de idiomas)',
  'translation.modal.stale':
    'La nota cambió desde que empezó esta traducción. Inicia una nueva traducción o copia esta.',
  'translation.notice.copied': 'Se copió la traducción.',
  'translation.notice.copyFailed': 'No se pudo copiar la traducción.',
  'translation.notice.tooLong': 'Traduce hasta {count} caracteres a la vez.',
  'catalog.firefox_translations_release_2026_07.summary':
    'Traducción local rápida entre inglés y siete idiomas mediante modelos publicados en Firefox.',
  'catalog.family.firefox_translations.summary':
    'Traduce texto de notas localmente con el motor compacto Bergamot y modelos de Firefox.',
} as const satisfies TranslationCatalog;
