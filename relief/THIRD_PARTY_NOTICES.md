# Third-party components

| Component | Use | License |
|---|---|---|
| Depth Anything V2 **Small** (onnx-community/depth-anything-v2-small) | depth estimation model, downloaded at runtime from Hugging Face | Apache-2.0 |
| onnxruntime-web 1.20.1 | runs the model in the browser (CDN) | MIT |
| three.js 0.160.0 | 3D preview (CDN) | MIT |
| Noto Sans Thai | UI font (Google Fonts) | SIL Open Font License 1.1 |

Notes for commercial use:
- Only the **Small** Depth Anything V2 model is Apache-2.0. The Base and Large models are CC-BY-NC-4.0 (non-commercial) and must not be bundled or set as default in a paid product.
- Keep this file and the model attribution in the app footer when distributing.

Depth Anything V2 — Yang et al., "Depth Anything V2", 2024. https://github.com/DepthAnything/Depth-Anything-V2
