# Cyberalpine Beyondscape

Implementation and device notes checked on **8 November 2026**. The browser experience is implemented; physical Meta Ray-Ban Display verification remains outstanding.

## Open a data climb

- [Beyondscape for phone and laptop](https://cyberalpine.web.app/beyondscape.html)
- [Standalone glasses HUD](https://cyberalpine.web.app/glasses.html)

Choose a dataset route, then reach between its record holds. The Three.js view maps a collection to an authored alpine rock face, with record selection, route progress, forest and ice regions, and an optional gaze view. Touch buttons work on a phone; the laptop canvas supports Up, Space, or Enter to advance, Down to descend, and Home to restart. Normal form controls keep their native keyboard behavior.

Each route uses at most 24 endpoint-inclusive, evenly spaced samples from the chronologically ordered records. Holds retain exact record IDs, dates, observed values, units, and source links. Quantitative pitch mappings normalize within the same unit and source series; CPI and unemployment are not pooled into one numeric scale. Non-numeric collections use route phase instead of an invented observation. The current source snapshot remains **25 October 2025–25 October 2026**; opening Beyondscape does not fetch a newer archive.

Elevation, hold positions, surface shape, reach, and sound are authored display choices. They do not describe a surveyed climbing route or provide instructions for a physical climb. Existing source and derived-record counts retain their separate meanings.

## Soundtrack

Press **Start soundtrack** to create a local Web Audio score. The base, forest, and ice regions alter synthesized timbre; route progress changes tempo, and normalized values influence pitch and brightness. The interface reports the active region and tempo. Volume, mute, and stop controls remain available, and hidden pages pause their audio.

The soundtrack uses no downloaded music, microphone input, or generated Google-model audio. Audio starts only after a user action and depends on the browser/device’s available audio support.

## Meta Ray-Ban Display

Meta documents standalone HTML/CSS/JavaScript web apps for the glasses. The display is 600×600 and additive: black falls away, so the HUD uses bright text, a black background, large controls, and short record summaries. Input uses standard arrow-key and Enter events. A native SDK is not required for this web-app path. [Meta Web Apps documentation](https://developers.meta.com/wearables/web-apps/).

1. Enable Developer Mode for the glasses through the Meta AI mobile app.
2. In the glasses’ app settings, open **App connections → Add a Web App** and enter the glasses URL.
3. Use **Copy route link** in Beyondscape to carry a chosen dataset and hold into that URL. Open the URL in the glasses as its own web app.
4. On the HUD, Up/Down change holds, Left/Right change datasets, and Enter activates the focused button. Sound receives initial focus, so Enter starts/stops the soundtrack while the arrow keys navigate the route. Start sound explicitly when wanted.

The setup entry point and availability depend on the device software and developer access. Meta’s setup instructions are the source of truth. [Meta Wearables FAQ](https://developers.meta.com/wearables/faq/).

## Route state and mirroring

Shared URLs carry the selected dataset IDs and current hold. The same state can be opened independently on a phone, laptop, or glasses. An optional `BroadcastChannel` mirror synchronizes pages opened under the same browser profile and origin with the same session ID. It does **not** pair a phone with separate glasses over the network. No remote room service, head tracking, spatial anchoring, or physical-rock registration is implemented.

Before claiming hardware support, verify the HUD layout and focus behavior on the actual glasses, Neural Band navigation if used, audio activation/volume/mute, and behavior when the app loses visibility. Browser QA alone cannot verify those device behaviors.

## Source entry points

- `public/assets/beyondscape-routes.js`: deterministic record sampling, climbing-face surface, telemetry, and URL state.
- `public/assets/beyondscape.js`: phone/laptop Three.js view and controls.
- `public/assets/glasses.js`: standalone HUD and D-pad input.
- `public/assets/beyondscape-audio.js`: local soundtrack and audio lifecycle.
- `public/assets/beyondscape-session.js`: optional same-browser mirror.

Run the offline checks with `node --test scripts/*.test.mjs`. Serve `public/` over HTTP for local browser QA; module imports and the source snapshot require an HTTP origin.
