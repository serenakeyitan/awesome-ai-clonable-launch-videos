# Serena landing mascot

The owner avatar was supplied by the GitHub profile https://github.com/serenakeyitan. Background removal used the built-in imagegen tool, with true PNG alpha. The six-second animation is a subtle float/tilt loop. Chromium and Firefox use VP9 WebM with alpha. Safari receives a paper-matched H.264 MP4 fallback. The original purple background is removed. The video has no audio. A pause control and reduced-motion behavior are provided.

Files: `serena-cutout.png` (transparent PNG), `serena-idle.webm` (VP9 alpha), and `serena-idle.mp4` (H.264 fallback). Both videos are 720×720, 30fps, six seconds. Regenerate with `bash scripts/render_mascot.sh` from the repository root.

Final imagegen prompt:

Use case: background-extraction. Edit target: the provided cartoon avatar. Remove ONLY the flat lavender-purple background and make it truly transparent. Keep the exact original character intact: blue hair silhouette and thin black outlines, half-lidded blue eyes with pink eyeshadow, face and expression, black shirt with sailboat patch and blue peace symbol, bent raised hand holding the blue pencil, pose, framing, proportions, and all original flat colors. Do not redraw, restyle, add body parts, add objects, add text, add shadows, or add any backdrop. Preserve the bottom crop at the torso. Deliver one clean high-resolution transparent PNG cutout suitable for use as a landing-page mascot. Clean antialiased edge, no lavender halo, generous transparent margin around the visible character.
