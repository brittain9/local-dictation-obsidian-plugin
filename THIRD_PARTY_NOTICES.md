# Third-Party Notices

The local-dictation sidecar embeds the following model artifacts so speech
processing works offline.

## Silero voice-activity-detection model

- Work: Silero VAD
- Version: 6.2.1
- Copyright (c) 2020-present Silero Team
- Source: https://github.com/snakers4/silero-vad
- Packaged artifact: https://pypi.org/project/silero-vad/6.2.1/
- License: MIT

The `silero_vad.onnx` model from the official Silero VAD Python package is
embedded in the sidecar executable.

MIT License

Copyright (c) 2020-present Silero Team

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## WeSpeaker speaker-embedding model

- Work: `wespeaker_en_voxceleb_resnet34_LM`
- Project: WeSpeaker
- Source:
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx
- Upstream model information:
  https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
  https://creativecommons.org/licenses/by/4.0/

The model was trained on the VoxCeleb2 Dev dataset and follows that dataset's
CC BY 4.0 license, as documented by WeSpeaker. This project redistributes the
model in ONNX form, embeds it in the sidecar executable, and supplies a
compatible Rust filterbank frontend. The learned weights were not intentionally
modified. No endorsement by WeSpeaker, the VoxCeleb authors, or dataset
contributors is implied. The model is provided without warranties.

## pyannote speaker-segmentation model

- Work: `pyannote/segmentation-3.0`
- Copyright (c) 2023 CNRS
- Source: https://huggingface.co/pyannote/segmentation-3.0
- ONNX export:
  https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models
- License: MIT

The model was exported to ONNX by the sherpa-onnx project and is embedded in the
sidecar executable.

MIT License

Copyright (c) 2023 CNRS

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
