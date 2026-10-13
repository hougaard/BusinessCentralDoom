// DOOM Screen control add-in
// Receives 320x200 palette indexed frames from AL, draws them on a canvas and sends input back.
(function doomScreen() {
    'use strict';
    if (!document.getElementById('controlAddIn')) {
        // not in the DOM yet: start when the page has loaded
        window.addEventListener('load', doomScreen);
        return;
    }

    var W = 320, H = 200;
    var root = document.getElementById('controlAddIn');
    root.innerHTML =
        '<div class="doom-wrap" id="doomWrap">' +
        '  <canvas id="doomCanvas" width="320" height="200" tabindex="0"></canvas>' +
        '  <div class="doom-status" id="doomStatus">' +
        '    <div id="doomStatusText">Loading DOOM...</div>' +
        '    <button id="doomLoadWad" class="doom-button" style="display:none">Import WAD file...</button>' +
        '  </div>' +
        '  <div class="doom-fps" id="doomFps"></div>' +
        '  <div class="doom-info" id="doomInfo"></div>' +
        '  <div class="doom-toast" id="doomToast"></div>' +
        '</div>';

    var canvas = document.getElementById('doomCanvas');
    // WebGL draws the frame at the display resolution through an upscaling filter (End cycles the filters),
    // the 2D canvas (stretched by the browser) is the fallback
    var renderer = doomCreateRenderer(canvas, W, H);
    var ctx = renderer ? null : canvas.getContext('2d');
    var image = ctx ? ctx.createImageData(W, H) : new ImageData(W, H);
    var pixels = new Uint32Array(image.data.buffer);
    var rgba = new Uint8Array(image.data.buffer);
    var toastBox = document.getElementById('doomToast');
    var toastTimer = 0;
    if (renderer) {
        try {
            var savedFilter = window.localStorage.getItem('doom.filter');
            if (savedFilter !== null) renderer.mode = +savedFilter;
        } catch (e) { }
    }
    var palette = new Uint32Array(256);
    var statusBox = document.getElementById('doomStatus');
    var statusText = document.getElementById('doomStatusText');
    var loadButton = document.getElementById('doomLoadWad');
    var fpsBox = document.getElementById('doomFps');
    var infoBox = document.getElementById('doomInfo');
    var showStats = false;                    // performance overlay, toggled with the ` key (left of 1)
    var wrap = document.getElementById('doomWrap');

    var running = false;
    var inFlight = 0;           // requests sent and not answered yet
    var maxInFlight = 2;        // 2 = send input right away even while a batch is being rendered (Home toggles)
    var reqQueue = [];          // latency info per request in flight, in order
    var events = [];
    var lastRequest = 0;
    var mouseDX = 0, mouseDY = 0;
    var frames = 0, fpsStart = performance.now();
    var keysDown = {};
    var indexes = new Uint8Array(W * H);     // current frame as palette indexes
    var queue = [];                           // frames waiting to be shown
    var batchSize = 2;                        // frames rendered per server round trip
    var frameDelay = 100;                     // ms between shown frames (adapts to the server speed)
    var nextShow = 0;
    var lastBatch = 0;
    var serverMs = 0, roundTripMs = 0;
    // input latency measurement: time from the first input event to the first frame that includes it
    var pressTime = 0;          // first input event not sent to the server yet
    var lagText = 'press a key to measure input lag';

    for (var i = 0; i < 256; i++) palette[i] = 0xff000000;

    // ---------------------------------------------------------------- layout
    function resize() {
        // DOOM's 320x200 is displayed with a 4:3 aspect ratio
        var w = wrap.clientWidth, h = wrap.clientHeight;
        var cw = w, ch = Math.floor(w * 3 / 4);
        if (ch > h) { ch = h; cw = Math.floor(h * 4 / 3); }
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        if (renderer) renderer.resize(cw, ch);
    }

    function showToast(text) {
        toastBox.textContent = text;
        toastBox.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastBox.style.opacity = '0'; }, 1500);
    }

    function nextFilter() {
        if (!renderer) {
            showToast('Upscaling filters need WebGL');
            return;
        }
        renderer.mode = renderer.mode + 1;
        showToast('Filter: ' + renderer.modes[renderer.mode] + '  (End)');
        try { window.localStorage.setItem('doom.filter', String(renderer.mode)); } catch (e) { }
    }
    window.addEventListener('resize', resize);
    resize();

    // ---------------------------------------------------------------- frames
    function setPalette(b64) {
        var p = atob(b64);
        for (var i = 0; i < 256; i++) {
            palette[i] = 0xff000000 | (p.charCodeAt(i * 3 + 2) << 16) | (p.charCodeAt(i * 3 + 1) << 8) | p.charCodeAt(i * 3);
        }
    }

    function applyFrame(frame) {
        var parts = frame.split('!');
        var pal = parts[0];
        var rows = parts[1] || '';
        if (parts[2]) playSounds(parts[2]);
        if (pal) setPalette(pal);
        if (rows) {
            var bin = atob(rows);
            for (var off = 0; off + 321 <= bin.length; off += 321) {
                var base = bin.charCodeAt(off) * W;
                for (var x = 0; x < W; x++) indexes[base + x] = bin.charCodeAt(off + 1 + x);
            }
        }
    }

    function showFrame(entry) {
        applyFrame(entry.data);
        for (var i = 0; i < W * H; i++) pixels[i] = palette[indexes[i]];
        if (renderer) renderer.draw(rgba);
        else ctx.putImageData(image, 0, 0);
        frames++;
        var now = performance.now();
        if (entry.req) {
            var r = entry.req;
            lagText = 'input lag ' + Math.round(now - r.press) + 'ms = waiting to send ' + Math.round(r.sent - r.press) +
                ' + round trip ' + Math.round(r.arrived - r.sent) + ' (server ' + r.server + ') + display ' + Math.round(now - r.arrived);
        }
        if (now - fpsStart > 1000) {
            fpsBox.textContent = (frames * 1000 / (now - fpsStart)).toFixed(1) + ' fps | batch ' + batchSize +
                ' (PgUp/PgDn) | input ' + (maxInFlight > 1 ? 'immediate' : 'with next batch') + ' (Home) | server ' + serverMs + 'ms | round trip ' + Math.round(roundTripMs) + 'ms' +
                (audio && audio.state === 'running' ? '' : ' | sound: press a key') + (musicStatus ? ' | ' + musicStatus : '') + '\n' + lagText;
            frames = 0;
            fpsStart = now;
        }
    }

    function animate() {
        var now = performance.now();
        if (queue.length && now >= nextShow) {
            // first frame of a batch is shown right away, the rest spread until the next batch is expected
            showFrame(queue.shift());
            // catch up when frames pile up
            nextShow = now + (queue.length > batchSize ? frameDelay / 2 : frameDelay);
        }
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    window.DrawFrames = function (batch, ms) {
        var now = performance.now();
        var list = batch ? batch.split(';') : [];
        serverMs = ms;
        roundTripMs = now - lastRequest;
        if (lastBatch && list.length) {
            // spread the frames of this batch over the time until the next batch arrives
            var interval = now - lastBatch;
            frameDelay = frameDelay * 0.7 + (interval / list.length) * 0.3;
        }
        lastBatch = now;
        // frames of the previous batch that were not shown yet are outdated now: apply them without showing
        while (queue.length) applyFrame(queue.shift().data);
        nextShow = 0;
        inFlight = Math.max(0, inFlight - 1);
        var req = reqQueue.shift() || null;
        if (req && req.press) {
            req.arrived = now;
            req.server = ms;
        }
        for (var i = 0; i < list.length; i++) queue.push({ data: list[i], req: i === 0 && req && req.press ? req : null });
        if (running && inFlight === 0) requestFrames();   // keep the server busy
    };

    // ---------------------------------------------------------------- sound
    // The engine only reports sound events, the sound effects (DMX format lumps from the WAD) are played here.
    var audio = null;
    var lumps = {};         // lump number -> raw lump bytes (sound effects and music)
    var sfxBuffers = {};    // lump number -> AudioBuffer
    var playing = {};       // engine handle -> { src, gain, pan }

    function initAudio() {
        if (!audio) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audio = new AC();
        }
        // browsers only allow audio after a user gesture: called again on key presses and clicks
        if (audio.state === 'suspended') audio.resume().then(updateMusic);
    }

    window.LoadAudio = function (data) {
        lumps = {};
        sfxBuffers = {};
        midiCache = {};
        var list = data ? data.split('|') : [];
        for (var i = 0; i < list.length; i++) {
            var colon = list[i].indexOf(':');
            var bin = atob(list[i].substring(colon + 1));
            var bytes = new Uint8Array(bin.length);
            for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            lumps[list[i].substring(0, colon)] = bytes;
        }
        initAudio();
        loadMusicPlayer();
    };

    function sfxBuffer(lump) {
        if (sfxBuffers[lump]) return sfxBuffers[lump];
        var b = lumps[lump];
        // DMX header: format 3, sample rate, sample count; then unsigned 8 bit samples with 16 padding bytes at both ends
        if (!b || b.length < 8 || (b[0] | (b[1] << 8)) !== 3) return null;
        var rate = b[2] | (b[3] << 8);
        var count = Math.min(b[4] | (b[5] << 8) | (b[6] << 16), b.length - 8);
        var start = 8, end = 8 + count;
        if (count > 32) { start += 16; end -= 16; }
        var buffer = audio.createBuffer(1, end - start, rate);
        var data = buffer.getChannelData(0);
        for (var i = start; i < end; i++) data[i - start] = (b[i] - 128) / 128;
        sfxBuffers[lump] = buffer;
        return buffer;
    }

    function setSoundParams(s, vol, sep) {
        // volume 0..15, separation 0 = left .. 255 = right
        s.gain.gain.value = Math.min(vol, 15) / 15;
        if (s.pan) s.pan.pan.value = Math.max(-1, Math.min(1, (sep - 128) / 128));
    }

    function stopSound(handle) {
        var s = playing[handle];
        if (!s) return;
        delete playing[handle];
        try { s.src.stop(); } catch (e) { }
    }

    function startSound(handle, lump, vol, sep, pitch) {
        var buffer = sfxBuffer(lump);
        if (!buffer) return;
        var s = { src: audio.createBufferSource(), gain: audio.createGain(), pan: audio.createStereoPanner ? audio.createStereoPanner() : null };
        s.src.buffer = buffer;
        s.src.playbackRate.value = Math.pow(2, (pitch - 128) / 64);
        s.src.connect(s.gain);
        if (s.pan) { s.gain.connect(s.pan); s.pan.connect(audio.destination); }
        else s.gain.connect(audio.destination);
        setSoundParams(s, vol, sep);
        s.src.onended = function () { if (playing[handle] === s) delete playing[handle]; };
        playing[handle] = s;
        s.src.start();
    }

    // s,handle,lump,vol,sep,pitch = start | u,handle,vol,sep = changed | x,handle = stop
    // m,lump,looping = play music | mx = stop music | mp = pause | mr = resume | mv,vol = music volume
    function playSounds(events) {
        var list = events.split('|');
        var musicChanged = false;
        var sfxOn = audio && audio.state === 'running';
        for (var i = 0; i < list.length; i++) {
            var e = list[i].split(',');
            var handle = e[1];
            if (e[0].charAt(0) === 'm') {
                // the music state is kept even while audio is off, so the right song starts when it comes on
                if (e[0] === 'm') { music.lump = e[1]; music.loop = e[2] === '1'; music.paused = false; }
                else if (e[0] === 'mx') music.lump = '';
                else if (e[0] === 'mp') music.paused = true;
                else if (e[0] === 'mr') music.paused = false;
                else if (e[0] === 'mv') music.volume = +e[1];
                musicChanged = true;
            } else if (!sfxOn) {
                continue;
            } else if (e[0] === 's') {
                stopSound(handle);
                startSound(handle, e[2], +e[3], +e[4], +e[5]);
            } else if (e[0] === 'u') {
                if (playing[handle]) setSoundParams(playing[handle], +e[2], +e[3]);
            } else if (e[0] === 'x') {
                stopSound(handle);
            }
        }
        if (musicChanged) updateMusic();
    }

    // ---------------------------------------------------------------- music
    // The MUS lumps are converted to MIDI (mus2mid.js) and played by spessasynth (spessasynth_core) with a General MIDI
    // sound font. The synthesizer renders on the main thread into a ScriptProcessorNode: an AudioWorklet would need a
    // secure context (https), and rendering costs only ~2% CPU.
    var SPESSASYNTH = 'https://cdn.jsdelivr.net/npm/spessasynth_core@4.3.22/+esm';
    var SOUNDFONT = 'https://cdn.jsdelivr.net/gh/spessasus/SpessaSynth@4.3.14/soundfonts/GeneralUserGS.sf3';
    var music = { lump: '', loop: false, paused: false, volume: 8 };   // what the engine wants to play
    var musicPlayer = null;          // { lib, synth, seq, gain, node } once loaded
    var musicLoading = false;
    var musicStatus = '';
    var playingLump = '';            // the song loaded into the sequencer
    var playingPaused = false;
    var midiCache = {};              // lump number -> parsed MIDI

    function loadMusicPlayer() {
        if (musicLoading || !audio) return;
        musicLoading = true;
        musicStatus = 'loading music';
        var lib, synth;
        // dynamic import works from a classic script: the library is an ES module
        Promise.all([
            import(SPESSASYNTH),
            fetch(SOUNDFONT).then(function (r) {
                if (!r.ok) throw new Error('sound font: HTTP ' + r.status);
                return r.arrayBuffer();
            })
        ]).then(function (r) {
            lib = r[0];
            var soundFont = r[1];
            synth = new lib.SpessaSynthProcessor(audio.sampleRate);
            return synth.processorInitialized.then(function () {
                synth.soundBankManager.addSoundBank(lib.SoundBankLoader.fromArrayBuffer(soundFont), 'main');
            });
        }).then(function () {
            var seq = new lib.SpessaSynthSequencer(synth);
            var gain = audio.createGain();
            var node = audio.createScriptProcessor(4096, 0, 2);
            node.onaudioprocess = function (e) {
                var left = e.outputBuffer.getChannelData(0);
                var right = e.outputBuffer.getChannelData(1);
                left.fill(0);
                right.fill(0);
                // advance the song in small steps so note timing stays accurate
                for (var o = 0; o < left.length; o += 128) {
                    seq.processTick();
                    synth.process(left, right, o, Math.min(128, left.length - o));
                }
            };
            node.connect(gain);
            gain.connect(audio.destination);
            musicPlayer = { lib: lib, synth: synth, seq: seq, gain: gain, node: node };
            musicStatus = '';
            updateMusic();
        }).catch(function (err) {
            musicPlayer = null;
            musicStatus = 'music failed: ' + (err && err.message ? err.message : err);
            if (window.console) console.error('DOOM music', err);
        });
    }

    function songMidi(lump) {
        if (!midiCache[lump] && lumps[lump]) {
            var b = lumps[lump];
            // DOOM's songs are MUS, newer WADs (e.g. Freedoom) contain standard MIDI files ('MThd')
            var isMidi = b[0] === 0x4D && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64;
            var mid = isMidi ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : doomMusToMidi(b);
            if (mid) midiCache[lump] = musicPlayer.lib.BasicMIDI.fromArrayBuffer(mid, 'D_' + lump + '.mid');
        }
        return midiCache[lump];
    }

    // makes the sequencer play what the engine wants
    function updateMusic() {
        var p = musicPlayer;
        if (!p) return;
        p.gain.gain.value = Math.min(music.volume, 15) / 15;
        if (music.lump !== playingLump) {
            playingLump = music.lump;
            playingPaused = false;
            p.seq.pause();
            p.synth.stopAllChannels(true);
            var midi = music.lump ? songMidi(music.lump) : null;
            if (!midi) return;
            p.seq.loadNewSongList([midi]);
            p.seq.loopCount = music.loop ? Infinity : 0;
            p.seq.play();
        }
        if (music.lump && music.paused !== playingPaused) {
            playingPaused = music.paused;
            if (music.paused) p.seq.pause(); else p.seq.play();
        }
    }

    window.ShowInfo = function (info) {
        infoBox.textContent = info;
    };

    window.ShowStatus = function (message, showLoadButton) {
        statusText.textContent = message;
        statusBox.style.display = message ? 'flex' : 'none';
        loadButton.style.display = showLoadButton ? 'inline-block' : 'none';
    };

    window.Start = function () {
        ShowStatus('', false);
        running = true;
        lastRequest = performance.now();
        canvas.focus();
        requestFrames();
    };

    function requestFrames() {
        if (!running || inFlight >= maxInFlight) return;
        if (mouseDX || mouseDY) {
            events.push([2, mouseDX, mouseDY]);
            mouseDX = 0;
            mouseDY = 0;
        }
        var now = performance.now();
        var elapsed = Math.round(now - lastRequest);
        lastRequest = now;
        var input = JSON.stringify(events);
        events = [];
        reqQueue.push(pressTime ? { press: pressTime, sent: now } : {});
        pressTime = 0;
        inFlight++;
        // an extra request for immediate input renders a single frame
        Microsoft.Dynamics.NAV.InvokeExtensibilityMethod('RequestFrames', [input, elapsed, inFlight > 1 ? 1 : batchSize]);
    }

    // a key or button was pressed: remember when, and with 'immediate' input send it right away
    function inputNow() {
        if (!pressTime) pressTime = performance.now();
        if (maxInFlight > 1) requestFrames();
    }

    loadButton.addEventListener('click', function () {
        Microsoft.Dynamics.NAV.InvokeExtensibilityMethod('LoadWadRequested', []);
    });

    // ---------------------------------------------------------------- keyboard
    // browser key -> DOOM key code (see doom_key_t in PureDOOM.h)
    var KEYMAP = {
        'ArrowLeft': 0xac, 'ArrowUp': 0xad, 'ArrowRight': 0xae, 'ArrowDown': 0xaf,
        'Enter': 13, 'Escape': 27, 'Tab': 9, 'Backspace': 127,
        // Space fires (DOOM's CTRL key) so Ctrl+W can't close the browser tab; E is use / open doors
        'Space': 0x80 + 0x1d,
        'ControlLeft': 0x80 + 0x1d, 'ControlRight': 0x80 + 0x1d,
        'ShiftLeft': 0x80 + 0x36, 'ShiftRight': 0x80 + 0x36,   // run
        'AltLeft': 0x80 + 0x38, 'AltRight': 0x80 + 0x38,       // strafe
        'F1': 0x80 + 0x3b, 'F2': 0x80 + 0x3c, 'F3': 0x80 + 0x3d, 'F4': 0x80 + 0x3e,
        'F5': 0x80 + 0x3f, 'F6': 0x80 + 0x40, 'F7': 0x80 + 0x41, 'F8': 0x80 + 0x42,
        'F9': 0x80 + 0x43, 'F10': 0x80 + 0x44, 'F11': 0x80 + 0x57, 'F12': 0x80 + 0x58,
        'Pause': 0xff, 'Minus': 0x2d, 'Equal': 0x3d, 'Comma': 44, 'Period': 46, 'Slash': 47,
        'Semicolon': 59, 'Quote': 39, 'BracketLeft': 91, 'BracketRight': 93, 'NumpadMultiply': 42
    };

    function doomKey(e) {
        if (KEYMAP[e.code] !== undefined) return KEYMAP[e.code];
        if (/^Key[A-Z]$/.test(e.code)) return e.code.charCodeAt(3) + 32;   // 'a'..'z'
        if (/^Digit[0-9]$/.test(e.code)) return e.code.charCodeAt(5);       // '0'..'9'
        return -1;
    }

    function setStatsVisible(visible) {
        showStats = visible;
        fpsBox.style.display = visible ? '' : 'none';
        infoBox.style.display = visible ? '' : 'none';
    }
    setStatsVisible(false);

    canvas.addEventListener('keydown', function (e) {
        initAudio();
        if (e.code === 'End') {
            nextFilter();
            e.preventDefault();
            return;
        }
        if (e.code === 'Backquote') {
            setStatsVisible(!showStats);
            e.preventDefault();
            return;
        }
        if (e.code === 'Home') {
            maxInFlight = maxInFlight > 1 ? 1 : 2;
            e.preventDefault();
            return;
        }
        if (e.code === 'PageUp' || e.code === 'PageDown') {
            batchSize = Math.max(1, Math.min(10, batchSize + (e.code === 'PageUp' ? 1 : -1)));
            e.preventDefault();
            return;
        }
        var k = doomKey(e);
        if (k < 0) return;
        e.preventDefault();
        if (keysDown[k]) return;   // ignore auto repeat
        keysDown[k] = true;
        events.push([0, k]);
        inputNow();
    });
    canvas.addEventListener('keyup', function (e) {
        var k = doomKey(e);
        if (k < 0) return;
        e.preventDefault();
        keysDown[k] = false;
        events.push([1, k]);
    });
    canvas.addEventListener('blur', function () {
        for (var k in keysDown) {
            if (keysDown[k]) events.push([1, parseInt(k, 10)]);
        }
        keysDown = {};
    });

    // ---------------------------------------------------------------- mouse
    canvas.addEventListener('click', function () {
        initAudio();
        canvas.focus();
        if (running && document.pointerLockElement !== canvas && canvas.requestPointerLock) canvas.requestPointerLock();
    });
    document.addEventListener('mousemove', function (e) {
        if (document.pointerLockElement !== canvas) return;
        mouseDX += e.movementX;
        mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', function (e) {
        if (document.pointerLockElement !== canvas) return;
        events.push([3, e.button === 2 ? 1 : (e.button === 1 ? 2 : 0)]);
        inputNow();
        e.preventDefault();
    });
    canvas.addEventListener('mouseup', function (e) {
        if (document.pointerLockElement !== canvas) return;
        events.push([4, e.button === 2 ? 1 : (e.button === 1 ? 2 : 0)]);
        e.preventDefault();
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    Microsoft.Dynamics.NAV.InvokeExtensibilityMethod('ControlReady', []);
}());
