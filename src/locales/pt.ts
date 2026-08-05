import type { TranslationCatalog } from './index';

export const pt = {
  'notice.dictationNotActive': 'O ditado não está ativo de momento.',
  'notice.dictationStartFailed': 'Não foi possível iniciar o ditado.',
  'notice.dictationStopFailed': 'Não foi possível parar o ditado.',
  'notice.lastUtteranceCleared': 'A última frase guardada foi eliminada.',
  'notice.lastUtteranceReinsertFailed': 'Não foi possível reinserir a última frase finalizada.',
  'notice.lastUtteranceReinserted': 'A última frase finalizada foi reinserida.',
  'notice.lastUtteranceUnavailable':
    'Não existe nenhuma frase finalizada disponível para reinserir.',
  'notice.llmTransformEmpty': 'A transformação por LLM não devolveu conteúdo para adicionar.',
  'notice.microphoneDisconnected':
    'O microfone foi desligado. O ditado parou e o áudio já captado continuará a ser processado. Volte a ligar o microfone e inicie novamente o ditado.',
  'notice.rawTranscriptChanged':
    'Não foi possível restaurar a transcrição original porque a nota foi alterada após a limpeza.',
  'notice.rawTranscriptCleared': 'A recuperação da transcrição original foi eliminada.',
  'notice.rawTranscriptCopied': 'A transcrição original foi copiada.',
  'notice.rawTranscriptCopyFailed': 'Não foi possível copiar a transcrição original.',
  'notice.rawTranscriptRestored': 'A transcrição original foi restaurada.',
  'notice.rawTranscriptRestoreFailed': 'Não foi possível restaurar a transcrição original.',
  'notice.rawTranscriptTargetUnavailable':
    'Não foi possível restaurar a transcrição original porque a nota de origem já não está aberta no mesmo editor.',
  'notice.rawTranscriptUnavailable':
    'Não está disponível nenhuma recuperação da transcrição original.',
  'notice.sidecarHealthCheckFailed': 'A verificação do estado do sidecar falhou',
  'notice.sidecarReady': 'O sidecar está pronto ({version}).',
  'notice.sidecarRestarted': 'O sidecar foi reiniciado ({version}).',
  'notice.sidecarRestartFailed': 'Não foi possível reiniciar o sidecar',
  'notice.sidecarRestartRequiresIdle':
    'Reinicie o sidecar apenas quando o ditado e a leitura estiverem inativos.',
  'notice.transcriptRecordFailed': 'Não foi possível guardar a transcrição.',
  'notice.sidecarSessionError': 'O motor de voz comunicou um erro.',
  'notice.sidecarVersionDrift.actionMultiple': 'Atualizar motores de voz',
  'notice.sidecarVersionDrift.actionOne': 'Atualizar motor de voz',
  'notice.sidecarVersionDrift.cpu':
    'Atualizado para a versão {version}, mas o motor de voz instalado está desatualizado. Atualize-o agora para manter as versões sincronizadas.',
  'notice.sidecarVersionDrift.cpuAndCuda':
    'Atualizado para a versão {version}, mas os motores de voz de CPU e CUDA instalados estão desatualizados. Atualize-os agora para manter as versões sincronizadas.',
  'notice.sidecarVersionDrift.cuda':
    'Atualizado para a versão {version}, mas o motor de voz CUDA instalado está desatualizado. Atualize-o agora para manter as versões sincronizadas.',
  'notice.surfaceDesynchronized':
    'O ditado parou porque a nota foi alterada de uma forma que o Speech Kit não conseguiu acompanhar em segurança. Inicie novamente o ditado para continuar.',
  'notice.targetNoteClosed':
    'O ditado parou porque a nota de destino foi fechada ou substituída. Inicie novamente o ditado para continuar.',
  'notice.targetNoteDeleted':
    'O ditado parou porque a nota de destino foi eliminada. Restaure ou recrie a nota e inicie novamente o ditado.',
  'notice.transcriptWriteFailed':
    'O ditado parou porque o Speech Kit não conseguiu escrever na nota em segurança. Inicie novamente o ditado para continuar.',
  'setup.sidecar.cpu.firstRun.body':
    'O Speech Kit necessita de uma transferência única do motor de conversão de voz em texto para CPU a partir das versões do GitHub. Depois de concluída, a transcrição é executada localmente no seu computador. Pode instalar mais tarde a aceleração CUDA nas definições.',
  'setup.sidecar.cpu.firstRun.primaryButton': 'Transferir sidecar de CPU',
  'setup.sidecar.cpu.firstRun.success': 'O sidecar do Speech Kit foi instalado e iniciado.',
  'setup.sidecar.cpu.firstRun.title': 'Concluir a configuração do Speech Kit',
  'setup.sidecar.cpu.install.body':
    'Transfira o motor de conversão de voz em texto para CPU a partir das versões do GitHub. Depois de concluída, a transcrição é executada localmente no seu computador.',
  'setup.sidecar.cpu.install.primaryButton': 'Transferir sidecar de CPU',
  'setup.sidecar.cpu.install.success': 'O sidecar de CPU foi instalado e iniciado.',
  'setup.sidecar.cpu.install.title': 'Instalar sidecar de CPU',
  'setup.sidecar.cpu.reinstall.body':
    'Volte a transferir o motor de conversão de voz em texto para CPU a partir das versões do GitHub. Esta operação substitui a instalação atual da versão para CPU.',
  'setup.sidecar.cpu.reinstall.primaryButton': 'Voltar a transferir sidecar de CPU',
  'setup.sidecar.cpu.reinstall.success': 'O sidecar de CPU foi reinstalado e reiniciado.',
  'setup.sidecar.cpu.reinstall.title': 'Reinstalar sidecar de CPU',
  'setup.sidecar.cuda.install.primaryButton': 'Transferir sidecar CUDA',
  'setup.sidecar.cuda.install.success': 'O sidecar CUDA foi instalado e iniciado.',
  'setup.sidecar.cuda.install.title': 'Instalar aceleração CUDA',
  'setup.sidecar.mac.firstRun.body':
    'O Speech Kit necessita de uma transferência única do seu motor de conversão de voz em texto a partir das versões do GitHub. Depois de instalado, a transcrição é executada inteiramente no seu Mac — o áudio nunca sai do seu computador.',
  'setup.sidecar.mac.firstRun.primaryButton': 'Transferir sidecar',
  'setup.sidecar.mac.firstRun.success': 'O sidecar do Speech Kit foi instalado e iniciado.',
  'setup.sidecar.mac.firstRun.title': 'Concluir a configuração do Speech Kit',
  'setup.sidecar.mac.install.body':
    'Transfira o motor de conversão de voz em texto a partir das versões do GitHub. Depois de concluída, a transcrição é executada localmente no seu Mac.',
  'setup.sidecar.mac.install.primaryButton': 'Transferir sidecar',
  'setup.sidecar.mac.install.success': 'O sidecar foi instalado e iniciado.',
  'setup.sidecar.mac.install.title': 'Instalar sidecar',
  'setup.sidecar.mac.reinstall.body':
    'Volte a transferir o motor de conversão de voz em texto a partir das versões do GitHub. Esta operação substitui a instalação atual.',
  'setup.sidecar.mac.reinstall.primaryButton': 'Voltar a transferir sidecar',
  'setup.sidecar.mac.reinstall.success': 'O sidecar foi reinstalado e reiniciado.',
  'setup.sidecar.mac.reinstall.title': 'Reinstalar sidecar',
  'setup.sidecar.update.body':
    'Transfira o {engineLabel} atual para corresponder a esta versão do Speech Kit. As instalações existentes são substituídas no mesmo local.',
  'setup.sidecar.update.engine.cpuAndCuda': 'motores de voz de CPU e CUDA',
  'setup.sidecar.update.engine.cuda': 'motor de voz CUDA',
  'setup.sidecar.update.engine.default': 'motor de voz',
  'setup.sidecar.update.primaryButton_one': 'Atualizar motor de voz',
  'setup.sidecar.update.primaryButton_other': 'Atualizar motores de voz',
  'setup.sidecar.update.success_one': 'O motor de voz do Speech Kit foi atualizado e reiniciado.',
  'setup.sidecar.update.success_other':
    'Os motores de voz do Speech Kit foram atualizados e reiniciados.',
  'setup.sidecar.update.title_one': 'Atualizar motor de voz',
  'setup.sidecar.update.title_other': 'Atualizar motores de voz',
  'audio.microphone.permissionDeniedMac':
    'A permissão do microfone foi recusada. Abra Definições do Sistema → Privacidade e Segurança → Microfone, ative o Obsidian, reinicie o Obsidian e tente novamente.',
  'audio.microphone.permissionDenied':
    'A permissão do microfone foi recusada. Conceda acesso nas definições do sistema operativo e tente novamente.',
  'audio.microphone.notFound':
    'Não foi detetado nenhum microfone. Ligue um microfone ou auscultadores USB, ou ative um dispositivo de entrada nas definições de som do sistema operativo e tente novamente.',
  'audio.microphone.notReadable':
    'Não foi possível abrir o microfone. Pode estar a ser utilizado por outra aplicação ou pode ter ocorrido um erro no dispositivo de áudio. Feche as outras aplicações que estejam a utilizar o microfone e tente novamente.',
  'audio.systemAudio.notReady': 'O áudio do sistema não está pronto.',
  'audio.systemAudio.outdatedInstaller':
    '{message} O seu instalador do Obsidian é anterior à permissão de áudio do sistema do macOS. Transfira um instalador recente de obsidian.md, reinstale e tente novamente.',
  'commands.toggleDictation': 'Ativar/desativar ditado',
  'commands.startDictation': 'Iniciar ditado',
  'commands.stopDictation': 'Parar ditado',
  'commands.cancelDictation': 'Cancelar ditado',
  'commands.reinsertLastUtterance': 'Reinserir última frase',
  'commands.clearLastUtterance': 'Eliminar última frase',
  'commands.restoreRawTranscript': 'Restaurar transcrição original',
  'commands.copyRawTranscript': 'Copiar transcrição original',
  'commands.clearRawRecovery': 'Eliminar recuperação da transcrição original',
  'commands.checkSidecarHealth': 'Verificar estado do sidecar',
  'commands.restartSidecar': 'Reiniciar sidecar',
  'common.reset': 'Repor',
  'settings.acceleration.pending': 'pendente (sidecar não está pronto)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} indisponível)',
  'settings.acceleration.unknownReason': 'motivo desconhecido',
  'settings.dictationLanguage.autoDetect': 'Detetar automaticamente',
  'settings.dictationLanguage.name': 'Idioma do ditado',
  'settings.dictationLanguage.englishOnlyDesc':
    'O modelo selecionado, {model}, apenas suporta inglês.',
  'settings.dictationLanguage.desc':
    'Escolha o idioma em que vai falar. A seleção manual proporciona a limpeza mais previsível. A deteção automática pode demorar mais a iniciar e escolhe um idioma por frase.',
  'settings.dictationLanguage.unsupported': '{language} (não suportado)',
  'settings.engine.named': 'motor {engine}',
  'settings.groups.model': 'Modelos',
  'settings.groups.capture': 'Captura',
  'settings.groups.transcriptOutput': 'Saída da transcrição',
  'settings.groups.llmTransformation': 'Transformação por LLM',
  'settings.groups.engine': 'Motor',
  'settings.groups.advanced': 'Avançadas',
  'settings.listeningMode.alwaysOn': 'Sempre ativo',
  'settings.listeningMode.oneSentence': 'Uma frase',
  'settings.listeningMode.name': 'Modo de escuta',
  'settings.listeningMode.desc': 'Contínuo ou parar após uma frase.',
  'settings.insertText.atCursor': 'Na posição do cursor',
  'settings.insertText.endOfNote': 'No fim da nota',
  'settings.insertText.name': 'Inserir texto',
  'settings.insertText.desc': 'Local onde aparece o texto ditado.',
  'settings.transcriptFormatting.smartParagraphs': 'Parágrafos inteligentes',
  'settings.transcriptFormatting.space': 'Espaço',
  'settings.transcriptFormatting.newLine': 'Nova linha',
  'settings.transcriptFormatting.newParagraph': 'Novo parágrafo',
  'settings.transcriptFormatting.name': 'Formatação da transcrição',
  'settings.transcriptFormatting.desc': 'Forma como as frases são unidas.',
  'settings.phraseFinalization.responsiveOption': 'Responsivo — pausas curtas',
  'settings.phraseFinalization.balancedOption': 'Equilibrado — normal',
  'settings.phraseFinalization.patientOption': 'Tolerante — pausas longas',
  'settings.phraseFinalization.name': 'Finalização de frases',
  'settings.phraseFinalization.responsive':
    'Finaliza após pausas mais curtas para apresentar mais depressa o texto concluído.',
  'settings.phraseFinalization.balanced':
    'Utiliza a tolerância normal a pausas para o ditado quotidiano.',
  'settings.phraseFinalization.patient':
    'Aguarda durante pausas mais longas para reduzir a probabilidade de dividir uma ideia.',
  'settings.phraseFinalization.tooltip':
    'Aplica-se a todos os modelos de transcrição. As palavras em direto ainda podem ser atualizadas antes de a frase ser finalizada. Esta opção altera os limites da atividade de voz, não o estilo de escrita nem a precisão do modelo. Responsivo privilegia a rapidez; Tolerante mantém mais facilmente as pausas dentro da mesma frase.',
  'settings.systemAudio.name': 'Incluir áudio do sistema',
  'settings.systemAudio.desc':
    'Capturar também a saída de áudio predefinida deste computador para reuniões, chamadas e vídeos.',
  'settings.systemAudio.ready': 'O áudio do sistema está pronto.',
  'settings.systemAudio.testFailed':
    'Não foi possível testar o áudio do sistema. Verifique se o motor de voz está instalado e tente novamente.',
  'settings.speakerLabels.name': 'Identificação de oradores',
  'settings.speakerLabels.desc': 'Identificar o orador de cada frase.',
  'settings.speakerLabels.streamingLimitation':
    'A identificação de oradores requer um modelo de processamento em lote.',
  'settings.speakerLabels.modal.title': 'Definições de identificação de oradores',
  'settings.speakerLabels.modal.intro':
    'A identificação de oradores é executada no dispositivo após cada frase detetada por voz. Requer um modelo de transcrição em lote.',
  'settings.speakerLabels.maximumSpeakers.name': 'Número máximo de oradores',
  'settings.speakerLabels.maximumSpeakers.desc':
    'A opção Automático determina o número de oradores. Defina um limite apenas se aparecerem identificações de oradores a mais.',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    'Ative a identificação de oradores antes de configurar um limite.',
  'settings.speakerLabels.automatic': 'Automático',
  'settings.timestamps.enable.name': 'Utilizar marcas temporais',
  'settings.timestamps.enable.desc': 'Adicionar marcas temporais às transcrições ditadas.',
  'settings.timestamps.modal.title': 'Definições de marcas temporais',
  'settings.timestamps.modal.intro':
    'Escolha marcas em intervalos, nos limites das frases ou nas quebras de Parágrafos inteligentes.',
  'settings.timestamps.clock.elapsed': 'Tempo decorrido',
  'settings.timestamps.clock.wallClock': 'Hora local',
  'settings.timestamps.frequency.atIntervals': 'Em intervalos',
  'settings.timestamps.frequency.everyPhrase': 'Em todas as frases',
  'settings.timestamps.frequency.atParagraphBreaks': 'Nas quebras de parágrafo',
  'settings.timestamps.sessionHeader.name': 'Cabeçalho da sessão',
  'settings.timestamps.sessionHeader.desc':
    'Iniciar cada sessão com a marca temporal [YYYY-MM-DD HH:MM].',
  'settings.timestamps.referenceClock.name': 'Relógio de referência',
  'settings.timestamps.referenceClock.desc':
    'Tempo decorrido desde o início do ditado ou hora local.',
  'settings.timestamps.frequency.name': 'Frequência',
  'settings.timestamps.frequency.desc': 'Escolha a frequência das marcas temporais.',
  'settings.timestamps.frequency.sparseDesc': 'Adicionar marcas legíveis no intervalo configurado.',
  'settings.timestamps.frequency.everyPhraseDesc':
    'Adicionar uma marca temporal antes de cada segmento temporizado pelo modelo, quando disponível; caso contrário, em cada frase detetada por voz.',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    'Defina a Formatação da transcrição como Parágrafos inteligentes para obter quebras de parágrafo.',
  'settings.timestamps.frequency.paragraphDesc':
    'Adicionar uma marca temporal no início da sessão e em cada quebra de Parágrafo inteligente.',
  'settings.timestamps.interval.name': 'Intervalo',
  'settings.timestamps.interval.desc': 'Segundos entre marcas temporais ({min}-{max}).',
  'settings.timestamps.interval.inactiveDesc':
    'Utilizado apenas quando a frequência está definida como Em intervalos.',
  'settings.timestamps.interval.validation':
    'Introduza um número inteiro entre {min} e {max} segundos.',
  'settings.smartParagraph.modal.title': 'Definições de Parágrafos inteligentes',
  'settings.smartParagraph.modal.intro':
    'Os Parágrafos inteligentes transformam pausas mais longas em quebras de linha ou de parágrafo. Estes valores só se aplicam quando a formatação da transcrição está definida como Parágrafos inteligentes.',
  'settings.smartParagraph.lineBreakPause.name': 'Pausa para quebra de linha',
  'settings.smartParagraph.lineBreakPause.desc':
    'Segundos antes de uma única quebra de linha ({min}-{max}).',
  'settings.smartParagraph.paragraphPause.name': 'Pausa para parágrafo',
  'settings.smartParagraph.paragraphPause.desc':
    'Segundos antes de uma quebra de parágrafo ({min}-{max}).',
  'settings.llm.enableFeatures.name': 'Ativar funcionalidades de LLM',
  'settings.llm.enableFeatures.desc':
    'Disponibilizar transformações por LLM. Ative ou desative a transformação na barra lateral.',
  'settings.llm.restoreDefaults.name': 'Restaurar valores predefinidos da transformação',
  'settings.llm.restoreDefaults.desc':
    'Repor a predefinição, o momento de execução, o contexto, o número mínimo de palavras e a temperatura. As predefinições e os modelos guardados são mantidos.',
  'settings.llm.restoreDefaults.button': 'Restaurar',
  'settings.llm.restoreDefaults.confirmMessage':
    'Restaurar a predefinição, o momento de execução, o contexto, o número mínimo de palavras e a temperatura? As predefinições e os modelos guardados são mantidos.',
  'settings.llm.migratedPreset': 'A minha predefinição',
  'settings.llm.migratedPresetNumbered': 'A minha predefinição {number}',
  'settings.recoveryMemory.name': 'Manter o texto de recuperação na memória',
  'settings.recoveryMemory.desc':
    'Manter na memória o texto recuperável e a captura da nota mais recentes. Nada é escrito no disco.',
  'settings.modelStoreOverride.name': 'Substituir a pasta de armazenamento de modelos',
  'settings.modelStoreOverride.desc': 'Pasta personalizada para transferências de modelos geridos.',
  'settings.modelStoreOverride.placeholder':
    'Utilizar o armazenamento de modelos partilhado predefinido',
  'settings.runSetup.name': 'Executar configuração',
  'settings.runSetup.desc': 'Executar novamente o assistente de configuração inicial.',
  'settings.hardwareAcceleration.name': 'Aceleração por hardware',
  'settings.hardwareAcceleration.desc': 'Executar a inferência na GPU quando estiver disponível.',
  'settings.hardwareAcceleration.busy':
    'Não é possível alterar a aceleração por hardware durante o ditado ou a leitura em voz alta. Se o ditado continuar a ser processado depois de o parar, execute «Cancelar ditado».',
  'settings.hardwareAcceleration.on': 'A aceleração por hardware está ativada.',
  'settings.hardwareAcceleration.off': 'A aceleração por hardware está desativada.',
  'settings.noteContext.name': 'Utilizar a nota como contexto',
  'settings.noteContext.desc':
    'Para inglês selecionado manualmente, enviar termos específicos da nota aberta para melhorar a ortografia.',
  'settings.noteContext.tooltip':
    'Envia um glossário de nomes próprios e termos técnicos como instrução inicial do motor. Utilizado apenas para inglês selecionado manualmente com motores que suportam instruções iniciais.',
  'settings.microphone.name': 'Microfone',
  'settings.microphone.desc':
    'Microfone a utilizar para o ditado. As alterações são aplicadas na sessão de ditado seguinte.',
  'settings.microphone.default': 'Microfone predefinido',
  'settings.microphone.labelUnavailable': 'Microfone (nome indisponível)',
  'settings.microphone.notConnected': '{microphone} (não ligado)',
  'settings.microphone.detectTooltip': 'Detetar microfones (pede permissão)',
  'settings.microphone.allowAccessFirst':
    'Primeiro, permita o acesso ao microfone para guardar este dispositivo.',
  'settings.microphone.stopDictationToDetect': 'Pare o ditado para detetar microfones.',
  'settings.microphone.unavailableRuntime':
    'O acesso ao microfone não está disponível neste ambiente de execução.',
  'settings.microphone.detectFailed':
    'Não foi possível detetar microfones. Verifique as definições de áudio do sistema.',
  'settings.microphone.fallbackSaveFailed':
    'O microfone guardado não está disponível. Está a ser utilizado o microfone predefinido, mas não foi possível guardar esta alteração. Selecione um microfone disponível nas Definições antes de reiniciar o Obsidian.',
  'settings.microphone.fallbackUnchanged':
    'O microfone guardado não está disponível. Está a ser utilizado o microfone predefinido nesta sessão; a definição atual do microfone não foi alterada.',
  'settings.microphone.fallbackCleared':
    'O microfone guardado não está disponível. Está a ser utilizado o microfone predefinido; a seleção guardada foi eliminada para as sessões futuras.',
  'settings.model.notInstalled': 'Não instalado',
  'settings.model.validatedExternal': 'Validado · externo',
  'settings.model.external': 'Externo',
  'settings.model.checking': 'A verificar…',
  'settings.model.unavailable': 'Indisponível',
  'settings.model.noModel': 'Sem modelo',
  'settings.model.streaming': 'Transcrição em direto',
  'settings.model.manageModels': 'Gerir modelos',
  'settings.model.useExternalFile': 'Utilizar ficheiro externo',
  'settings.model.details': 'Detalhes do modelo',
  'settings.install.installingNamed': 'A instalar: {name}',
  'settings.install.installingSidecar': 'A instalar: sidecar {variant}',
  'settings.install.installingSidecarMac': 'A instalar sidecar',
  'settings.install.cancelling': 'A cancelar...',
  'settings.install.cancel': 'Cancelar',
  'settings.missingSidecar.name': 'Configurar o Speech Kit',
  'settings.missingSidecar.desc':
    'O Speech Kit ainda não está pronto. Execute o assistente de configuração para instalar o motor de voz e um modelo.',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': 'sidecar {variant}',
  'settings.sidecar.desc': 'Motor de conversão de voz em texto.',
  'settings.sidecar.cpuName': 'Sidecar de CPU',
  'settings.sidecar.cpuDesc': 'Motor de conversão de voz em texto. Obrigatório.',
  'settings.sidecar.gpuName': 'Sidecar de GPU',
  'settings.sidecar.cudaLibraryPath.name': 'Caminho das bibliotecas CUDA',
  'settings.sidecar.cudaLibraryPath.desc':
    'Caminho opcional de pesquisa de bibliotecas para o sidecar (Flatpak, instalações CUDA personalizadas).',
  'settings.sidecar.installAnyway': 'Instalar na mesma',
  'settings.sidecar.stopBeforeInstall':
    'Pare o ditado ou a leitura em voz alta antes de instalar um sidecar — a instalação reinicia o motor. Se o ditado ainda estiver a ser processado, execute «Cancelar ditado» para o parar agora.',
  'settings.sidecar.stopBeforeUninstall':
    'Pare o ditado ou a leitura em voz alta antes de desinstalar o {sidecar}. Se o ditado ainda estiver a ser processado, execute «Cancelar ditado» para o parar agora.',
  'settings.sidecar.uninstallFailed':
    'Não foi possível desinstalar o {sidecar}. Feche outras janelas de configuração e tente novamente.',
  'settings.sidecar.uninstalled': 'O sidecar foi desinstalado.',
  'settings.sidecar.cudaUninstalled': 'O sidecar CUDA foi desinstalado. A executar na CPU.',
  'settings.sidecar.cpuUninstalled': 'O sidecar de CPU foi desinstalado.',
  'settings.sidecar.restartFailed':
    'Não foi possível reiniciar o motor de voz. Reinicie o Obsidian antes de ditar.',
  'settings.sidecar.reinstall': 'Reinstalar',
  'settings.sidecar.uninstall': 'Desinstalar',
  'settings.sidecar.install': 'Instalar',
  'plugin.name': 'Speech Kit',
  'common.cancel': 'Cancelar',
  'common.delete': 'Eliminar',
  'common.duplicate': 'Duplicar',
  'common.free': 'Gratuito',
  'common.inherit': 'Herdar',
  'common.off': 'Desativado',
  'common.on': 'Ativado',
  'common.save': 'Guardar',
  'common.unavailable': 'Indisponível',
  'ribbon.idle': 'Speech Kit — iniciar ditado',
  'ribbon.starting': 'Speech Kit — a iniciar…',
  'ribbon.listening': 'Speech Kit — à escuta',
  'ribbon.speechDetected': 'Speech Kit — a detetar voz',
  'ribbon.error': 'Speech Kit — erro',
  'validation.wholeNumberRange': 'Introduza um número inteiro entre {min} e {max}.',
  'validation.numberRange': 'Introduza um número entre {min} e {max}.',
  'llm.managedByPreset': 'Gerido por «{preset}». Edite essa predefinição para alterar este valor.',
  'llm.context.title': 'Definições de contexto',
  'llm.context.settingsTooltip': 'Definições de contexto',
  'llm.context.intro':
    'Mais contexto pode melhorar a terminologia, mas pode aumentar a latência local ou o custo do OpenRouter.',
  'llm.context.noteLength.name': 'Tamanho do contexto da nota',
  'llm.context.noteLength.description':
    'Número máximo de caracteres retirados da nota atual acima do cursor.',
  'llm.context.previousPhrases.name': 'Frases anteriores',
  'llm.context.previousPhrases.description':
    'Frases ditadas recentemente incluídas como histórico da conversa.',
  'llm.context.afterEachPhraseOnly':
    'Utilizado apenas quando Executar transformação está definido como Após cada frase.',
  'llm.context.limit.name': 'Limite do contexto',
  'llm.context.limit.description':
    'Número máximo combinado de caracteres do contexto da nota e das frases anteriores.',
  'llm.context.useCurrentNote.name': 'Utilizar a nota atual como contexto',
  'llm.context.useCurrentNote.description': 'Incluir o texto acima do cursor em cada instrução.',
  'llm.model.title': 'Definições do modelo',
  'llm.model.settingsTooltip': 'Definições do modelo',
  'llm.model.temperature.name': 'Temperatura',
  'llm.model.temperature.description':
    'Variação da amostragem. 0 é determinístico; valores superiores produzem resultados mais variados.',
  'llm.model.behavior.name': 'Comportamento do modelo',
  'llm.model.summary.temperature': 'Temperatura {value}',
  'llm.model.summary.timeout': 'Tempo limite de {value}s',
  'llm.failure.authInvalid': 'A chave da API de {provider} foi rejeitada. Verifique as definições.',
  'llm.failure.rateLimited':
    'Foi atingido o limite de pedidos de {provider}. A utilizar o texto original.',
  'llm.failure.network': 'Erro de rede ao contactar {provider}.',
  'llm.failure.modelNotConfigured':
    'O modelo de {provider} não está configurado. Escolha um em Modelo.',
  'llm.failure.unknownModel': 'O modelo de {provider} não foi encontrado. Escolha outro em Modelo.',
  'llm.failure.unknown': 'A transformação por LLM falhou. Consulte a consola.',
  'llm.status.selectOllamaModel': 'Selecione abaixo um modelo do Ollama.',
  'llm.status.selectOpenRouterModel': 'Selecione abaixo um modelo do OpenRouter.',
  'llm.status.ollamaNotRunning': 'O Ollama não está em execução.',
  'llm.status.unreachable': 'Não é possível contactar {provider}.',
  'llm.status.authInvalid': 'A chave da API de {provider} foi rejeitada.',
  'llm.status.rateLimited': 'Foi atingido o limite de pedidos de {provider}.',
  'llm.status.noOllamaModels': 'Não existem modelos de conversação instalados no Ollama.',
  'llm.status.noModels': 'Não foram encontrados modelos utilizáveis de {provider}.',
  'llm.status.selectedUnavailable': 'O modelo selecionado não está disponível.',
  'llm.timing.title': 'Definições do momento de execução',
  'llm.timing.settingsTooltip': 'Definições do momento de execução',
  'llm.timing.minimumWords.name': 'Número mínimo de palavras',
  'llm.timing.minimumWords.description':
    'Ignorar a transformação quando a transcrição tiver menos palavras do que este valor.',
  'llm.timing.timestamps.perUtterance': 'Após cada frase preserva os limites das marcas temporais.',
  'llm.timing.timestamps.batch':
    'Tudo de uma vez pode reescrever ou remover marcas temporais, consoante a predefinição.',
  'llm.timing.option.perUtterance': 'Após cada frase',
  'llm.timing.option.batch': 'Tudo de uma vez ao parar',
  'llm.routing.priceTierTooltip': 'Escalão de preço aproximado',
  'llm.routing.providerModel': 'Modelo de {provider}',
  'llm.routing.ollamaModelDescription': 'Escolha um modelo de conversação local do Ollama.',
  'llm.routing.selectModel': 'Selecionar um modelo',
  'llm.routing.refreshModels': 'Atualizar modelos de {provider}',
  'llm.routing.openRouterModel.name': 'Modelo do OpenRouter',
  'llm.routing.openRouterModel.description': 'Escreva para pesquisar modelos do OpenRouter.',
  'llm.routing.testConnection': 'Testar chave da API e modelo',
  'llm.sidebar.eyebrow': 'Fluxo de trabalho da transcrição',
  'llm.sidebar.title': 'Transformar ditado',
  'llm.sidebar.description': 'Escolha como o texto falado é preparado antes de chegar à nota.',
  'llm.sidebar.group.preset': 'Predefinição',
  'llm.sidebar.group.model': 'Modelo',
  'llm.sidebar.group.context': 'Contexto',
  'llm.sidebar.enabled.name': 'Ativada',
  'llm.sidebar.enabled.description': 'Aplicar a predefinição ativa ao novo texto ditado.',
  'llm.sidebar.showOriginal.name': 'Mostrar transcrição original',
  'llm.sidebar.showOriginal.description':
    'Mantê-la numa caixa recolhível por baixo de cada resultado transformado.',
  'llm.sidebar.runTransform.name': 'Executar transformação',
  'llm.sidebar.runTransform.description':
    'Executar após cada frase ou tudo de uma vez quando parar.',
  'llm.sidebar.runTransform.setByPreset': 'Definido por {preset} — {timing}.',
  'llm.sidebar.activePreset': 'Predefinição ativa',
  'llm.sidebar.unavailable.title': 'As funcionalidades de LLM não estão disponíveis',
  'llm.sidebar.unavailable.description':
    'Ative as funcionalidades de LLM nas definições do Speech Kit para configurar transformações.',
  'llm.sidebar.unavailable.summary': 'Ativar funcionalidades de LLM nas definições',
  'llm.sidebar.off.title': 'Modo de transcrição original',
  'llm.sidebar.off.description':
    'O ditado insere a transcrição local original. Ative Transformar quando pretender fazer limpeza, reescrever ou resumir.',
  'llm.sidebar.off.summary': 'Transcrição original',
  'llm.sidebar.active.summary': '{preset} · {timing}',
  'llm.preset.builtin.cleanUp.label': 'Limpeza',
  'llm.preset.builtin.cleanUp.description':
    'Corrigir artefactos da transcrição, palavras de preenchimento, pontuação e maiúsculas, preservando o estilo e o significado.',
  'llm.preset.builtin.cleanUp.prompt':
    'Limpa o texto ditado. Corrige palavras de preenchimento, falsos arranques, repetições, pontuação, maiúsculas e erros óbvios de reconhecimento. Preserva o estilo e o significado do orador. Utiliza o contexto de referência apenas para a ortografia. Escreve no idioma original da transcrição. Nunca traduz, a menos que o utilizador peça explicitamente uma tradução. Devolve apenas o texto limpo — sem introdução nem comentários.',
  'llm.preset.builtin.professionalWriting.label': 'Escrita profissional',
  'llm.preset.builtin.professionalWriting.description':
    'Reescrever como prosa profissional, concisa e cuidada, preservando factos, nomes, decisões e termos técnicos.',
  'llm.preset.builtin.professionalWriting.prompt':
    'Reescreve o discurso ditado como prosa profissional concisa. Utiliza a voz ativa, sem palavras de preenchimento nem linguagem evasiva. Preserva todos os factos, nomes e termos. Utiliza o contexto de referência para a ortografia. Escreve no idioma original da transcrição. Nunca traduz, a menos que o utilizador peça explicitamente uma tradução. Devolve apenas o texto reescrito — sem introdução nem comentários.',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    'Adicionar um breve resumo TLDR acima da transcrição sem a alterar.',
  'llm.preset.builtin.tldr.prompt':
    'Escreve um resumo TLDR da transcrição ditada: um título «TLDR» seguido de 1 a 3 pontos curtos que abranjam os aspetos principais. Escreve no idioma original da transcrição. Nunca traduz, a menos que o utilizador peça explicitamente uma tradução. Devolve apenas o título e os pontos — não repitas a transcrição, não incluas introdução nem comentários.',
  'llm.preset.builtin.markdownFormatting.label': 'Formatação Markdown',
  'llm.preset.builtin.markdownFormatting.description':
    'Reformatar a transcrição da sessão como Markdown estruturado, com títulos, listas e ênfase.',
  'llm.preset.builtin.markdownFormatting.prompt':
    'Reformata o discurso ditado como Markdown bem estruturado. Adiciona títulos, listas com marcadores ou numeradas, negrito, ênfase e blocos de código delimitados onde o conteúdo o justificar. Corrige ligeiramente as palavras de preenchimento, os falsos arranques, a pontuação e as maiúsculas; preserva as palavras do orador e todos os factos, nomes e termos. Escreve no idioma original da transcrição. Nunca traduz, a menos que o utilizador peça explicitamente uma tradução. Devolve apenas o Markdown — sem introdução nem comentários.',
  'llm.preset.builtin.actionItems.label': 'Tarefas',
  'llm.preset.builtin.actionItems.description':
    'Adicionar uma lista de tarefas abaixo da transcrição sem a alterar.',
  'llm.preset.builtin.actionItems.prompt':
    'Extrai tarefas da transcrição ditada. Produz um título «Tarefas» seguido de uma lista de verificação Markdown com tarefas concretas, indicando um responsável quando o orador mencionar um. Se a transcrição não contiver tarefas, não devolvas nada. Escreve no idioma original da transcrição. Nunca traduz, a menos que o utilizador peça explicitamente uma tradução. Devolve apenas o título e a lista de verificação — não repitas a transcrição, não incluas introdução nem comentários.',
  'llm.preset.timing.perUtterance': 'É executada após cada frase',
  'llm.preset.timing.batch': 'É executada uma vez ao parar',
  'llm.preset.timing.either': 'É executada em qualquer dos modos',
  'llm.preset.behavior.addAbove': 'adiciona conteúdo novo acima da transcrição',
  'llm.preset.behavior.addBelow': 'adiciona conteúdo novo abaixo da transcrição',
  'llm.preset.behavior.replace': 'reescreve o texto ditado',
  'llm.preset.behavior.overrides': 'substitui {fields}',
  'llm.preset.override.minimumWords': 'mín. de palavras',
  'llm.preset.override.temperature': 'temperatura',
  'llm.preset.override.noteContext': 'contexto da nota',
  'llm.preset.option.perUtterance': '{preset} (após cada frase)',
  'llm.preset.option.batch': '{preset} (ao parar)',
  'llm.preset.copySuffix': ' (cópia)',
  'llm.preset.copySuffixNumbered': ' (cópia {number})',
  'llm.preset.validation.nameRequired': 'Introduza um nome para esta predefinição.',
  'llm.preset.validation.nameExists': 'Já existe uma predefinição com esse nome.',
  'llm.preset.validation.promptRequired': 'Introduza uma instrução para esta predefinição.',
  'llm.preset.validation.minimumWords':
    'O número mínimo de palavras tem de ser um número inteiro entre 0 e {max}.',
  'llm.preset.validation.temperature': 'A temperatura tem de ser um número entre 0 e {max}.',
  'llm.preset.validation.maximumCount':
    'Pode guardar até {max} predefinições. Elimine primeiro uma delas.',
  'llm.preset.validation.builtinName':
    'Esse nome é utilizado por uma predefinição incorporada — escolha outro nome.',
  'llm.preset.manager.title': 'Gerir predefinições',
  'llm.preset.manager.newTitle': 'Nova predefinição',
  'llm.preset.manager.editTitle': 'Editar predefinição',
  'llm.preset.manager.presets.name': 'Predefinições',
  'llm.preset.manager.presets.description':
    'A predefinição ativa está assinalada. As predefinições incorporadas são só de leitura — duplique uma para a personalizar.',
  'llm.preset.manager.new': 'Nova predefinição',
  'llm.preset.manager.searchPlaceholder': 'Pesquisar predefinições...',
  'llm.preset.manager.noMatches': 'Nenhuma predefinição corresponde à sua pesquisa.',
  'llm.preset.manager.builtinHeading': 'Incorporadas',
  'llm.preset.manager.yoursHeading': 'As suas predefinições',
  'llm.preset.manager.viewTooltip': 'Ver predefinição',
  'llm.preset.manager.editTooltip': 'Editar predefinição',
  'llm.preset.manager.duplicateTooltip': 'Duplicar predefinição',
  'llm.preset.manager.deleteTooltip': 'Eliminar predefinição «{preset}»',
  'llm.preset.manager.back': '← Todas as predefinições',
  'llm.preset.editor.name': 'Nome',
  'llm.preset.editor.namePlaceholder': 'p. ex., Notas da reunião',
  'llm.preset.editor.description': 'Descrição (opcional)',
  'llm.preset.editor.descriptionPlaceholder': 'Quando utilizar esta predefinição',
  'llm.preset.editor.prompt': 'Instrução',
  'llm.preset.editor.promptDescription': 'Enviada para o modelo como instrução do sistema.',
  'llm.preset.editor.promptSize':
    '~{tokens} tokens ({characters} caracteres) — enviados em cada pedido',
  'llm.preset.editor.timing': 'Momento de execução',
  'llm.preset.editor.timingDescription':
    'Quando a transformação é executada. «Qualquer modo» segue o momento definido na barra lateral.',
  'llm.preset.editor.timingEither': 'Qualquer modo (seguir a barra lateral)',
  'llm.preset.editor.timingPerUtterance': 'Após cada frase',
  'llm.preset.editor.timingBatch': 'Uma vez ao parar',
  'llm.preset.editor.output': 'Saída',
  'llm.preset.editor.outputDescription':
    'Substituir reescreve o texto ditado. Adicionar mantém-no intacto e insere conteúdo novo.',
  'llm.preset.editor.outputReplace': 'Substituir texto',
  'llm.preset.editor.outputAddAbove': 'Adicionar acima da transcrição',
  'llm.preset.editor.outputAddBelow': 'Adicionar abaixo da transcrição',
  'llm.preset.editor.overrides': 'Substituições',
  'llm.preset.editor.overridesDescription':
    'Deixe um campo em branco para utilizar a definição global.',
  'llm.preset.editor.minimumWords': 'Mín. de palavras',
  'llm.preset.delete.title': 'Eliminar predefinição',
  'llm.preset.delete.message':
    'Eliminar a predefinição «{preset}»? Esta ação não pode ser anulada.',
  'llm.preset.delete.activeFallback':
    '«{preset}» estava ativa — foi selecionada a predefinição Limpeza.',
  'common.back': 'Voltar',
  'common.close': 'Fechar',
  'common.done': 'Concluído',
  'common.install': 'Instalar',
  'common.later': 'Mais tarde',
  'common.next': 'Seguinte',
  'common.remove': 'Remover',
  'common.tryAgain': 'Tentar novamente',
  'setup.ready.waitForDictation': 'Aguarde que o ditado atual termine e tente novamente.',
  'setup.ready.openMarkdownNote':
    'Abra uma nota Markdown no modo de edição e tente novamente o ditado.',
  'setup.ready.completionFailed': 'Não foi possível concluir a configuração. Tente novamente.',
  'setup.wizard.welcomeTitle': 'Bem-vindo ao Speech Kit',
  'setup.wizard.title': 'Configurar o Speech Kit',
  'setup.wizard.engineReadyTitle': 'Motor de voz pronto',
  'setup.wizard.engineReadyDesc':
    'O motor local de conversão de voz em texto está instalado e pronto.',
  'setup.wizard.intro':
    'Dite notas sem utilizar as mãos, diretamente no Obsidian — tudo no seu computador. Sem conta, sem nuvem e sem telemetria.',
  'setup.wizard.quickSetup': 'Uma configuração rápida de 2 minutos:',
  'setup.wizard.downloadEngineStep': 'Transferir o motor de voz',
  'setup.wizard.pickModelStep': 'Escolher um modelo de transcrição',
  'setup.wizard.startTalking':
    'Depois, prima o microfone no friso (ou a sua tecla de atalho) e comece a falar.',
  'setup.wizard.downloadEngine': 'Transferir motor',
  'setup.wizard.modelSelectedTitle': 'Modelo selecionado',
  'setup.wizard.pickModelTitle': 'Escolher um modelo de transcrição',
  'setup.wizard.modelSelectedDesc':
    'Está instalado e selecionado um modelo de transcrição. Pode instalar outros ou mudar mais tarde nas Definições.',
  'setup.wizard.modelIntro':
    'Instale um modelo de transcrição para ativar o ditado. Pode instalar outros mais tarde — os modelos mais pequenos são mais rápidos e os maiores são mais precisos.',
  'setup.wizard.modelKinds':
    'Estão disponíveis dois tipos: os modelos com transcrição em direto mostram as palavras à medida que fala; os modelos padrão transcrevem após cada pausa. Para ditar sem utilizar as mãos, comece pelo modelo Moonshine Small recomendado. O Nemotron 3.5 ASR é uma opção de transcrição em direto que exige mais recursos.',
  'setup.wizard.openModelPicker': 'Abrir seletor de modelos',
  'setup.wizard.readyTitle': 'Já pode começar a ditar',
  'setup.wizard.readyDesc':
    'Experimente na nota Markdown que está aberta. Diga algumas palavras e utilize o microfone do friso ou a sua tecla de atalho para parar.',
  'setup.wizard.ribbonTitle': 'Utilizar o microfone do friso',
  'setup.wizard.ribbonDesc':
    'Procure este ícone no friso do Obsidian. Clique nele para começar a ditar; clique novamente para parar.',
  'setup.wizard.hotkeyTitle': 'Ou atribuir uma tecla de atalho',
  'setup.wizard.hotkeyDescBefore': 'Atribua um atalho ao comando ',
  'setup.wizard.toggleCommandName': 'Speech Kit: Ativar/desativar ditado',
  'setup.wizard.hotkeyDescAfter': ' para iniciar e parar a partir de qualquer local no Obsidian.',
  'setup.wizard.openHotkeySettings': 'Abrir definições das teclas de atalho',
  'setup.wizard.tryDictationNow': 'Experimentar o ditado agora',
  'setup.wizard.openHotkeySettingsFallback':
    'Abra Definições → Teclas de atalho e pesquise «Speech Kit».',
  'setup.sidecar.modal.download': 'Transferência',
  'setup.sidecar.modal.variantDownload': 'Transferência de {variant}',
  'setup.sidecar.modal.version': 'Versão',
  'setup.sidecar.modal.cancelling': 'A cancelar...',
  'setup.sidecar.modal.downloading': 'A transferir...',
  'setup.sidecar.modal.retryDownload': 'Repetir transferência',
  'setup.sidecar.modal.installFailureNotice':
    'A instalação do motor de voz falhou. Volte a abrir a configuração ou as Definições para consultar o erro e tentar novamente.',
  'setup.sidecar.modal.startFailed':
    'Não foi possível iniciar a instalação do sidecar. Feche outras janelas de configuração e tente novamente.',
  'setup.sidecar.installCancelled': 'A instalação do sidecar foi cancelada.',
  'setup.sidecar.progress.variant': ' sidecar {variant} ({current} de {total})',
  'setup.sidecar.progress.downloading': 'A transferir',
  'setup.sidecar.progress.verifying': 'A verificar a soma de verificação...',
  'setup.sidecar.progress.extracting': 'A extrair o arquivo...',
  'models.manage.title': 'Gerir modelos',
  'models.manage.loadFailedTitle': 'Não foi possível carregar os modelos',
  'models.manage.loadFailedDesc':
    'O motor de voz pode não estar instalado ou não estar a responder. Execute novamente a configuração para o reinstalar ou tente de novo.',
  'models.manage.runSetup': 'Executar configuração',
  'models.manage.loadingCatalog': 'A carregar o catálogo de modelos…',
  'models.manage.loadCatalogFailed': 'Não foi possível carregar o catálogo de modelos.',
  'models.manage.noneAvailable': 'Não existem modelos disponíveis para este motor.',
  'models.manage.unsupportedLanguage':
    ' · Não suporta {language}. Altere o Idioma do ditado para instalar ou utilizar este modelo.',
  'models.manage.use': 'Utilizar',
  'models.manage.selected': 'Selecionado',
  'models.manage.cancelling': 'A cancelar…',
  'models.manage.details': 'Detalhes',
  'models.manage.installStartFailed':
    'Não foi possível iniciar a instalação do modelo. Tente novamente.',
  'models.manage.selectFailed':
    'Não foi possível selecionar o modelo. Verifique se os respetivos ficheiros estão disponíveis.',
  'models.manage.selectedNotice': 'Modelo selecionado.',
  'models.manage.removeFailed':
    'Não foi possível remover o modelo. Feche todos os processos que estejam a utilizar os respetivos ficheiros.',
  'models.manage.removedNotice': 'Modelo removido.',
  'models.external.title': 'Utilizar ficheiro externo',
  'models.external.intro':
    'Os modelos externos destinam-se a utilização avançada. O Speech Kit não transfere nem atualiza estes ficheiros, nem verifica as respetivas somas de verificação.',
  'models.external.family.name': 'Família do modelo',
  'models.external.family.desc':
    'Escolha o carregador correspondente ao modelo. A família não é inferida a partir do nome do ficheiro.',
  'models.external.path.name': 'Caminho do ficheiro do modelo',
  'models.external.path.desc':
    'Introduza o caminho absoluto para o artefacto principal do modelo. Este é validado antes de a seleção ser guardada.',
  'models.external.validateAndUse': 'Validar e utilizar',
  'models.external.validating': 'A validar…',
  'models.external.selectedNotice': 'O ficheiro externo do modelo foi validado e selecionado.',
  'models.external.requirementsTitle': 'Requisitos dos ficheiros',
  'models.external.validation.notConfigured':
    'O caminho do ficheiro do modelo não está configurado.',
  'models.external.validation.notAbsolute':
    'O caminho do ficheiro do modelo tem de ser um caminho absoluto.',
  'models.external.validation.missing': 'O caminho do ficheiro do modelo não existe: {path}',
  'models.external.validation.notFile':
    'O caminho do ficheiro do modelo tem de apontar para um ficheiro: {path}',
  'models.external.validation.selectEntryFile': 'Selecione {filename}.',
  'models.external.validation.nemotronEntryFile':
    'O Nemotron 3.5 ASR requer o artefacto encoder.int8.onnx. Selecione encoder.int8.onnx no diretório da versão específica do modelo de 560 ms.',
  'models.external.validation.moonshineEntryFile':
    'O Moonshine requer o artefacto principal frontend.ort. Selecione frontend.ort no diretório do modelo com transcrição em direto.',
  'models.external.validation.generic': 'O motor de voz não conseguiu validar este modelo.',
  'models.external.requirements.nemotron.entry':
    'Selecione encoder.int8.onnx na exportação int8 específica de 560 ms do Nemotron 3.5 ASR.',
  'models.external.requirements.nemotron.siblings':
    'O mesmo diretório tem de conter decoder.int8.onnx, joiner.int8.onnx e tokens.txt.',
  'models.external.requirements.nemotron.compatibility':
    'Outros tamanhos de bloco e exportações ORT GenAI não são compatíveis com este adaptador.',
  'models.external.requirements.moonshine.entry':
    'Selecione frontend.ort num diretório de modelo ORT com transcrição em direto do Moonshine v2.',
  'models.external.requirements.moonshine.siblings':
    'O mesmo diretório tem de conter encoder.ort, adapter.ort, cross_kv.ort, decoder_kv.ort, streaming_config.json e tokenizer.bin.',
  'models.external.requirements.moonshine.compatibility':
    'As exportações ONNX do Moonshine sem transcrição em direto não são compatíveis.',
  'models.external.requirements.whisper.entry':
    'Selecione um ficheiro de modelo GGML ou GGUF compatível com whisper.cpp.',
  'models.external.requirements.whisper.validation':
    'O carregador valida o conteúdo do ficheiro; uma extensão de nome de ficheiro, por si só, não garante a compatibilidade.',
  'models.external.requirements.whisper.language':
    'Os ficheiros Whisper com pesos .en suportam apenas inglês; os pesos multilingues disponibilizam o seletor de idiomas verificado e a deteção automática.',
  'models.details.totalSize': 'Tamanho total',
  'models.details.source': 'Origem',
  'models.details.license': 'Licença',
  'models.details.capabilities': 'Capacidades',
  'models.details.installPath': 'Caminho da instalação',
  'models.details.files': 'Ficheiros ({count})',
  'models.details.size': 'Tamanho',
  'models.capability.segmentTimestamps': 'Marcas temporais dos segmentos',
  'models.capability.wordTimestamps': 'Marcas temporais das palavras',
  'models.capability.initialPrompt': 'Instrução inicial',
  'models.capability.streaming': 'Transcrição em direto',
  'models.capability.autoLanguageDetection': 'Deteção automática do idioma',
  'models.capability.punctuation': 'Pontuação',
  'models.capability.maxAudio': 'Áudio máximo: {seconds}s',
  'models.capability.anyLanguage': 'Qualquer idioma',
  'models.capability.englishOnly': 'Apenas inglês',
  'models.capability.languageCount': '{count} idiomas',
  'models.capability.languageSelection': 'Seleção do idioma',
  'models.tag.fullPrecision': 'Precisão total',
  'models.tag.reducedSize': 'Tamanho reduzido',
  'models.progress.preparing': 'A preparar a instalação',
  'models.progress.downloading': 'A transferir',
  'models.progress.verifying': 'A verificar a transferência',
  'models.progress.validating': 'A validar o modelo',
  'models.progress.installed': 'Modelo instalado',
  'models.progress.cancelled': 'Instalação do modelo cancelada',
  'models.progress.failed': 'A instalação do modelo falhou',
  'models.progress.downloadingFile': 'A transferir {filename}',
  'models.progress.verifyingFile': 'A verificar {filename}',
  'models.progress.fileCount': 'Ficheiro {current} de {total}',
  'models.current.noneSelected': 'Nenhum modelo selecionado',
  'models.current.noneSelectedDesc': 'Escolha um modelo instalado ou valide um ficheiro externo.',
  'models.current.notSelected': 'Não selecionado',
  'models.current.externalFile': 'Ficheiro externo',
  'models.current.managedNotInstalled': 'O modelo gerido selecionado não está instalado.',
  'models.current.installed': 'Instalado',
  'models.current.notInstalled': 'Não instalado',
  'models.current.managedDownload': 'Transferência gerida',
  'models.current.externalValidated': 'Externo validado',
  'models.current.checking': 'A verificar',
  'models.current.externalUnavailableDesc':
    'O modelo externo não está disponível. Valide novamente o ficheiro para ver os detalhes.',
  'models.current.unavailable': 'Indisponível',
  'models.current.validateBeforeDictating': 'Valide o ficheiro externo do modelo antes de ditar.',
  'sidecarError.audio_too_long': 'O clipe de áudio excede a duração máxima deste motor.',
  'sidecarError.engine_inference_failed': 'A transcrição local falhou.',
  'sidecarError.internal_error': 'O motor de voz encontrou um erro interno.',
  'sidecarError.invalid_audio_buffer':
    'A memória intermédia de áudio estava vazia quando a transcrição começou.',
  'sidecarError.invalid_audio_frame': 'O motor de voz recebeu uma trama de áudio inválida.',
  'sidecarError.invalid_diarization_speaker_limit':
    'O número máximo de oradores tem de ser pelo menos 1 ou estar definido como Automático.',
  'sidecarError.invalid_frame': 'O motor de voz recebeu uma trama de protocolo inválida.',
  'sidecarError.invalid_model_file':
    'O ficheiro do modelo está em falta, não pode ser lido ou não é suportado.',
  'sidecarError.invalid_model_task': 'O modelo selecionado não pode ser usado para ditado.',
  'sidecarError.invalid_model_store':
    'A pasta de armazenamento dos modelos não está disponível ou não é válida.',
  'sidecarError.missing_model_file': 'O ficheiro do modelo não existe ou não é um ficheiro normal.',
  'sidecarError.no_active_install': 'Não existe nenhuma instalação de modelo ativa para cancelar.',
  'sidecarError.no_active_session': 'Não existe nenhuma sessão de ditado ativa.',
  'sidecarError.session_already_exists': 'Já existe uma sessão de ditado com este ID.',
  'sidecarError.session_capacity_exceeded':
    'O Speech Kit já atingiu o número máximo de sessões ativas.',
  'sidecarError.system_audio_capture_failed':
    'Não foi possível iniciar a captura do áudio do sistema.',
  'sidecarError.system_audio_permission_denied':
    'A permissão de gravação do áudio do sistema está desativada para o Obsidian. Abra Definições do Sistema → Privacidade e Segurança → Gravação do Ecrã e do Áudio do Sistema, ative o Obsidian e tente novamente.',
  'sidecarError.system_audio_unsupported':
    'A captura do áudio do sistema ainda não está disponível nesta plataforma. Encaminhe a saída deste computador através de um dispositivo de áudio virtual e selecione-o como microfone — consulte o guia de áudio do sistema.',
  'sidecarError.transcription_failure': 'A transcrição local falhou.',
  'sidecarError.unsupported_engine': 'O motor pedido não está disponível nesta versão.',
  'sidecarError.unsupported_language': 'O modelo selecionado não suporta este idioma de ditado.',
  'sidecarError.utterance_dropped_during_overload_drain':
    'Foi descartada uma frase finalizada enquanto a fila de transcrição estava a ser esvaziada.',
  'sidecarError.utterance_queue_overload':
    'O ditado parou porque a fila de transcrição está sobrecarregada. O áudio aceite continuará a ser processado.',
  'sidecarError.vad_error': 'A deteção de atividade de voz falhou numa trama de áudio.',
  'sidecarError.vad_init_failed': 'Não foi possível inicializar o Silero VAD incluído.',
  'sidecarError.worker_panic': 'O processo de transcrição do motor de voz parou inesperadamente.',
  'catalog.whisper_tiny_en_q8_0.summary':
    'O modelo mais rápido e com menor consumo de recursos. Adequado para testes ou computadores de baixo consumo.',
  'catalog.whisper_base_en_q8_0.summary':
    'Modelo rápido com uma precisão razoável. Uma boa escolha para rascunhos rápidos na CPU.',
  'catalog.whisper_small_en_q5_1.summary':
    'Equilibra a qualidade da transcrição, o tamanho da transferência e a velocidade na CPU.',
  'catalog.whisper_medium_en_q5_0.summary':
    'Modelo de elevada precisão para quem dá prioridade à qualidade da transcrição em detrimento da velocidade.',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'Transcrição multilingue de elevada precisão com uma arquitetura otimizada para aceleração por GPU.',
  'catalog.cohere_transcribe_fp16.summary':
    'A maior variante do Cohere, que preserva a precisão total do modelo.',
  'catalog.cohere_transcribe_int8.summary':
    'Variante intermédia do Cohere em termos de tamanho da transferência, com quantização de 8 bits.',
  'catalog.cohere_transcribe_q4.summary':
    'A menor variante do Cohere; a quantização de 4 bits reduz o tamanho à custa da qualidade.',
  'catalog.moonshine_tiny_streaming_en.summary':
    'O modelo Moonshine com transcrição em direto mais rápido, com 34 milhões de parâmetros, concebido para CPUs de gama baixa.',
  'catalog.moonshine_small_streaming_en.summary':
    'Modelo equilibrado de ditado em direto, com 123 milhões de parâmetros.',
  'catalog.moonshine_medium_streaming_en.summary':
    'O modelo Moonshine com transcrição em direto mais preciso, com 245 milhões de parâmetros.',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'RNNT multilingue de 0,6 mil milhões de parâmetros da NVIDIA, exportado para ONNX int8 para transcrição em direto com gestão de cache em oito idiomas verificados.',
  'catalog.family.whisper.summary':
    'Transcreve após cada pausa. O Whisper fornece marcas temporais mais precisas do que outras famílias de modelos, incluindo temporização opcional ao nível das palavras. Tiny e Base privilegiam a velocidade, Small equilibra a velocidade e a qualidade, e Medium e Large privilegiam a qualidade.',
  'catalog.family.cohere_transcribe.summary':
    'Transcrição em lote de alta qualidade, com transferências de vários gigabytes e elevados requisitos de memória.',
  'catalog.family.moonshine.summary':
    'Mostra as palavras enquanto fala. Tiny privilegia um menor consumo de recursos, Small equilibra a velocidade e a qualidade, e Medium privilegia a qualidade.',
  'catalog.family.nemotron_asr.summary':
    'Transcrição em direto multilingue de elevada precisão, com uma transferência maior e maior consumo de recursos. O Moonshine Small continua a ser a opção predefinida recomendada para ditado em direto em inglês.',
  'setup.sidecar.modal.unsupportedPlatform':
    'Esta versão do motor de voz não está disponível para a sua plataforma ou arquitetura.',
  'setup.sidecar.modal.genericInstallError':
    'Não foi possível instalar o motor de voz. Consulte os registos do plugin para obter detalhes e tente novamente.',
  'commands.readAloud': 'Ler em voz alta',
  'commands.pauseResumeReadAloud': 'Pausar ou retomar a leitura',
  'commands.stopReadAloud': 'Parar a leitura',
  'settings.groups.readAloud': 'Leitura em voz alta',
  'settings.model.noModelSelected': 'Nenhum modelo selecionado',
  'settings.model.speechToText': 'Modelo de voz para texto',
  'settings.model.textToSpeech': 'Modelo de texto para voz',
  'settings.readAloud.hotkey': 'Atalho recomendado',
  'settings.readAloud.hotkeyDesc':
    'Associe um atalho a Ler em voz alta. Lê o texto selecionado ou a nota inteira quando não há seleção.',
  'settings.readAloud.voice': 'Voz',
  'settings.readAloud.voiceDesc': 'Escolha entre as vozes instaladas para o modelo selecionado.',
  'settings.readAloud.noVoices': 'Nenhuma voz instalada',
  'settings.readAloud.speed': 'Velocidade de leitura',
  'settings.readAloud.speedDesc':
    'Alterar a velocidade durante a leitura reinicia a partir da frase atual.',
  'models.manage.dictationModels': 'Voz para texto',
  'models.manage.readAloudModels': 'Texto para voz',
  'models.manage.allLanguages': 'Todos os idiomas',
  'models.manage.familiesLabel': 'Famílias de modelos',
  'models.manage.noneForLanguage': 'Não há modelos disponíveis para esta tarefa e idioma.',
  'models.manage.optionalVoice': 'Voz local opcional',
  'models.manage.voiceInstalled': 'Instalada',
  'tts.status.reading': 'A ler…',
  'tts.status.paused': 'Leitura em pausa',
  'tts.control.model': 'Modelo: {model}',
  'tts.control.speed': 'Velocidade: {speed}',
  'tts.notice.noText': 'Não há texto legível aqui.',
  'tts.notice.modelRequired': 'Instale e selecione primeiro um modelo de leitura.',
  'tts.notice.voiceRequired': 'Selecione primeiro uma voz instalada.',
  'tts.notice.startFailed': 'Não foi possível iniciar a leitura.',
  'tts.notice.playbackFailed': 'Falha na reprodução de áudio.',
  'tts.notice.sidecarExited': 'A leitura parou porque o sidecar terminou inesperadamente.',
  'sidecarError.invalid_synthesis_request': 'O pedido de leitura é inválido.',
  'sidecarError.missing_voice_file': 'A voz de leitura selecionada não está instalada.',
  'sidecarError.sidecar_exited': 'O processo sidecar terminou inesperadamente.',
  'sidecarError.synthesis_cancelled': 'A leitura foi cancelada.',
  'sidecarError.synthesis_failed': 'A síntese de voz local falhou.',
  'sidecarError.synthesis_worker_unavailable':
    'O processo de síntese de voz local não está disponível.',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    'Leitura natural local em inglês com uma seleção de vozes escolhidas.',
  'catalog.family.pocket_tts.summary':
    'Lê notas localmente em inglês, francês, alemão, espanhol, português e italiano com vozes selecionáveis e controlo de velocidade que preserva o tom.',
  'commands.translateNote': 'Traduzir nota',
  'commands.translateSelection': 'Traduzir seleção',
  'models.manage.translationModels': 'Tradução',
  'translation.modal.privacy': 'A tradução é executada inteiramente neste dispositivo.',
  'translation.modal.from': 'De',
  'translation.modal.to': 'Para',
  'translation.modal.swap': 'Trocar',
  'translation.modal.largeNote': 'Nota grande: a tradução pode levar alguns segundos.',
  'translation.modal.sourceSelection': 'Seleção de origem',
  'translation.modal.sourceNote': 'Nota de origem',
  'translation.modal.previewAria': 'Prévia da tradução',
  'translation.modal.preparing': 'Preparando a tradução local…',
  'translation.modal.loading': 'Carregando o modelo local…',
  'translation.modal.translating': 'Traduzindo…',
  'translation.modal.translatingProgress': 'Traduzindo… {completed}/{total}',
  'translation.modal.ready': 'Tradução pronta.',
  'translation.modal.readyPartial_one':
    'Tradução pronta. 1 bloco ficou no idioma original porque não foi possível preservar sua formatação.',
  'translation.modal.readyPartial_other':
    'Tradução pronta. {count} blocos ficaram no idioma original porque não foi possível preservar sua formatação.',
  'translation.modal.canceled': 'Tradução cancelada.',
  'translation.modal.failed': 'A tradução falhou.',
  'translation.modal.missingModel':
    'Instale o pacote de tradução local para usar este par de idiomas.',
  'translation.modal.incompleteModel':
    'Faltam arquivos ao modelo de tradução. Reinstale-o para continuar.',
  'translation.modal.installModel': 'Instalar modelo de tradução',
  'translation.modal.translateAgain': 'Traduzir novamente',
  'translation.modal.cancel': 'Cancelar',
  'translation.modal.replace': 'Substituir',
  'translation.modal.insertBelow': 'Inserir abaixo',
  'translation.modal.copy': 'Copiar',
  'translation.modal.stale':
    'A nota mudou desde que esta tradução começou. Copie a tradução em vez disso.',
  'translation.notice.copied': 'Tradução copiada.',
  'translation.notice.copyFailed': 'Não foi possível copiar a tradução.',
  'translation.notice.tooLong': 'Traduza até {count} caracteres por vez.',
  'catalog.firefox_translations_release_2026_07.summary':
    'Tradução local rápida entre inglês e sete idiomas com modelos publicados no Firefox.',
  'catalog.family.firefox_translations.summary':
    'Traduz o texto das notas localmente com o mecanismo compacto Bergamot e modelos do Firefox.',
} satisfies TranslationCatalog;
