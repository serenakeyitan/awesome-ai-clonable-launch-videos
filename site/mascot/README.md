# Serena landing mascot

The landing page uses `serena-cutout.png` as a static illustration integrated into the agent setup panel. CSS mirrors the character toward the content, tilts it slightly, and clips the lower body against the panel edge. On smaller screens it sits over the upper border. The page has no mascot video or playback controls.

The owner avatar comes from https://github.com/serenakeyitan. Background removal used the built-in imagegen tool, preserving PNG alpha. The earlier six-second animation assets and rendering script remain available as source materials.

Final imagegen prompt:

Use case: background-extraction. Edit target: the provided cartoon avatar. Remove ONLY the flat lavender-purple background and make it truly transparent. Keep the exact original character intact: blue hair silhouette and thin black outlines, half-lidded blue eyes with pink eyeshadow, face and expression, black shirt with sailboat patch and blue peace symbol, bent raised hand holding the blue pencil, pose, framing, proportions, and all original flat colors. Do not redraw, restyle, add body parts, add objects, add text, add shadows, or add any backdrop. Preserve the bottom crop at the torso. Deliver one clean high-resolution transparent PNG cutout suitable for use as a landing-page mascot. Clean antialiased edge, no lavender halo, generous transparent margin around the visible character.
