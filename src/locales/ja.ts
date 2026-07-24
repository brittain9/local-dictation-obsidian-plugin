import type { TranslationCatalog } from '.';

export const ja = {
  'notice.dictationNotActive': 'ディクテーションは現在有効ではありません。',
  'notice.dictationStartFailed': 'ディクテーションを開始できませんでした。',
  'notice.dictationStopFailed': 'ディクテーションを停止できませんでした。',
  'notice.lastUtteranceCleared': '最後に残された発話をクリアしました。',
  'notice.lastUtteranceReinsertFailed': '最後に確定した発話を再挿入できませんでした。',
  'notice.lastUtteranceReinserted': '最後に確定した発話を再挿入しました。',
  'notice.lastUtteranceUnavailable': '再挿入できる最終的な発話はありません。',
  'notice.llmTransformEmpty': 'LLM変換は追加するものを何も返しませんでした。',
  'notice.microphoneDisconnected':
    'マイクが切断されました。ディクテーションが停止し、すでにキャプチャされたオーディオの処理が完了します。マイクを再接続して、もう一度ディクテーションを開始します。',
  'notice.rawTranscriptChanged':
    'クリーンアップ後にメモが変更されたため、生のトランスクリプトを復元できませんでした。',
  'notice.rawTranscriptCleared': '生のトランスクリプトの回復をクリアしました。',
  'notice.rawTranscriptCopied': '生のトランスクリプトをコピーしました。',
  'notice.rawTranscriptCopyFailed': '生のトランスクリプトをコピーできませんでした。',
  'notice.rawTranscriptRestored': '生のトランスクリプトを復元しました。',
  'notice.rawTranscriptRestoreFailed': '生のトランスクリプトを復元できませんでした。',
  'notice.rawTranscriptTargetUnavailable':
    '元のメモが同じエディタで開かれなくなったため、生のトランスクリプトを復元できませんでした。',
  'notice.rawTranscriptUnavailable': '生のトランスクリプトリカバリは利用できません。',
  'notice.sidecarHealthCheckFailed': 'Sidecarヘルスチェックに失敗しました',
  'notice.sidecarReady': 'Sidecarの準備ができました（ {version} ）。',
  'notice.sidecarRestarted': 'sidecar ({version})を再起動しました。',
  'notice.sidecarRestartFailed': 'Sidecarの再起動に失敗しました',
  'notice.sidecarRestartRequiresIdle':
    '音声入力と読み上げが停止中の場合のみサイドカーを再起動してください。',
  'notice.transcriptRecordFailed': 'トランスクリプトを記録できませんでした。',
  'notice.sidecarSessionError': '音声エンジンがエラーを報告しました。',
  'notice.sidecarVersionDrift.actionMultiple': '音声エンジンをアップデートする',
  'notice.sidecarVersionDrift.actionOne': '音声エンジンを更新する',
  'notice.sidecarVersionDrift.cpu':
    '{version}に更新されましたが、インストールされている音声エンジンは古くなっています。今すぐ更新して、同期を維持しましょう。',
  'notice.sidecarVersionDrift.cpuAndCuda':
    '{version}に更新されましたが、インストールされているCPUおよびCUDA音声エンジンは古くなっています。今すぐ更新して、同期を維持しましょう。',
  'notice.sidecarVersionDrift.cuda':
    '{version}に更新されましたが、インストールされたCUDA音声エンジンは古くなっています。今すぐ更新して、同期を維持しましょう。',
  'notice.surfaceDesynchronized':
    'Local Dictationが安全に追跡できなかった方法でメモが変更されたため、ディクテーションが停止しました。続行するには、再度ディクテーションを開始してください。',
  'notice.targetNoteClosed':
    'ターゲットノートが閉じられたか置き換えられたため、ディクテーションが停止しました。続行するには、再度ディクテーションを開始してください。',
  'notice.targetNoteDeleted':
    'ターゲットノートが削除されたため、ディクテーションが停止しました。メモを復元または再作成してから、再度ディクテーションを開始します。',
  'notice.transcriptWriteFailed':
    'Local Dictationが安全にメモに書き込めなかったため、ディクテーションが停止しました。続行するには、再度ディクテーションを開始してください。',
  'setup.sidecar.cpu.firstRun.body':
    'Local Dictationは、GitHubリリースからCPU音声テキスト変換エンジンを1回限りダウンロードする必要があります。これが完了すると、マシン上でローカルにトランスクリプションが実行されます。CUDAアクセラレーションは、後で設定からインストールできます。',
  'setup.sidecar.cpu.firstRun.primaryButton': 'CPU sidecarをダウンロード',
  'setup.sidecar.cpu.firstRun.success': 'Local Dictation sidecar をインストールして起動しました。',
  'setup.sidecar.cpu.firstRun.title': 'Local Dictation のセットアップを完了する',
  'setup.sidecar.cpu.install.body':
    'GitHub リリースから CPU 音声テキスト変換エンジンをダウンロードします。これが完了すると、転写がマシン上でローカルに実行されます。',
  'setup.sidecar.cpu.install.primaryButton': 'CPU sidecar をダウンロード',
  'setup.sidecar.cpu.install.success': 'CPU sidecarをインストールして起動しました。',
  'setup.sidecar.cpu.install.title': 'CPU sidecar をインストールする',
  'setup.sidecar.cpu.reinstall.body':
    'GitHub リリースから CPU 音声テキスト変換エンジンを再ダウンロードします。これは、現在の CPU インストールを置き換えます。',
  'setup.sidecar.cpu.reinstall.primaryButton': 'CPU sidecar を再ダウンロード',
  'setup.sidecar.cpu.reinstall.success': 'CPU sidecar を再インストールして再起動しました。',
  'setup.sidecar.cpu.reinstall.title': 'CPU sidecar を再インストールします',
  'setup.sidecar.cuda.install.body':
    'NVIDIA GPU 用の CUDA アクセラレーション済み sidecar をダウンロードします。これは、アクティブな CPU sidecar を置き換えます。 CPU sidecar はフォールバックとしてインストールされたままになります。',
  'setup.sidecar.cuda.install.primaryButton': 'CUDA sidecar をダウンロード',
  'setup.sidecar.cuda.install.success': 'CUDA sidecarをインストールして起動しました。',
  'setup.sidecar.cuda.install.title': 'CUDA アクセラレーションをインストールする',
  'setup.sidecar.mac.firstRun.body':
    'Local Dictation では、GitHub リリースから音声テキスト変換エンジンを 1 回だけダウンロードする必要があります。インストールすると、文字起こしは完全に Mac 上で実行されます。オーディオがマシンから離れることはありません。',
  'setup.sidecar.mac.firstRun.primaryButton': 'sidecar をダウンロード',
  'setup.sidecar.mac.firstRun.success': 'Local Dictation sidecar をインストールして起動しました。',
  'setup.sidecar.mac.firstRun.title': 'Local Dictation のセットアップを完了する',
  'setup.sidecar.mac.install.body':
    'GitHub リリースから音声テキスト変換エンジンをダウンロードします。これが完了すると、文字起こしが Mac 上でローカルに実行されます。',
  'setup.sidecar.mac.install.primaryButton': 'sidecar をダウンロード',
  'setup.sidecar.mac.install.success': 'Sidecarをインストールして起動しました。',
  'setup.sidecar.mac.install.title': 'sidecarをインストールする',
  'setup.sidecar.mac.reinstall.body':
    'GitHub リリースから音声テキスト変換エンジンを再ダウンロードします。これにより、現在のインストールが置き換えられます。',
  'setup.sidecar.mac.reinstall.primaryButton': 'sidecarを再ダウンロード',
  'setup.sidecar.mac.reinstall.success': 'Sidecarを再インストールして再起動しました。',
  'setup.sidecar.mac.reinstall.title': 'sidecarを再インストールする',
  'setup.sidecar.update.body':
    'このバージョンの Local Dictation と一致するように、現在の {engineLabel} をダウンロードします。既存のインストールは置き換えられます。',
  'setup.sidecar.update.engine.cpuAndCuda': 'CPU および CUDA 音声エンジン',
  'setup.sidecar.update.engine.cuda': 'CUDA 音声エンジン',
  'setup.sidecar.update.engine.default': '音声エンジン',
  'setup.sidecar.update.primaryButton_one': '音声エンジンを更新する',
  'setup.sidecar.update.primaryButton_other': '音声エンジンを更新する',
  'setup.sidecar.update.success_one': 'Local Dictation 音声エンジンが更新され、再起動されました。',
  'setup.sidecar.update.success_other':
    'Local Dictation 音声エンジンが更新され、再起動されました。',
  'setup.sidecar.update.title_one': '音声エンジンを更新する',
  'setup.sidecar.update.title_other': '音声エンジンを更新する',
  'audio.microphone.permissionDeniedMac':
    'マイクの許可が拒否されました。 [システム設定] → [プライバシーとセキュリティ] → [マイク] を開き、Obsidian を有効にしてから、Obsidian を再起動して再試行します。',
  'audio.microphone.permissionDenied':
    'マイクの許可が拒否されました。 OS 設定でアクセスを許可して、再試行してください。',
  'audio.microphone.notFound':
    'マイクが検出されませんでした。マイクまたは USB ヘッドセットを接続するか、OS のサウンド設定で入力デバイスを有効にしてから、再試行してください。',
  'audio.microphone.notReadable':
    'マイクを開けませんでした。別のアプリが使用しているか、オーディオ デバイスにエラーが発生している可能性があります。マイクを使用している他のアプリを閉じて、もう一度試してください。',
  'audio.systemAudio.notReady': 'システムオーディオの準備ができていません。',
  'audio.systemAudio.outdatedInstaller':
    '{message} Obsidian インストーラーは、macOS システムオーディオ権限よりも古いものです。 obsidian.md から新しいインストーラーをダウンロードして再インストールし、もう一度試してください。',
  'commands.toggleDictation': 'ディクテーションの切り替え',
  'commands.startDictation': 'ディクテーションを開始する',
  'commands.stopDictation': 'ディクテーションを停止する',
  'commands.cancelDictation': 'ディクテーションをキャンセルする',
  'commands.reinsertLastUtterance': '最後の発話を再挿入',
  'commands.clearLastUtterance': '最後の発話を消去',
  'commands.restoreRawTranscript': '生のトランスクリプトを復元する',
  'commands.copyRawTranscript': '生のトランスクリプトをコピーする',
  'commands.clearRawRecovery': '未加工テキストの復元データを消去',
  'commands.checkSidecarHealth': 'sidecar の状態をチェックする',
  'commands.restartSidecar': 'sidecarを再起動します',
  'common.reset': 'リセット',
  'settings.acceleration.pending': '保留中 (sidecar の準備ができていません)',
  'settings.acceleration.unavailable': 'CPU ({accelerator} は使用不可)',
  'settings.acceleration.unknownReason': '不明な理由',
  'settings.dictationLanguage.autoDetect': '自動検出',
  'settings.dictationLanguage.name': 'ディクテーション言語',
  'settings.dictationLanguage.englishOnlyDesc':
    '選択したモデル「{model}」は英語のみをサポートします。',
  'settings.dictationLanguage.desc':
    '話す言語を選択してください。手動で選択すると、最も予測可能なクリーンアップが得られます。自動検出は開始が遅くなる場合があり、発話ごとに 1 つの言語を選択します。',
  'settings.dictationLanguage.unsupported': '{language}（サポート対象外）',
  'settings.engine.named': '{engine}エンジン',
  'settings.groups.model': 'モデル',
  'settings.groups.capture': '録音',
  'settings.groups.transcriptOutput': 'トランスクリプト出力',
  'settings.groups.timestamps': 'タイムスタンプ',
  'settings.groups.llmTransformation': 'LLM変換',
  'settings.groups.engine': 'エンジン',
  'settings.groups.advanced': '詳細設定',
  'settings.listeningMode.alwaysOn': '常時オン',
  'settings.listeningMode.oneSentence': '一文',
  'settings.listeningMode.name': 'リスニングモード',
  'settings.listeningMode.desc': '継続するか、1 文で停止します。',
  'settings.insertText.atCursor': 'カーソル位置',
  'settings.insertText.endOfNote': 'メモの終わり',
  'settings.insertText.name': 'テキストの挿入',
  'settings.insertText.desc': '口述テキストが表示される場所。',
  'settings.transcriptFormatting.smartParagraphs': 'スマートな段落',
  'settings.transcriptFormatting.space': 'スペース',
  'settings.transcriptFormatting.newLine': '改行',
  'settings.transcriptFormatting.newParagraph': '新しい段落',
  'settings.transcriptFormatting.name': 'トランスクリプトのフォーマット',
  'settings.transcriptFormatting.desc': 'フレーズがどのように結合されるか。',
  'settings.phraseFinalization.responsiveOption': 'すばやく — 短い間隔',
  'settings.phraseFinalization.balancedOption': '標準 — 通常の間隔',
  'settings.phraseFinalization.patientOption': 'じっくり — 長い間隔',
  'settings.phraseFinalization.name': 'フレーズの確定',
  'settings.phraseFinalization.responsive':
    '短い一時停止の後に終了し、テキストをより速く完成させることができます。',
  'settings.phraseFinalization.balanced':
    '毎日のディクテーションには標準の一時停止許容値を使用します。',
  'settings.phraseFinalization.patient':
    '長めの間隔でも待機し、ひとつの考えが分割されにくくなります。',
  'settings.phraseFinalization.tooltip':
    'すべての文字起こしモデルに適用されます。フレーズが確定する前もリアルタイムの単語は更新されます。変更されるのは音声区間の境界であり、文体やモデル精度ではありません。「すばやく」は速度を優先し、「じっくり」は間隔があってもひとつのフレーズとして扱います。',
  'settings.systemAudio.name': 'システムオーディオを含める',
  'settings.systemAudio.desc':
    'また、会議、通話、ビデオ用のこのコンピュータのデフォルトのオーディオ出力もキャプチャします。',
  'settings.systemAudio.ready': 'システムオーディオの準備ができました。',
  'settings.systemAudio.testFailed':
    'システムオーディオをテストできませんでした。音声エンジンがインストールされていることを確認して、もう一度試してください。',
  'settings.speakerLabels.name': '話者ラベル',
  'settings.speakerLabels.desc': '各フレーズに話者ごとにラベルを付けます。',
  'settings.speakerLabels.streamingLimitation': '話者ラベルにはバッチモデルが必要です。',
  'settings.speakerLabels.modal.title': '話者ラベルの設定',
  'settings.speakerLabels.modal.intro':
    '話者ラベルは、音声が検出された各フレーズの後にデバイス上で実行されます。バッチ転写モデルが必要です。',
  'settings.speakerLabels.maximumSpeakers.name': '最大話者数',
  'settings.speakerLabels.maximumSpeakers.desc':
    '「自動」では話者数を自動判定します。不要な話者ラベルが表示される場合のみ上限を設定してください。',
  'settings.speakerLabels.maximumSpeakers.disabledDesc':
    '話者数の上限を設定する前に、話者ラベルを有効にしてください。',
  'settings.speakerLabels.automatic': '自動',
  'settings.timestamps.enable.name': 'タイムスタンプを使用する',
  'settings.timestamps.enable.desc':
    'ディクテーションの文字起こしに目印となるタイムスタンプを追加します。',
  'settings.timestamps.modal.title': 'タイムスタンプの設定',
  'settings.timestamps.modal.intro':
    '間隔、フレーズの境界、またはスマートな段落区切りでランドマークを選択します。',
  'settings.timestamps.clock.elapsed': '経過',
  'settings.timestamps.clock.wallClock': '実時刻',
  'settings.timestamps.frequency.atIntervals': '間隔をあけて',
  'settings.timestamps.frequency.everyPhrase': 'すべてのフレーズ',
  'settings.timestamps.frequency.atParagraphBreaks': '段落の区切りで',
  'settings.timestamps.sessionHeader.name': 'セッションヘッダー',
  'settings.timestamps.sessionHeader.desc':
    'タイムスタンプ付きの各セッションを [YYYY-MM-DD HH:MM] で開始します。',
  'settings.timestamps.referenceClock.name': '基準クロック',
  'settings.timestamps.referenceClock.desc':
    'ディクテーション開始からの経過時間、または現地の実時刻を使用します。',
  'settings.timestamps.frequency.name': '頻度',
  'settings.timestamps.frequency.desc': 'タイムスタンプが表示される頻度を選択します。',
  'settings.timestamps.frequency.sparseDesc':
    '設定された間隔で読み取り可能なランドマークを追加します。',
  'settings.timestamps.frequency.everyPhraseDesc':
    'タイムスタンプが利用可能な場合は各モデルタイミングセグメントの前に追加し、それ以外の場合は各音声検出フレーズにタイムスタンプを追加します。',
  'settings.timestamps.frequency.paragraphUnavailableDesc':
    '段落区切りを取得するには、トランスクリプトの書式設定をスマート段落に設定します。',
  'settings.timestamps.frequency.paragraphDesc':
    'セッションの開始時と各スマート段落区切りにタイムスタンプを追加します。',
  'settings.timestamps.interval.name': '間隔',
  'settings.timestamps.interval.desc': 'タイムスタンプ ランドマーク間の秒数 ({min} ～ {max})。',
  'settings.timestamps.interval.inactiveDesc':
    '頻度が [間隔] に設定されている場合にのみ使用されます。',
  'settings.timestamps.interval.validation': '{min} から {max} 秒までの整数を入力します。',
  'settings.smartParagraph.modal.title': 'スマートな段落設定',
  'settings.smartParagraph.modal.intro':
    'スマートな段落は、長い一時停止を改行または段落の区切りに変換します。これらの値は、トランスクリプトの書式設定がスマート段落に設定されている場合にのみ適用されます。',
  'settings.smartParagraph.lineBreakPause.name': '改行一時停止',
  'settings.smartParagraph.lineBreakPause.desc': '単一の改行前の秒数 ({min}-{max})。',
  'settings.smartParagraph.paragraphPause.name': '段落の一時停止',
  'settings.smartParagraph.paragraphPause.desc': '段落区切り前の秒数 ({min}-{max})。',
  'settings.llm.enableFeatures.name': 'LLM 機能を有効にする',
  'settings.llm.enableFeatures.desc':
    'LLM 変換を利用可能にします。サイドバーで変換をオンまたはオフにします。',
  'settings.llm.enableRemote.name': 'リモート LLM を有効にする',
  'settings.llm.enableRemote.desc':
    'トランスクリプト テキストと含まれるメモのコンテキストを OpenRouter に送信できるようにします。音声は送信されません。',
  'settings.llm.restoreDefaults.name': '変換のデフォルトを復元する',
  'settings.llm.restoreDefaults.desc':
    'プリセット、タイミング、コンテキスト、最小ワード、温度をリセットします。保存されたプリセットとモデルは保持されます。',
  'settings.llm.restoreDefaults.button': '復元する',
  'settings.llm.restoreDefaults.confirmMessage':
    'デフォルトのプリセット、タイミング、コンテキスト、最小単語数、および温度を復元しますか?保存されたプリセットとモデルは保持されます。',
  'settings.llm.migratedPreset': '私のプリセット',
  'settings.llm.migratedPresetNumbered': '私のプリセット {number}',
  'settings.recoveryMemory.name': 'リカバリテキストをメモリに保存する',
  'settings.recoveryMemory.desc':
    '最新の回復可能なテキストとメモのスナップショットをメモリに保存します。ディスクには何も書き込まれません。',
  'settings.modelStoreOverride.name': 'モデル ストア フォルダーのオーバーライド',
  'settings.modelStoreOverride.desc': '管理モデルのダウンロード用のカスタム フォルダー。',
  'settings.modelStoreOverride.placeholder': '共有のデフォルト モデル ストアを使用する',
  'settings.runSetup.name': 'セットアップを実行する',
  'settings.runSetup.desc': '初回セットアップ ウィザードを再実行します。',
  'settings.hardwareAcceleration.name': 'ハードウェアアクセラレーション',
  'settings.hardwareAcceleration.desc': '利用可能な場合は、GPU で推論を実行します。',
  'settings.hardwareAcceleration.busy':
    'ディクテーションまたは読み上げがアクティブな間は、ハードウェア アクセラレーションを変更できません。停止後もディクテーションの処理が続いている場合は、「ディクテーションをキャンセル」を実行してください。',
  'settings.hardwareAcceleration.on': 'ハードウェアアクセラレーションがオンになっています。',
  'settings.hardwareAcceleration.off': 'ハードウェアアクセラレーションがオフになっています。',
  'settings.hardwareAcceleration.restartFailed':
    'ハードウェア アクセラレーションは保存されましたが、音声エンジンを再起動できませんでした。 Obsidian を再起動して適用します。',
  'settings.noteContext.name': 'メモをコンテキストとして使用する',
  'settings.noteContext.desc':
    '英語を手動で選択した場合、開いているメモから特徴的な用語を送信してスペル認識を改善します。',
  'settings.noteContext.tooltip':
    '固有名詞と専門用語の用語集をエンジンの初期プロンプトとして送信します。初期プロンプトをサポートするエンジンで、英語を手動で選択した場合にのみ使用されます。',
  'settings.microphone.name': 'マイクロフォン',
  'settings.microphone.desc':
    'ディクテーションにどのマイクを使用するか。変更は次回のディクテーション セッションに適用されます。',
  'settings.microphone.default': 'デフォルトのマイク',
  'settings.microphone.labelUnavailable': 'マイク (ラベルはありません)',
  'settings.microphone.notConnected': '{microphone}（未接続）',
  'settings.microphone.detectTooltip': 'マイクを検出 (許可を求める)',
  'settings.microphone.allowAccessFirst':
    'このデバイスを保存するには、まずマイクへのアクセスを許可してください。',
  'settings.microphone.stopDictationToDetect': 'マイクを検出するにはディクテーションを停止します。',
  'settings.microphone.unavailableRuntime': 'このランタイムではマイク アクセスは利用できません。',
  'settings.microphone.detectFailed':
    'マイクを検出できませんでした。システムのオーディオ設定を確認してください。',
  'settings.microphone.fallbackSaveFailed':
    '保存されたマイクは使用できません。デフォルトのマイクを使用していますが、この変更を保存できませんでした。 Obsidian を再起動する前に、設定で使用可能なマイクを選択してください。',
  'settings.microphone.fallbackUnchanged':
    '保存されたマイクは使用できません。このセッションではデフォルトのマイクを使用します。現在のマイク設定は変更されません。',
  'settings.microphone.fallbackCleared':
    '保存されたマイクは使用できません。デフォルトのマイクを使用します。保存された選択内容は、今後のセッションのためにクリアされました。',
  'settings.model.notInstalled': 'インストールされていません',
  'settings.model.validatedExternal': '検証済み・外部',
  'settings.model.external': '外部の',
  'settings.model.checking': 'チェック中…',
  'settings.model.unavailable': '利用不可',
  'settings.model.noModel': 'モデルなし',
  'settings.model.streaming': 'ストリーミング',
  'settings.model.manageModels': 'モデルの管理',
  'settings.model.useExternalFile': '外部ファイルを使用する',
  'settings.model.details': 'モデル詳細',
  'settings.install.installingNamed': 'インストール中: {name}',
  'settings.install.installingSidecar': 'インストール: {variant} sidecar',
  'settings.install.installingSidecarMac': 'sidecarのインストール',
  'settings.install.cancelling': 'キャンセル中...',
  'settings.install.cancel': 'キャンセル',
  'settings.missingSidecar.name': 'Local Dictation のセットアップ',
  'settings.missingSidecar.desc':
    'Local Dictation はまだ準備ができていません。セットアップ ウィザードを実行して、音声エンジンとモデルをインストールします。',
  'settings.sidecar.name': 'Sidecar',
  'settings.sidecar.genericName': 'sidecar',
  'settings.sidecar.variantName': '{variant} sidecar',
  'settings.sidecar.desc': '音声テキスト変換エンジン。',
  'settings.sidecar.cpuName': 'CPU sidecar',
  'settings.sidecar.cpuDesc': '音声テキスト変換エンジン。必須。',
  'settings.sidecar.gpuName': 'GPU sidecar',
  'settings.sidecar.cudaActive': 'CUDA アクセラレーションがアクティブです。',
  'settings.sidecar.cudaLibraryPath.name': 'CUDA ライブラリ パス',
  'settings.sidecar.cudaLibraryPath.desc':
    'sidecar (Flatpak、カスタム CUDA インストール) のオプションのライブラリ検索パス。',
  'settings.sidecar.installAnyway': 'とにかくインストールする',
  'settings.sidecar.installAnywayTooltip':
    'NVIDIA ドライバーが検出されなかった場合でも、CUDA のインストールを続行します。',
  'settings.sidecar.stopBeforeInstall':
    'sidecar をインストールする前に、ディクテーションまたは読み上げを停止してください。インストールするとエンジンが再起動されます。ディクテーションがまだ処理中の場合は、「ディクテーションをキャンセル」を実行してすぐに停止してください。',
  'settings.sidecar.stopBeforeUpdate':
    'sidecar を更新する前に、ディクテーションまたは読み上げを停止してください。更新によりエンジンが再起動されます。ディクテーションがまだ処理中の場合は、「ディクテーションをキャンセル」を実行してすぐに停止してください。',
  'settings.sidecar.stopBeforeUninstall':
    '{sidecar}をアンインストールする前に、ディクテーションまたは読み上げを停止してください。ディクテーションがまだ処理中の場合は、「ディクテーションをキャンセル」を実行してすぐに停止してください。',
  'settings.sidecar.uninstallFailed':
    '{sidecar}をアンインストールできませんでした。他のセットアップウィンドウを閉じて、もう一度お試しください。',
  'settings.sidecar.uninstalled': 'Sidecarをアンインストールしました。',
  'settings.sidecar.cudaUninstalled':
    'CUDA sidecar がアンインストールされました。 CPUで動作します。',
  'settings.sidecar.cpuUninstalled': 'CPU sidecar がアンインストールされました。',
  'settings.sidecar.restartFailed':
    '音声エンジンを再起動できませんでした。ディクテーションの前に Obsidian を再起動します。',
  'settings.sidecar.becameActive':
    'sidecar の操作が完了する前に、ディクテーションまたは読み上げがアクティブになりました。読み上げまたはディクテーションを停止してください。ディクテーションがまだ処理中の場合は、「ディクテーションをキャンセル」を実行してから再試行してください。',
  'settings.sidecar.reinstall': '再インストール',
  'settings.sidecar.uninstall': 'アンインストール',
  'settings.sidecar.install': 'インストール',
  'settings.sidecar.driver.present': 'NVIDIA GPU が検出されました - 転写が高速化されました。',
  'settings.sidecar.driver.presentTooltip':
    'GitHub リリースから CUDA sidecar アーカイブをダウンロードします。',
  'settings.sidecar.driver.absent':
    'NVIDIA GPU が必要です。自分のものがサポートされていることがわかっている場合は、とにかくインストールしてください。',
  'settings.sidecar.driver.absentTooltip':
    'nvidia-smi が PATH 上に見つかりませんでした。システムが CUDA をサポートしていることが確実な場合は、「とにかくインストール」を使用してください。',
  'settings.sidecar.driver.unknown':
    'NVIDIA を調査できませんでした — 確実な場合のみインストールしてください。',
  'settings.sidecar.driver.unknownTooltip':
    'NVIDIA ドライバーをプローブできません。 GPU が CUDA をサポートしていることがわかっている場合にのみ続行してください。',
  'plugin.name': 'Local Dictation',
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.duplicate': '複製',
  'common.free': '無料',
  'common.inherit': '引き継ぐ',
  'common.off': 'オフ',
  'common.on': 'オン',
  'common.save': '保存',
  'common.unavailable': '利用不可',
  'ribbon.idle': 'Local Dictation — ディクテーションの開始',
  'ribbon.starting': 'Local Dictation — 開始中…',
  'ribbon.listening': 'Local Dictation — 聞き取り中',
  'ribbon.speechDetected': 'Local Dictation — 音声を検出',
  'ribbon.error': 'Local Dictation — エラー',
  'validation.wholeNumberRange': '{min} から {max} までの整数を入力します。',
  'validation.numberRange': '{min} から {max} までの数値を入力します。',
  'llm.managedByPreset':
    '「{preset}」によって管理されています。この値を変更するには、そのプリセットを編集します。',
  'llm.context.title': 'コンテキスト設定',
  'llm.context.settingsTooltip': 'コンテキスト設定',
  'llm.context.intro':
    'コンテキストを増やすと用語が改善されますが、ローカル レイテンシや OpenRouter コストが増加する可能性があります。',
  'llm.context.noteLength.name': 'ノートのコンテキスト長',
  'llm.context.noteLength.description': 'カーソル上の現在のノートから取得される最大文字数。',
  'llm.context.previousPhrases.name': '前のフレーズ',
  'llm.context.previousPhrases.description': '最近口述したフレーズが会話履歴として含まれます。',
  'llm.context.afterEachPhraseOnly':
    '「変換の実行」が「各フレーズの後」に設定されている場合にのみ使用されます。',
  'llm.context.limit.name': 'コンテキストの制限',
  'llm.context.limit.description': 'メモのコンテキストと前のフレーズから結合された最大文字数。',
  'llm.context.useCurrentNote.name': '現在のメモをコンテキストとして使用する',
  'llm.context.useCurrentNote.description':
    'カーソルより上にあるテキストを各プロンプトに含めます。',
  'llm.model.title': 'モデル設定',
  'llm.model.settingsTooltip': 'モデル設定',
  'llm.model.temperature.name': '温度',
  'llm.model.temperature.description':
    'サンプリングのバリエーション。 0 は決定的です。値が大きいほど変化が大きくなります。',
  'llm.model.remoteThreshold.name': 'リモートルーティングのしきい値',
  'llm.model.remoteThreshold.description':
    '自動変換を OpenRouter (文字) に送信するトランスクリプトの長さ。',
  'llm.model.remoteTimeout.name': 'リモートタイムアウト',
  'llm.model.remoteTimeout.description':
    'この秒数が経過したら、OpenRouter を待つのをやめます。オリジナルのトランスクリプトは保存されます。',
  'llm.model.behavior.name': 'モデルの動作',
  'llm.model.summary.temperature': '温度 {value}',
  'llm.model.summary.remoteThreshold': '{value} 文字以上でリモート',
  'llm.model.summary.timeout': 'タイムアウト {value} 秒',
  'llm.failure.authInvalid': '{provider} API キーが拒否されました。設定を確認してください。',
  'llm.failure.rateLimited': '{provider} レート制限に達しました。生のテキストに戻ります。',
  'llm.failure.network': '{provider} への接続中にネットワークエラーが発生しました。',
  'llm.failure.modelNotConfigured':
    '{provider} モデルが構成されていません。 [モデル] でいずれかを選択します。',
  'llm.failure.unknownModel':
    '{provider} モデルが見つかりません。 「モデル」の下で別のものを選択します。',
  'llm.failure.unknown': 'LLM 変換が失敗しました。コンソールを参照してください。',
  'llm.status.selectOllamaModel': '以下の Ollama モデルを選択してください。',
  'llm.status.selectOpenRouterModel': '以下の OpenRouter モデルを選択してください。',
  'llm.status.ollamaNotRunning': 'Ollama は実行されていません。',
  'llm.status.unreachable': '{provider} に到達できません。',
  'llm.status.authInvalid': '{provider} API キーが拒否されました。',
  'llm.status.rateLimited': '{provider} レート制限に達しました。',
  'llm.status.noOllamaModels': 'Ollama にはチャット モデルはインストールされていません。',
  'llm.status.noModels': '使用可能な {provider} モデルが見つかりません。',
  'llm.status.selectedUnavailable': '選択したモデルは使用できません。',
  'llm.timing.title': 'タイミング設定',
  'llm.timing.settingsTooltip': 'タイミング設定',
  'llm.timing.minimumWords.name': '最小単語数',
  'llm.timing.minimumWords.description':
    'トランスクリプトの単語数がこれより少ない場合は、変換をスキップします。',
  'llm.timing.timestamps.perUtterance': '各フレーズの後でタイムスタンプの境界が保持されます。',
  'llm.timing.timestamps.batch':
    'すべてを一度に実行すると、プリセットに応じてタイムスタンプが書き換えられたり、削除されたりする場合があります。',
  'llm.timing.option.perUtterance': '各フレーズの後に',
  'llm.timing.option.batch': '停止時に一斉に',
  'llm.routing.local': 'ローカル',
  'llm.routing.remote': 'リモート',
  'llm.routing.auto': '自動',
  'llm.routing.ariaLabel': 'で変換を実行します',
  'llm.routing.localHint': 'Ollama を使用すると、デバイス上で完全に実行できます。',
  'llm.routing.remoteHint': '変換のために各トランスクリプトを OpenRouter に送信します。',
  'llm.routing.autoHint': 'デバイス上に留まり、大きなトランスクリプトを OpenRouter に渡します。',
  'llm.routing.localLeg': 'ローカル · Ollama',
  'llm.routing.remoteLeg': 'リモート・OpenRouter',
  'llm.routing.priceTierTooltip': 'おおよその価格帯',
  'llm.routing.providerModel': '{provider}モデル',
  'llm.routing.ollamaModelDescription': 'ローカルの Ollama チャット モデルを選択します。',
  'llm.routing.selectModel': 'モデルを選択してください',
  'llm.routing.refreshModels': '{provider} モデルを更新する',
  'llm.routing.apiKey.name': 'OpenRouter APIキー',
  'llm.routing.apiKey.description': 'Obsidian によって安全に保管されます。',
  'llm.routing.openRouterModel.name': 'OpenRouterモデル',
  'llm.routing.openRouterModel.description': '入力して OpenRouter モデルを検索します。',
  'llm.routing.testConnection': 'API キーとモデルをテストする',
  'llm.sidebar.eyebrow': 'トランスクリプトのワークフロー',
  'llm.sidebar.title': 'ディクテーションの変換',
  'llm.sidebar.description': '話されたテキストがメモに届く前にどのように形成されるかを選択します。',
  'llm.sidebar.group.preset': 'プリセット',
  'llm.sidebar.group.model': 'モデル',
  'llm.sidebar.group.context': 'コンテキスト',
  'llm.sidebar.enabled.name': '有効',
  'llm.sidebar.enabled.description': 'アクティブなプリセットを新しい口述テキストに適用します。',
  'llm.sidebar.showOriginal.name': 'オリジナルのトランスクリプトを表示',
  'llm.sidebar.showOriginal.description':
    '変換後の各結果の下に、折りたたみ可能な補足として保持します。',
  'llm.sidebar.runTransform.name': '変換の実行',
  'llm.sidebar.runTransform.description':
    'フレーズごとに実行するか、停止するときに一気に実行します。',
  'llm.sidebar.runTransform.setByPreset': '{preset} — {timing} によって設定されます。',
  'llm.sidebar.activePreset': 'アクティブなプリセット',
  'llm.sidebar.unavailable.title': 'LLM 機能は使用できません',
  'llm.sidebar.unavailable.description':
    'Local Dictation 設定で LLM 機能を有効にして、変換を構成します。',
  'llm.sidebar.unavailable.summary': '設定で LLM 機能を有効にする',
  'llm.sidebar.off.title': '生のトランスクリプトモード',
  'llm.sidebar.off.description':
    'ディクテーションは、生のローカル トランスクリプトを挿入します。クリーンアップ、書き換え、または要約が必要な場合は、「変換」をオンにします。',
  'llm.sidebar.off.summary': '未加工の文字起こし',
  'llm.sidebar.active.summary': '{preset}・{timing}',
  'llm.preset.builtin.cleanUp.label': 'クリーンアップ',
  'llm.preset.builtin.cleanUp.description':
    '音声と意味を維持しながら、転写アーティファクト、フィラー、句読点、大文字の使用を修正します。',
  'llm.preset.builtin.cleanUp.prompt':
    'ディクテーションによる文字起こしを整えてください。フィラー、言い直し、繰り返し、句読点、大文字・小文字、明らかな認識誤りを修正してください。話者の語調と意味は維持してください。参照コンテキストは表記の確認にのみ使用してください。文字起こし元の言語で記述してください。ユーザーが明示的に翻訳を求めない限り、翻訳しないでください。前置きや解説を付けず、整えたテキストのみを返してください。',
  'llm.preset.builtin.professionalWriting.label': 'プロフェッショナルなライティング',
  'llm.preset.builtin.professionalWriting.description':
    '事実、名前、決定事項、専門用語を維持しながら、簡潔で洗練された専門的な文章に書き直します。',
  'llm.preset.builtin.professionalWriting.prompt':
    'ディクテーションされた発話を、簡潔でプロフェッショナルな文章に書き直してください。能動態を使い、フィラーや曖昧な表現を除いてください。事実、名前、用語はすべて維持してください。参照コンテキストは表記の確認に使用してください。文字起こし元の言語で記述してください。ユーザーが明示的に翻訳を求めない限り、翻訳しないでください。前置きや解説を付けず、書き直したテキストのみを返してください。',
  'llm.preset.builtin.tldr.label': 'TLDR',
  'llm.preset.builtin.tldr.description':
    '手つかずのトランスクリプトの上に短い TLDR 概要を追加します。',
  'llm.preset.builtin.tldr.prompt':
    'ディクテーションの文字起こしを TLDR として要約してください。「TLDR」という見出しに続けて、要点をまとめた 1～3 個の短い箇条書きを記述してください。文字起こし元の言語で記述してください。ユーザーが明示的に翻訳を求めない限り、翻訳しないでください。文字起こしを繰り返したり、前置きや解説を付けたりせず、見出しと箇条書きのみを返してください。',
  'llm.preset.builtin.markdownFormatting.label': 'Markdown フォーマット',
  'llm.preset.builtin.markdownFormatting.description':
    'セッション記録を、見出し、リスト、強調を備えた構造化された Markdown として再フォーマットします。',
  'llm.preset.builtin.markdownFormatting.prompt':
    'ディクテーションされた発話を、適切に構造化された Markdown に整形してください。内容に応じて見出し、箇条書きまたは番号付きリスト、太字、強調、コードブロックを追加してください。フィラー、言い直し、句読点、大文字・小文字は軽く整えつつ、話者の表現、事実、名前、用語はすべて維持してください。文字起こし元の言語で記述してください。ユーザーが明示的に翻訳を求めない限り、翻訳しないでください。前置きや解説を付けず、Markdown のみを返してください。',
  'llm.preset.builtin.actionItems.label': 'アクションアイテム',
  'llm.preset.builtin.actionItems.description':
    '未修正のトランスクリプトの下にアクションアイテムのチェックリストを追加します。',
  'llm.preset.builtin.actionItems.prompt':
    'ディクテーションの文字起こしからアクションアイテムを抽出してください。「アクションアイテム」という見出しに続けて、具体的なタスクを Markdown のチェックリストで出力し、話者が担当者に言及している場合はその名前も含めてください。アクションアイテムがない場合は何も返さないでください。文字起こし元の言語で記述してください。ユーザーが明示的に翻訳を求めない限り、翻訳しないでください。文字起こしを繰り返したり、前置きや解説を付けたりせず、見出しとチェックリストのみを返してください。',
  'llm.preset.timing.perUtterance': '各フレーズの後に実行されます',
  'llm.preset.timing.batch': '停止時に1回実行',
  'llm.preset.timing.either': 'どちらのモードでも実行可能',
  'llm.preset.behavior.addAbove': 'トランスクリプトの上に新しいコンテンツを追加します',
  'llm.preset.behavior.addBelow': 'トランスクリプトの下に新しいコンテンツを追加します',
  'llm.preset.behavior.replace': '口述されたテキストを書き換えます',
  'llm.preset.behavior.overrides': '{fields} をオーバーライドします',
  'llm.preset.override.minimumWords': '最小単語数',
  'llm.preset.override.temperature': '温度',
  'llm.preset.override.noteContext': 'メモのコンテキスト',
  'llm.preset.option.perUtterance': '{preset} (各フレーズの後)',
  'llm.preset.option.batch': '{preset} (停止時)',
  'llm.preset.copySuffix': '（コピー）',
  'llm.preset.copySuffixNumbered': '（コピー {number}）',
  'llm.preset.validation.nameRequired': 'このプリセットの名前を入力します。',
  'llm.preset.validation.nameExists': 'その名前のプリセットはすでに存在します。',
  'llm.preset.validation.promptRequired': 'このプリセットのプロンプトを入力します。',
  'llm.preset.validation.minimumWords':
    '最小ワードは 0 から {max} までの整数である必要があります。',
  'llm.preset.validation.temperature': '温度は 0 から {max} までの数値である必要があります。',
  'llm.preset.validation.maximumCount':
    '最大 {max} のプリセットを保存できます。まず 1 つ削除してください。',
  'llm.preset.validation.builtinName':
    'その名前は組み込みのプリセットで使用されます。別の名前を選択してください。',
  'llm.preset.manager.title': 'プリセットの管理',
  'llm.preset.manager.newTitle': '新しいプリセット',
  'llm.preset.manager.editTitle': 'プリセットの編集',
  'llm.preset.manager.presets.name': 'プリセット',
  'llm.preset.manager.presets.description':
    'アクティブなプリセットがマークされます。組み込みのプリセットは読み取り専用です。カスタマイズするには、プリセットを複製します。',
  'llm.preset.manager.new': '新しいプリセット',
  'llm.preset.manager.searchPlaceholder': 'プリセットを検索...',
  'llm.preset.manager.noMatches': '検索に一致するプリセットはありません。',
  'llm.preset.manager.builtinHeading': '組み込み',
  'llm.preset.manager.yoursHeading': 'あなたのプリセット',
  'llm.preset.manager.viewTooltip': 'プリセットを表示',
  'llm.preset.manager.editTooltip': 'プリセットの編集',
  'llm.preset.manager.duplicateTooltip': 'プリセットの複製',
  'llm.preset.manager.deleteTooltip': 'プリセット「{preset}」を削除',
  'llm.preset.manager.back': '← すべてのプリセット',
  'llm.preset.editor.name': '名前',
  'llm.preset.editor.namePlaceholder': '例: 会議メモ',
  'llm.preset.editor.description': '説明 (オプション)',
  'llm.preset.editor.descriptionPlaceholder': 'このプリセットを使う場面',
  'llm.preset.editor.prompt': 'プロンプト',
  'llm.preset.editor.promptDescription': 'システム プロンプトとしてモデルに送信されます。',
  'llm.preset.editor.promptSize':
    '~{tokens} トークン ({characters} 文字) — すべてのリクエストで送信されます',
  'llm.preset.editor.timing': 'タイミング',
  'llm.preset.editor.timingDescription':
    '変換が実行されるとき。 「どちらか」はサイドバーのタイミングに従います。',
  'llm.preset.editor.timingEither': 'どちらでも（サイドバーに従う）',
  'llm.preset.editor.timingPerUtterance': '各フレーズの後に',
  'llm.preset.editor.timingBatch': '停止時に一度',
  'llm.preset.editor.output': '出力',
  'llm.preset.editor.outputDescription':
    '「置換」は口述入力したテキストを書き換えます。 「追加」では、変更を加えずに新しいコンテンツを挿入します。',
  'llm.preset.editor.outputReplace': 'テキストを置換する',
  'llm.preset.editor.outputAddAbove': '文字起こしの上に追加',
  'llm.preset.editor.outputAddBelow': '文字起こしの下に追加',
  'llm.preset.editor.overrides': 'オーバーライド',
  'llm.preset.editor.overridesDescription':
    'グローバル設定を使用するには、フィールドを空白のままにしておきます。',
  'llm.preset.editor.minimumWords': '最小単語',
  'llm.preset.delete.title': 'プリセットの削除',
  'llm.preset.delete.message':
    'プリセット「{preset}」を削除しますか?これを元に戻すことはできません。',
  'llm.preset.delete.activeFallback':
    '「{preset}」がアクティブでした - クリーンアップに切り替えられました。',
  'common.back': '戻る',
  'common.close': '閉じる',
  'common.done': '完了',
  'common.install': 'インストール',
  'common.later': '後で',
  'common.next': '次',
  'common.remove': '削除',
  'common.tryAgain': '再試行',
  'setup.ready.waitForDictation':
    '現在のディクテーションが終了するまで待ってから、もう一度試してください。',
  'setup.ready.openMarkdownNote':
    'Markdown ノートを編集モードで開き、ディクテーションを再試行してください。',
  'setup.ready.completionFailed':
    'セットアップを完了できませんでした。もう一度やり直してください。',
  'setup.wizard.welcomeTitle': 'Local Dictationへようこそ',
  'setup.wizard.title': 'Local Dictation のセットアップ',
  'setup.wizard.engineReadyTitle': '音声エンジンの準備完了',
  'setup.wizard.engineReadyDesc':
    'ローカルの音声テキスト変換エンジンがインストールされ、準備が整いました。',
  'setup.wizard.intro':
    'Obsidian 内で、マシン上でハンズフリーでメモを書き取ります。アカウントもクラウドもテレメトリもありません。',
  'setup.wizard.quickSetup': '2 分間の簡単なセットアップ:',
  'setup.wizard.downloadEngineStep': '音声エンジンをダウンロードする',
  'setup.wizard.pickModelStep': '文字起こしモデルを選択する',
  'setup.wizard.startTalking':
    '次に、リボンのマイク (または独自のホットキー) を押して、話し始めます。',
  'setup.wizard.cpuBuildNote':
    'CPU ビルドから始まります。 NVIDIA GPU? CUDA アクセラレーション ビルドは、後で [設定] からインストールできます。',
  'setup.wizard.downloadEngine': 'エンジンをダウンロード',
  'setup.wizard.modelSelectedTitle': 'モデルを選択しました',
  'setup.wizard.pickModelTitle': '文字起こしモデルを選択する',
  'setup.wizard.modelSelectedDesc':
    '転写モデルがインストールされ、選択されます。さらにインストールしたり、後で [設定] から切り替えることができます。',
  'setup.wizard.modelIntro':
    '書き起こしモデルをインストールしてディクテーションを有効にします。後でさらにインストールすることもできます。モデルが小さいほど高速で、モデルが大きいほど正確です。',
  'setup.wizard.modelKinds':
    '2 種類が利用可能です。ストリーミング モデルは、話しているときに単語をライブで表示します。標準モデルは、一時停止するたびに転写します。ハンズフリーディクテーションの場合は、推奨される Moonshine Small モデルから始めてください。 Nemotron 3.5 ASR は、実験的な高リソース ストリーミング オプションです。',
  'setup.wizard.gpuNote':
    '大きいモデルは、GPU アクセラレーションによりはるかに高速に実行されます。 NVIDIA GPU をお持ちの場合は、後で [設定] から CUDA アクセラレーション ビルドをインストールできます。',
  'setup.wizard.openModelPicker': 'モデルピッカーを開く',
  'setup.wizard.readyTitle': '口述する準備ができました',
  'setup.wizard.readyDesc':
    '現在開いている Markdown ノートで試してみてください。いくつかの単語を話してから、リボンのマイクまたはホットキーで停止します。',
  'setup.wizard.ribbonTitle': 'リボンマイクを使う',
  'setup.wizard.ribbonDesc':
    'Obsidian リボンでこのアイコンを探します。クリックしてディクテーションを開始します。もう一度クリックすると停止します。',
  'setup.wizard.hotkeyTitle': 'またはホットキーをバインドします',
  'setup.wizard.hotkeyDescBefore': 'ショートカットをバインドします',
  'setup.wizard.toggleCommandName': 'Local Dictation: ディクテーションの切り替え',
  'setup.wizard.hotkeyDescAfter': 'Obsidian のどこからでも開始および停止できるコマンド。',
  'setup.wizard.openHotkeySettings': 'ホットキー設定を開く',
  'setup.wizard.tryDictationNow': '今すぐディクテーションを試してください',
  'setup.wizard.openHotkeySettingsFallback':
    '「設定」→「ホットキー」を開き、「Local Dictation」を検索します。',
  'setup.sidecar.modal.download': 'ダウンロード',
  'setup.sidecar.modal.variantDownload': '{variant} ダウンロード',
  'setup.sidecar.modal.version': 'バージョン',
  'setup.sidecar.modal.cancelling': 'キャンセル中...',
  'setup.sidecar.modal.downloading': 'ダウンロード中...',
  'setup.sidecar.modal.retryDownload': 'ダウンロードを再試行します',
  'setup.sidecar.modal.installFailureNotice':
    '音声エンジンのインストールに失敗しました。セットアップまたは設定を再度開いてエラーを確認し、再試行してください。',
  'setup.sidecar.modal.startFailed':
    'sidecar のインストールを開始できませんでした。他のセットアップ ウィンドウを閉じて、もう一度試してください。',
  'setup.sidecar.installCancelled': 'Sidecar のインストールはキャンセルされました。',
  'setup.sidecar.progress.variant': '{variant} sidecar ({current}/{total})',
  'setup.sidecar.progress.downloading': 'ダウンロード中',
  'setup.sidecar.progress.verifying': 'チェックサムを検証しています...',
  'setup.sidecar.progress.extracting': 'アーカイブを抽出しています...',
  'models.manage.title': 'モデルの管理',
  'models.manage.loadFailedTitle': 'モデルをロードできませんでした',
  'models.manage.loadFailedDesc':
    '音声エンジンがインストールされていないか、応答していない可能性があります。セットアップを再実行して再インストールするか、もう一度試してください。',
  'models.manage.runSetup': 'セットアップを実行する',
  'models.manage.loadingCatalog': 'モデルカタログを読み込み中…',
  'models.manage.loadCatalogFailed': 'モデルカタログの読み込みに失敗しました。',
  'models.manage.noneAvailable': 'このエンジンには利用可能なモデルがありません。',
  'models.manage.unsupportedLanguage':
    ' · {language}はサポートされていません。このモデルをインストールまたは使用するには、ディクテーション言語を変更してください。',
  'models.manage.use': '使用',
  'models.manage.selected': '選択済み',
  'models.manage.cancelling': 'キャンセル中…',
  'models.manage.details': '詳細',
  'models.manage.installStartFailed':
    'モデルのインストールを開始できませんでした。もう一度やり直してください。',
  'models.manage.selectFailed':
    'モデルを選択できませんでした。ファイルが利用可能であることを確認してください。',
  'models.manage.selectedNotice': 'モデルが選択されました。',
  'models.manage.removeFailed':
    'モデルを削除できませんでした。ファイルを使用しているプロセスをすべて閉じます。',
  'models.manage.removedNotice': 'モデルが削除されました。',
  'models.external.title': '外部ファイルを使用する',
  'models.external.intro':
    '外部モデルは高度な用途向けです。 Local Dictation は、これらのファイルのダウンロード、更新、チェックサム検証を行いません。',
  'models.external.family.name': 'モデルファミリー',
  'models.external.family.desc':
    'モデルに合ったローダーを選択してください。ファミリーはファイル名から推測されません。',
  'models.external.path.name': 'モデルファイルのパス',
  'models.external.path.desc':
    'プライマリ モデル アーティファクトへの絶対パスを入力します。この選択は保存される前に検証されます。',
  'models.external.validateAndUse': '検証して使用する',
  'models.external.validating': '検証中…',
  'models.external.selectedNotice': '外部モデル ファイルが検証され、選択されました。',
  'models.external.requirementsTitle': 'ファイル要件',
  'models.external.validation.notConfigured': 'モデルファイルのパスが設定されていません。',
  'models.external.validation.notAbsolute': 'モデル ファイルのパスは絶対パスである必要があります。',
  'models.external.validation.missing': 'モデル ファイル パスが存在しません: {path}',
  'models.external.validation.notFile':
    'モデル ファイル パスは次のファイルを指す必要があります: {path}',
  'models.external.validation.selectEntryFile': '{filename}を選択してください。',
  'models.external.validation.nemotronEntryFile':
    'Nemotron 3.5 ASR には、encoder.int8.onnx アーティファクトが必要です。固定された 560 ミリ秒モデル ディレクトリから encoder.int8.onnx を選択します。',
  'models.external.validation.moonshineEntryFile':
    'Moonshine には、プライマリのfrontend.ort アーティファクトが必要です。ストリーミング モデル ディレクトリからfrontend.ortを選択します。',
  'models.external.validation.generic': '音声エンジンはこのモデルを検証できませんでした。',
  'models.external.requirements.nemotron.entry':
    '固定された Nemotron 3.5 ASR 560 ms int8 エクスポートから encoder.int8.onnx を選択します。',
  'models.external.requirements.nemotron.siblings':
    '同じディレクトリに、decoder.int8.onnx、joiner.int8.onnx、および tokens.txt が含まれている必要があります。',
  'models.external.requirements.nemotron.compatibility':
    '他のチャンク サイズおよび ORT GenAI エクスポートは、このアダプターと互換性がありません。',
  'models.external.requirements.moonshine.entry':
    'Moonshine v2 ストリーミング ORT モデル ディレクトリからfrontend.ort を選択します。',
  'models.external.requirements.moonshine.siblings':
    '同じディレクトリには、encoder.ort、adapter.ort、cross_kv.ort、decoder_kv.ort、streaming_config.json、および tokenizer.bin が含まれている必要があります。',
  'models.external.requirements.moonshine.compatibility':
    '非ストリーミング Moonshine ONNX エクスポートには互換性がありません。',
  'models.external.requirements.whisper.entry':
    'Whisper.cpp 互換の GGML または GGUF モデル ファイルを 1 つ選択します。',
  'models.external.requirements.whisper.validation':
    'ローダーはファイルの内容を検証します。ファイル名の拡張子だけでは互換性は確立されません。',
  'models.external.requirements.whisper.language':
    '.en のウェイトを含む Whisper ファイルは英語専用です。多言語ウェイトでは、検証済みの言語選択と自動検出を利用できます。',
  'models.details.totalSize': '合計サイズ',
  'models.details.source': 'ソース',
  'models.details.license': 'ライセンス',
  'models.details.capabilities': '機能',
  'models.details.installPath': 'インストールパス',
  'models.details.files': 'ファイル ({count})',
  'models.details.size': 'サイズ',
  'models.capability.segmentTimestamps': 'セグメントのタイムスタンプ',
  'models.capability.wordTimestamps': '単語のタイムスタンプ',
  'models.capability.initialPrompt': '最初のプロンプト',
  'models.capability.streaming': 'ストリーミング',
  'models.capability.autoLanguageDetection': '自動言語検出',
  'models.capability.punctuation': '句読点',
  'models.capability.maxAudio': '最大音声：{seconds}秒',
  'models.capability.anyLanguage': 'どの言語でも',
  'models.capability.englishOnly': '英語のみ',
  'models.capability.languageCount': '{count} 言語',
  'models.capability.languageSelection': '言語の選択',
  'models.tag.fullPrecision': '完全な精度',
  'models.tag.reducedSize': '縮小サイズ',
  'models.progress.preparing': 'インストールの準備中',
  'models.progress.downloading': 'ダウンロード中',
  'models.progress.verifying': 'ダウンロードの検証中',
  'models.progress.validating': 'モデルの検証',
  'models.progress.installed': 'モデルをインストールしました',
  'models.progress.cancelled': 'モデルのインストールがキャンセルされました',
  'models.progress.failed': 'モデルのインストールに失敗しました',
  'models.progress.downloadingFile': '{filename}をダウンロード中',
  'models.progress.verifyingFile': '{filename}を検証中',
  'models.progress.fileCount': 'ファイル {current}/{total}',
  'models.current.noneSelected': 'モデルが選択されていません',
  'models.current.noneSelectedDesc':
    'インストールされているモデルを選択するか、外部ファイルを検証します。',
  'models.current.notSelected': '未選択',
  'models.current.externalFile': '外部ファイル',
  'models.current.managedNotInstalled': '選択した管理対象モデルはインストールされていません。',
  'models.current.installed': 'インストール済み',
  'models.current.notInstalled': 'インストールされていません',
  'models.current.managedDownload': '管理されたダウンロード',
  'models.current.externalValidated': '外部検証済み',
  'models.current.checking': 'チェック中',
  'models.current.externalUnavailableDesc':
    '外部モデルは使用できません。ファイルを再度検証して詳細を確認します。',
  'models.current.unavailable': '利用不可',
  'models.current.validateBeforeDictating':
    'ディクテーションを行う前に、外部モデル ファイルを検証してください。',
  'sidecarError.audio_too_long': 'オーディオ クリップがこのエンジンの最大継続時間を超えています。',
  'sidecarError.engine_inference_failed': 'ローカルでの転写に失敗しました。',
  'sidecarError.internal_error': '音声エンジンで内部エラーが発生しました。',
  'sidecarError.invalid_audio_buffer':
    '文字起こしが開始されたとき、オーディオ バッファは空でした。',
  'sidecarError.invalid_audio_frame': '音声エンジンが無効なオーディオ フレームを受信しました。',
  'sidecarError.invalid_diarization_speaker_limit':
    '最大話者数は 1 以上、または「自動」に設定する必要があります。',
  'sidecarError.invalid_frame': '音声エンジンが無効なプロトコル フレームを受信しました。',
  'sidecarError.invalid_model_file':
    'モデル ファイルが見つからないか、読み取れない、またはサポートされていません。',
  'sidecarError.invalid_model_task': '選択したモデルは音声入力には使用できません。',
  'sidecarError.invalid_model_store': 'モデルの保存フォルダーが利用できないか、無効です。',
  'sidecarError.missing_model_file':
    'モデル ファイルが存在しないか、通常のファイルではありません。',
  'sidecarError.no_active_install':
    'キャンセルできるアクティブなモデルのインストールはありません。',
  'sidecarError.no_active_session': 'アクティブなディクテーション セッションはありません。',
  'sidecarError.session_already_exists':
    'この ID のディクテーション セッションはすでに存在します。',
  'sidecarError.session_capacity_exceeded':
    'Local Dictation にはすでにアクティブなセッションの最大数があります。',
  'sidecarError.system_audio_capture_failed':
    'システムオーディオキャプチャを開始できませんでした。',
  'sidecarError.system_audio_permission_denied':
    'Obsidian のシステムオーディオ録音許可がオフになっています。 [システム設定] → [プライバシーとセキュリティ] → [画面とシステム音声録音] を開き、Obsidian を有効にして、もう一度試してください。',
  'sidecarError.system_audio_unsupported':
    'このプラットフォームではシステム オーディオ キャプチャはまだ利用できません。このコンピュータの出力を仮想オーディオ デバイス経由でルーティングし、それをマイクとして選択します。システム オーディオ ガイドを参照してください。',
  'sidecarError.transcription_failure': 'ローカルでの転写に失敗しました。',
  'sidecarError.unsupported_engine': '要求されたエンジンはこのビルドでは使用できません。',
  'sidecarError.unsupported_language':
    '選択したモデルはこのディクテーション言語をサポートしていません。',
  'sidecarError.utterance_dropped_during_overload_drain':
    '文字起こしキューが空になっている間に、最終的な発話が削除されました。',
  'sidecarError.utterance_queue_overload':
    '文字起こしキューが過負荷になったため、ディクテーションが停止されました。受け入れられた音声は処理を終了します。',
  'sidecarError.vad_error': 'オーディオ フレームで音声アクティビティの検出に失敗しました。',
  'sidecarError.vad_init_failed': 'バンドルされている Silero VAD の初期化に失敗しました。',
  'sidecarError.worker_panic': '音声エンジンの文字起こしワーカーが予期せず停止しました。',
  'catalog.whisper_tiny_en_q8_0.summary':
    'リソースコストを最小限に抑えた最速モデル。テストや低電力マシンに適しています。',
  'catalog.whisper_base_en_q8_0.summary':
    'そこそこの精度を備えた高速モデル。 CPU での素早いドラフトに最適です。',
  'catalog.whisper_small_en_q5_1.summary':
    '文字起こしの品質、ダウンロード サイズ、CPU 速度のバランスをとります。',
  'catalog.whisper_medium_en_q5_0.summary':
    '速度よりも文字起こし品質を重視するユーザー向けの高精度モデル。',
  'catalog.whisper_large_v3_turbo_q8_0.summary':
    'GPU アクセラレーション向けに最適化されたアーキテクチャによる多言語の高精度転写。',
  'catalog.cohere_transcribe_fp16.summary': '完全なモデル精度を維持する最大の Cohere バリアント。',
  'catalog.cohere_transcribe_int8.summary':
    'ダウンロード サイズによる中間の Cohere バリアント (8 ビット量子化を使用)。',
  'catalog.cohere_transcribe_q4.summary':
    '最小の Cohere バリアント。 4 ビット量子化により、品質を犠牲にしてサイズが削減されます。',
  'catalog.moonshine_tiny_streaming_en.summary':
    '34M パラメーターでの最速の Moonshine ストリーミング モデル。ローエンド CPU 向けに設計されています。',
  'catalog.moonshine_small_streaming_en.summary':
    '1 億 2,300 万パラメータのバランスのとれたライブ ディクテーション モデル。',
  'catalog.moonshine_medium_streaming_en.summary':
    '245M パラメーターで最も正確な Moonshine ストリーミング モデル。',
  'catalog.nemotron_asr_0_6b_int8_streaming_560ms.summary':
    'NVIDIA の 0.6B 多言語 RNNT。8 つの検証済み言語でのキャッシュ対応ライブ文字起こしのために int8 ONNX にエクスポートされます。',
  'catalog.family.whisper.summary':
    '一時停止するたびに文字起こしします。 Whisper は、オプションのワードレベルのタイミングを含め、他のモデル ファミリよりも正確なタイムスタンプを提供します。 Tiny と Base は速度を優先し、Small は速度と品質のバランスをとり、Medium と Large は品質を優先します。',
  'catalog.family.cohere_transcribe.summary':
    '数ギガバイトのダウンロードとメモリ要件を伴う高品質のバッチ転写。',
  'catalog.family.moonshine.summary':
    '話しているときに単語を表示します。 Tiny はリソース使用量の削減を優先し、Small は速度と品質のバランスをとり、Medium は品質を優先します。',
  'catalog.family.nemotron_asr.summary':
    '実験的な高精度多言語ストリーミング。ダウンロード量とリソース使用量が増加します。 Moonshine Small は、推奨される英語のライブ ディクテーションのデフォルトのままです。',
  'setup.sidecar.modal.unsupportedPlatform':
    'この音声エンジン ビルドは、お使いのプラットフォームまたはアーキテクチャでは利用できません。',
  'setup.sidecar.modal.genericInstallError':
    '音声エンジンをインストールできませんでした。プラグインのログで詳細を確認し、再試行してください。',
  'commands.readAloud': '読み上げ',
  'commands.pauseResumeReadAloud': '読み上げを一時停止または再開',
  'commands.stopReadAloud': '読み上げを停止',
  'settings.groups.readAloud': '読み上げ',
  'settings.model.noModelSelected': 'モデルが選択されていません',
  'settings.model.speechToText': '音声テキスト変換モデル',
  'settings.model.textToSpeech': 'テキスト読み上げモデル',
  'settings.readAloud.hotkey': 'おすすめのホットキー',
  'settings.readAloud.hotkeyDesc':
    '読み上げにホットキーを割り当てます。選択範囲があればその部分を、なければノート全体を読み上げます。',
  'settings.readAloud.voice': '音声',
  'settings.readAloud.voiceDesc': '選択したモデルにインストール済みの音声から選びます。',
  'settings.readAloud.noVoices': 'インストール済みの音声はありません',
  'settings.readAloud.speed': '読み上げ速度',
  'settings.readAloud.speedDesc': '読み上げ中に速度を変更すると、現在の文から再開します。',
  'models.manage.dictationModels': '音声からテキスト',
  'models.manage.readAloudModels': 'テキストから音声',
  'models.manage.allLanguages': 'すべての言語',
  'models.manage.familiesLabel': 'モデルファミリー',
  'models.manage.noneForLanguage': 'このタスクと言語で利用できるモデルはありません。',
  'models.manage.optionalVoice': '追加のローカル音声',
  'models.manage.voiceInstalled': 'インストール済み',
  'tts.status.reading': '読み上げ中…',
  'tts.status.paused': '読み上げ一時停止中',
  'tts.control.model': 'モデル: {model}',
  'tts.control.speed': '速度: {speed}',
  'tts.notice.noText': 'ここには読み上げ可能なテキストがありません。',
  'tts.notice.modelRequired': '先に読み上げモデルをインストールして選択してください。',
  'tts.notice.voiceRequired': '先にインストール済みの音声を選択してください。',
  'tts.notice.startFailed': '読み上げを開始できませんでした。',
  'tts.notice.playbackFailed': '音声の再生に失敗しました。',
  'tts.notice.sidecarExited': 'サイドカーが予期せず終了したため、読み上げを停止しました。',
  'sidecarError.invalid_synthesis_request': '読み上げ要求が無効です。',
  'sidecarError.missing_voice_file': '選択した読み上げ音声がインストールされていません。',
  'sidecarError.sidecar_exited': 'サイドカープロセスが予期せず終了しました。',
  'sidecarError.synthesis_cancelled': '読み上げがキャンセルされました。',
  'sidecarError.synthesis_failed': 'ローカル音声合成に失敗しました。',
  'sidecarError.synthesis_worker_unavailable': 'ローカル音声合成ワーカーを利用できません。',
  'catalog.pocket_tts_english_2026_04_int8.summary':
    '厳選された音声を選べる、自然なローカル英語読み上げです。',
  'catalog.family.pocket_tts.summary':
    '英語、フランス語、ドイツ語、スペイン語、ポルトガル語、イタリア語のノートを、選択可能な音声と音程を保つ速度調整でローカルに読み上げます。',
} as const satisfies TranslationCatalog;
