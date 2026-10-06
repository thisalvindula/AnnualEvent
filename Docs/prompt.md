You are a senior product designer and front-end engineer specialising in live-event stage visuals (think award-show broadcast graphics, not a business dashboard). I want you to design the BIG-SCREEN interfaces for a real event. This message is the master brief. In this message you will only build the design system and the logo. I will send the raffle screen and the voting screen in follow-up messages, and both must reuse what you create here. Do not build the screens yet.

## 1. What this is

I work at AmSafe Bridport. We hold an annual year-end party for about 800 employees at [EVENT NAME, e.g. "Annual Get-Together 2026"]. I built one web app that runs two live activities during the party:

1. RAFFLE DRAW. Employees scan a QR code on the big screen, verify themselves (employee number + last 4 digits of NIC), and get entered. When registration closes, the winners for every configured gift are drawn live on stage, one at a time, by an operator pressing "Draw next" on an admin page. Gifts are a list, e.g. "1st place, Cash 100000" (1 winner), "Consolation prize, Hamper" (10 winners).
2. SINGING COMPETITION VOTING. Employees scan a different QR code and vote once for 1 of 5 finalist singers during a timed window (default 15 minutes). The big screen shows live vote counts. Employees' phones never show counts. When the timer ends, the winner is announced.

The app has three kinds of UI:
- Employee pages (phones): tiny, lightweight, no animation. Out of scope.
- Admin pages (operator laptop): utilitarian. Out of scope.
- BIG SCREENS (projector or LED wall, watched by ~800 people in a ballroom): this is what I want you to design. They should be spectacular: heavy on visual polish, motion and drama. They are display-only (no buttons, no inputs). The admin drives everything and the screen reacts.

## 2. Look and feel

- Theme: NAVY BLUE and SILVER. Deep navy backgrounds, brushed/metallic silver for headings, frames and highlights, cool electric-blue glow as the light colour. Premium, corporate-celebratory, modern. Not childish, not neon-rave.
- Gold is allowed ONLY as a rare celebration accent (1st place / winner moments). Define it as a single token (`--gold`, `--gold-bright`) so I can remove it if I decide to.
- Feel: glossy stage production. Ideas to draw on (choose what works, don't use them all): slow-moving aurora or light beams behind everything, faint particle field or star dust, subtle perspective grid or ripple rings, glass/frosted panels with thin silver edge highlights, metallic gradient text with a light sweep, soft volumetric spotlights, depth via layered parallax drift.
- Motion: purposeful and cinematic. Ease-out curves, staggered entrances, anticipation before reveals, satisfying settle after. Idle screens should feel alive (slow ambient motion) but never distracting.
- No emoji as icons (use inline SVG). No stock photos. No lorem ipsum.

Reference tokens from my existing app (keep the palette family; refine it if you can improve it):
--navy-950 #060b18, --navy-900 #0a1428, --navy-800 #102544, --navy-700 #17335e, --navy-600 #204378, --navy-500 #2c5697,
--accent #4f7fe0, --accent-bright #7fa6ff,
--silver-100 #eef1f6, --silver-200 #dde3ec, --silver-300 #c3cbda, --silver-400 #9aa5ba, --silver-500 #707d94,
--gold #e0b64c, --gold-bright #f5d888.

## 3. Hard constraints (the real venue)

- Canvas: design for a 1920x1080 (16:9) stage and scale to fit any resolution using a CSS transform scale wrapper. Never scroll. Keep a 4-5% safe margin because projectors overscan.
- Distance: viewers are 10 to 40 metres away. Minimum text size 28px at 1080p, key information 48px+, countdown 220px+, winner name 110px+. Strong contrast. Nothing important in thin light-grey text.
- Dark, not glaring: avoid large pure-white areas (they wash out on projectors and blind a dark room). The QR code is the one deliberate exception: it needs a white/very light quiet zone to scan.
- Performance: it will run on an ordinary office laptop driving a projector, for hours. Animate only `transform` and `opacity` where possible, avoid animating big blur/backdrop-filter/box-shadow areas, cap particles at roughly 150, use canvas or CSS only. Stable 60fps matters more than an extra effect.
- No external images. No network dependencies at runtime, because the venue internet may fail. Fonts: at most two families; tell me exactly which so I can self-host them, and include a good system-font fallback stack.
- Names may be long (up to about 40 characters) and may contain non-Latin characters. Layouts must not break: shrink-to-fit or wrap gracefully.
- No audio. No localStorage. No animation libraries: CSS animations, requestAnimationFrame and canvas only, so the code ports one-to-one into my app.
- Respect `prefers-reduced-motion` with a calmer fallback (keep it simple).

## 4. How the code must be structured (I will port it into my app)

My production frontend is Vite + Preact (with `preact/compat`, so it is written as React function components with hooks only). Therefore:
- Build the artifact as React with function components and hooks only. No React libraries other than react itself.
- All CSS in ONE `<style>` block. Design tokens as CSS variables on `:root`. Use class names prefixed per area (`.ev-` shared, `.rf-` raffle, `.vt-` voting), no CSS-in-JS, no Tailwind.
- Screen components are PURE and prop-driven. They take plain data props (I will give the exact shapes later) and contain no fetching. My app already has hooks that supply the data (SSE stream + polling).
- Any demo/simulation controls live in a clearly separated `DemoControls` component that I can delete without touching the screens.
- Keep every component small, named, and commented with a one-line purpose.

## 5. Your task in THIS message

A) Study the attached logo carefully. Before building, describe back to me in a short list what you see: shapes, letterforms, colours, proportions, spacing, any gradients, and which text is set in a typeface. If anything is ambiguous, ask me before building.

B) Rebuild the logo as code: pure inline SVG + CSS, no `<img>`, no base64, no raster, no font dependency (convert any text to paths, or if you cannot reproduce the lettering faithfully, tell me exactly which typeface it looks like and use the closest match plus a note). Be faithful to the original proportions and identity. Do not reinterpret or "improve" the mark. Provide:
   1. `Logo` component with variants via a prop: `lockup` (mark + wordmark), `mark` (symbol only), `mono` (single-colour silver).
   2. Scales cleanly from 64px to 800px wide via one CSS variable (`--logo-size`), using a viewBox.
   3. Animation states, controlled by a `state` prop or class:
      - `intro`: a 2.5 to 3.5 second cinematic build-in (stroke draw / mask wipe / light sweep, then the fill and glow settle),
      - `idle`: a looping subtle ambient effect (slow silver shimmer sweep and soft glow breathing) that is safe to run for hours,
      - `static`: no motion.
   4. It must also work as a plain HTML+CSS snippet with no JavaScript, so I can reuse it on any page. After the artifact, give me that standalone snippet in its own code block.

C) Build the shared design system as a single "design system" artifact page showing:
   - the colour tokens, type scale for a 1080p stage, spacing and radius tokens, easing/duration tokens,
   - the animated ambient stage background (`StageBackground` component: navy gradient, moving light, particles, vignette; it must accept a `mood` prop of `calm | live | celebration`, where celebration warms slightly toward gold),
   - the reusable primitives I will use on both screens: `LiveBadge` (states: waiting, coming up, LIVE, drawing, sealing, final result, complete), `Countdown` (big clock; normal, warning at 60s or less, critical at 10s or less with a pulse, and "Closed" state), `QrSlot` (a white quiet-zone card with a glowing frame; it takes a `dataUrl` prop and shows a placeholder when empty; I will supply the real QR), `Avatar` (round photo with silver ring; falls back to initials on a navy gradient; sizes sm, md, lg, xl), `AnimatedNumber` (eased count-up), `GlassPanel`, `MetalText` (silver gradient text with optional light sweep), `Confetti` (canvas, colour palette prop, `originX` prop, burst API),
   - the Logo in all variants and states, on the stage background.
   Show each primitive in each state so I can review them.

Deliver the artifact, then a short list of the fonts used and anything you are unsure about.
PROMPT 2 of 4: Raffle big screen (send after the design system is approved)
Now build the RAFFLE big screen using the same design system, primitives and logo you just created. Inline the Logo and primitives into this artifact (artifacts can't import each other). Keep the same class prefixes and tokens.

Design it for 1920x1080, projected in a ballroom, as the visual centrepiece of the prize giveaway. The current version is a small centred column; the new one should use the whole stage.

## Data the screen receives (props; do not fetch anything)

```ts
// polled every 1s from /raffle/api/status
status: { isOpen: boolean; status: 'draft' | 'open' | 'closed'; secondsRemaining: number }

// pushed live
entryCount: number                          // up to about 800, ticks up during registration
seal: null | { count: number; sha256: string }   // set once registration is closed and the list is locked; sha256 is 64 hex chars
totalPrizes: number                         // total winners across all gifts (could be 5 or 40)
drawnCount: number                          // winners drawn so far

// one event per drawn winner, the moment the operator presses "Draw next"
winner: {
  giftId: number; slot: number;             // slot = which winner within the gift
  empId: string; name: string; imageName: string | null;  // photo optional; use initials fallback
  place: string;                            // e.g. "1st place", "Consolation prize"
  description: string;                      // e.g. "Cash 100000"
  quantity: number;                         // winners for this gift. quantity === 1 => PREMIUM tier (gold). quantity > 1 => NORMAL tier (blue/silver)
  remaining: number;                        // prizes still to draw after this one. 0 => this was the last winner => GRAND FINALE
}

// accumulated by the parent, newest first
recentWinners: { key: string; tier: 'premium' | 'normal'; name: string; place: string; description: string; imageName: string | null }[]
```

## Screen states to design (all of them)

1. COMING UP (status draft): logo intro then idle, event title, "Registration opens soon", ambient calm mood. Badge: "Coming up".
2. REGISTRATION OPEN (isOpen): the QR is the hero. Large QrSlot with "Scan to enter" and the short URL text beneath, the giant Countdown, and the live entry counter ("412 entries", eased count-up, with a small pulse or ripple each time it increases). Badge: LIVE. Show a subtle "use mobile data" hint. Countdown escalates visually at 60s and 10s (the whole stage can gain urgency, e.g. a rim light that turns warmer), without becoming garish.
3. REGISTRATION CLOSED, SEALING (status closed, seal = null): a short dramatic "Registration closed. Locking the entry list" moment. Badge: Sealing.
4. LIST SEALED (seal set, no winner drawn yet): the integrity moment. Show a "sealed ledger" element: lock icon (SVG), the entry count large, and the full 64-character SHA-256 in monospace, split into groups so it is readable but clearly a fingerprint. Copy along the lines of "The entry list is locked. Nobody can be added or removed." This proves fairness to the audience, so it should feel serious and trustworthy. Then a "Draw begins shortly" state with the prize-progress display visible.
5. DRAWING (winner events arriving): the main show. See the reveal choreography below. Persistent elements: prize progress ("7 of 30 prizes awarded") as a scalable progress display that works for 5 or 40 prizes (dots for up to about 30, a bar or segmented ring beyond that; choose one elegant approach), plus a "recent winners" rail.
6. GRAND FINALE (winner.remaining === 0 and its reveal finished): after the last reveal, transition to a "Winners wall": everyone drawn, grouped by prize (place + description), with photos. It must fit 1080p for up to about 40 winners (auto-scale or paginate/auto-scroll gently). Celebration mood, big banner "All N prizes have been awarded", gold sparks, twin confetti bursts from left and right.
7. COMPLETE / IDLE after finale: calm loop of the winners wall with the logo.

## Winner reveal choreography (this is the most important part)

Runs when a new `winner` arrives. Total about 5 to 7 seconds for NORMAL, 8 to 10 seconds for PREMIUM. Do it as a sequence with clear beats:
1. Anticipation: stage dims, spotlight cone or vignette closes in, a ring or pulse builds, the prize is presented first (place badge + prize description, large), e.g. "1st place / Cash 100000".
2. Suspense: the name area cycles through randomised characters or a slot-machine style roll that decelerates, maybe with a light sweep, for 2 to 3 seconds. Use a monospace scramble or a reel; make it feel like machinery settling, not a gimmick.
3. Reveal: name locks in with a flash or shock ring, the Avatar (xl) pops in with silver ring (gold for premium), employee ID appears beneath in small caps. Name is 110px+ and must fit long names.
4. Celebration: confetti burst (colours per tier: premium = gold/white/blue, normal = blue/silver/white), light beams, count of prizes awarded ticks up, progress fills with a pop.
5. Settle: after a few seconds the winner card eases into the recent-winners rail as a compact chip and the stage calms back to waiting for the next draw ("Waiting for the next draw"). The card must stay long enough to be read and photographed by the audience; it stays until the next `winner` event arrives, then the chip goes to the rail.
PREMIUM (gold) must feel clearly grander than NORMAL: longer build, bigger burst, warm gold light.
The scramble/reveal must be keyed on winner identity (giftId:slot:empId) so a re-render does not replay it.

## Layout guidance

Use the full 16:9 canvas. Suggested but not mandatory: header strip with logo (small) + event title + LiveBadge; left column QR (only while registration is open); central stage for clock/counter/ledger/reveal; bottom or side rail for recent winners and progress. The stage area for the reveal must dominate when drawing. Everything must reflow gracefully when the QR disappears (registration ended).

## Demo controls (separate component, deletable)

A floating panel toggled with the "D" key. Buttons to jump to each state above. A countdown you can start from 0:15 to see warning/critical. "+1 entry" and "+25 entries". "Draw next winner (normal)", "Draw next winner (premium)", "Draw LAST winner (finale)". "Reset". Use realistic mock data: about 30 prizes in total (a few single premium gifts, a couple of multi-winner gifts), plausible employee names including one very long name and one with no photo, no real photos needed (initials fallback).

## Deliverable

The single-file artifact. Then a short summary: component list with props, anything you assumed, and any values I should tune for the real venue.
PROMPT 3 of 4: Voting big screen
Now build the SINGING COMPETITION VOTING big screen, same rules as before: reuse the design system, primitives and logo (inline them), 1920x1080, same class-prefix and code-structure constraints. Prefix voting classes `.vt-`.

This is a live talent-show scoreboard, watched by 800 people while five colleagues have just performed. It must be exciting while voting is open and climactic when it closes.

## Data the screen receives (props; do not fetch)

```ts
// polled every 1s from /vote/api/status
status: { isOpen: boolean; status: 'draft' | 'open' | 'closed'; secondsRemaining: number }

// pushed at most once per second while voting
tally: { id: number; name: string; song: string | null; imageName: string | null; votes: number; position: number }[]   // always exactly 5 finalists; position 1..5 is their performance order
totalVotes: number                          // about 0 to 800
```

Derived by the screen: final = status.status === 'closed'. Ranking uses competition ranking: finalists on equal votes share a rank (1, 1, 3...). The winner(s) are all finalists sharing the top vote count, if that count is above zero. A tie between 2 to 5 finalists must be handled beautifully ("Audience favourites, it's a tie!").

## Screen states (design all)

1. COMING UP (draft): logo intro/idle, event title "Best Singer" (call it "Best Singer, Live Vote"), the five finalists presented as a calm line-up (photo, name, song) in performance order, "Voting opens soon".
2. VOTING OPEN: the leaderboard is the hero, QR secondary but always visible and large enough to scan from the back (QrSlot with "Scan to vote"), giant Countdown, "N votes cast" total with eased count-up. LIVE badge. Countdown escalates at 60s and 10s. Show phone-friendly hint "Use mobile data".
   LEADERBOARD: 5 rows, live-sorted by votes. Each row: rank medallion (gold #1, silver #2, bronze #3, plain 4/5; tied finalists share a medallion and styling), Avatar (lg), name (48px+), song title (secondary, ellipsis for long), a large animated vote number, and a bar showing votes relative to the leader with a shimmering, glossy fill. Also show percentage of total votes if it fits cleanly.
   MOTION: rows re-order with a smooth FLIP transition when the order changes (add a brief "overtake" highlight: a light sweep and arrow when someone passes another). Each new vote landing on a finalist gives a small pulse on their bar and number. The leader row has a subtle crown (SVG, bobbing) and a warm glow. Numbers count up with easing. It must remain readable when votes arrive in bursts of tens per second.
   Since counts can be zero at the start: all bars empty but still elegant.
3. LAST MINUTE (secondsRemaining <= 60): tension mode: stage lighting shifts, a "Final minute" ribbon, clock pulse. At <= 10s: critical pulse, edges glow. Keep the leaderboard fully legible.
4. VOTING CLOSED, COUNTING (the moment status becomes closed): a 3 to 4 second suspense beat ("Voting closed. Counting the votes...") with a drumroll-style build: bars freeze, rows dim except a sweeping spotlight, no result yet. Expose the delay as a prop (`revealDelayMs`, default 3500).
5. FINAL RESULT, single winner: the big climax. Leaderboard slides aside or shrinks; the winner takes centre stage: spotlight, crown descending, huge Avatar (xl) with gold ring, name at 120px+, song title, "Audience Favourite" label, "X of N votes" (and percentage), confetti bursts, gold/white light beams. The runner-ups remain visible as a compact podium/list with final counts. Make it feel like a trophy moment.
6. FINAL RESULT, tie (2 to 5 winners): same climax adapted: winners share the stage side by side, each with Avatar and name sized to fit, "It's a tie!" copy, shared vote count.
7. FINAL RESULT, zero votes: no hero and no confetti: a graceful "No votes were cast" state showing the five finalists.
Fire the confetti once only, on the transition into the winner reveal; re-renders must not replay it.

## Layout guidance

Use the full canvas, not a centred column. Suggested: left/centre = leaderboard, right = QR + clock + total (while voting is open). On final result the right column collapses and the winner stage takes over. Everything must re-flow gracefully when the QR disappears.

## Demo controls (separate, deletable, toggled with "D")

Jump to each state. Start a countdown from 0:15. "Simulate a burst of votes" (random split over finalists, with tens of votes per second), "+1 vote to finalist N" buttons (to trigger overtakes), "Force a tie", "Zero votes", "Close voting now" (runs the suspense then reveal), "Reset". Mock the 5 finalists with plausible names (one very long, one with no photo), song titles (one very long), and total near 800.

## Deliverable

The single-file artifact, then a short summary: component list with props, assumptions, and values to tune at the venue.
PROMPT 4 of 4: Handoff bundle (send after both screens are approved)
Both screens are approved. Now prepare the handoff so I can move this into my Vite + Preact codebase. Give me, as separate clearly labelled code blocks:
1. `screen-theme.css`: the full merged stylesheet (tokens, StageBackground, primitives, raffle `.rf-*`, voting `.vt-*`) with no demo styles. Group with comment headers.
2. The standalone HTML+CSS logo snippet (no JavaScript), plus the React `Logo` component.
3. Each component as its own file (with `import { useState, useEffect, useRef, useMemo } from 'react'`), labelled by suggested path, e.g. `shared/ui/Logo.jsx`, `shared/ui/StageBackground.jsx`, `shared/ui/Avatar.jsx`, `raffle/screen/WinnerReveal.jsx`, `raffle/screen/WinnersWall.jsx`, `voting/screen/Leaderboard.jsx`, `voting/screen/FinalResult.jsx`, and the two top-level `RaffleScreen` and `VotingScreen` components taking the props I specified. Exclude all `DemoControls`.
4. A table per screen: prop name, type, which state uses it, and a note on anything the parent must compute (for example `recentWinners` accumulation, grand-finale detection, tie detection).
5. The list of fonts used with exact weights so I can self-host them, plus any timing constants (reveal durations, suspense delay) I may want to tune at the venue.
6. A short checklist of things I must test on the real projector (contrast, safe margins, text legibility from the back, frame rate).