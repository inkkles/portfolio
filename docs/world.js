/* ============================================================================
   THE WORLD — this is the file you edit.

   Positions (x, y) and sizes are in pixels of the panorama image (image
   below), measured from its top-left corner. x, y is the CENTER of a thing.

   SPRITE SHEETS: a sheet is one row of square frames. The frame size is the
   image's height, and the number of frames is width / height, so a sheet can
   be any length. Replace a placeholder by saving your own PNG over it (or
   point `sheet` at a new file).

   A thing is either an IMAGE or TEXT:

   image: { id, sheet, x, y, size, fps, link | action, always }
     size    how big one frame is drawn, in world pixels
     fps     animation speed in frames per second (falls back to `fps` below)
     link    where a click goes, e.g. 'https://example.com'   <-- SET LINKS HERE
     action  'artbox' opens the drawing tool, 'guy' is the talking character
     always  true = always animating (otherwise only while hovered)

   text:  { id, text, sub, x, y, size, color, link }
     text    bold Helvetica line
     sub     optional non-bold line underneath
     link    optional; makes the text a button

   To add something, copy a line in `things` and change it.
   ========================================================================== */
const WORLD = {
  server: 'wss://portfolio.inkkles.workers.dev/api/ws', // the shared server on Cloudflare
  image: 'images/world.png', // the looping panorama; its full height is always shown
  stops: [1280, 0],          // x positions the camera can face, in order going right.
                             // < > (or swiping) turn between them. The first is where the site opens.
  view: 900,                 // world width that must always fit on screen (zooms out on phones)
  turn: 1200,                // how long a turn takes, in ms
  fps: 4,                    // default animation speed
  brush: 6,                  // drawing line thickness

  things: [
    // --- bulletin board ---
    { id: 'title', text: 'BULLETIN BOARD', sub: 'placeholder subtext', x: 1280, y: 300, size: 44 },
    { id: 'pic1', sheet: 'images/pic1.png', x: 1070, y: 440, size: 120, link: '' },
    { id: 'pic2', sheet: 'images/pic2.png', x: 1070, y: 600, size: 120, link: '' },
    { id: 'pic3', sheet: 'images/pic3.png', x: 1490, y: 440, size: 120, link: '' },
    { id: 'pic4', sheet: 'images/pic4.png', x: 1490, y: 600, size: 120, link: '' },
    { id: 'artbox', sheet: 'images/artbox.png', x: 1280, y: 740, size: 120, action: 'artbox' },

    // --- the character at the seam (x: 0 is where the panorama loops) ---
    // sheet = idle animation, talkSheet = animation while he is talking
    { id: 'guy', sheet: 'images/guy.png', talkSheet: 'images/guy_talk.png', x: 0, y: 600, size: 256, fps: 4, always: true, action: 'guy' },
  ],

  dialogue: {
    lines: ['Oh, want to talk to me?'], // what he says; add more strings for more boxes
    ring: ["I'm right here..."],        // what he says after "Ring Mauricio"
    dx: 0, dy: -210,                    // where the box sits, relative to his center
    width: 260,                         // text wraps at this width
    size: 24,                           // text size
    speed: 30,                          // letters revealed per second
    wobble: 3,                          // how far letters bob, in pixels (0 = still)
    hold: 1500,                         // ms the "ring" line stays before closing itself
  },
};
