// Converts DOOM's MUS music lumps to standard MIDI files (based on mus2mid from Chocolate Doom).
// MUS: 140 ticks per second, 16 channels where channel 15 is percussion.
var doomMusToMidi = (function () {
    'use strict';

    // MUS controller numbers -> MIDI controllers (0 = program change is handled separately)
    var CONTROLLERS = [0x00, 0x20, 0x01, 0x07, 0x0A, 0x0B, 0x5B, 0x5D, 0x40, 0x43, 0x78, 0x7B, 0x7E, 0x7F, 0x79];

    return function (mus) {
        if (mus.length < 16 || mus[0] !== 0x4D || mus[1] !== 0x55 || mus[2] !== 0x53 || mus[3] !== 0x1A) return null;
        var pos = mus[6] | (mus[7] << 8);   // score start
        var track = [];
        var delay = 0;                       // ticks since the previous MIDI event
        var channelMap = [];
        var velocities = [];
        var nextChannel = 0;
        var i;
        for (i = 0; i < 16; i++) { channelMap[i] = -1; velocities[i] = 127; }

        function writeDelay() {
            var buffer = delay & 0x7F;
            while ((delay >>= 7)) { buffer <<= 8; buffer |= ((delay & 0x7F) | 0x80); }
            for (; ;) {
                track.push(buffer & 0xFF);
                if (buffer & 0x80) buffer >>= 8; else break;
            }
            delay = 0;
        }

        function event(status, a, b) {
            writeDelay();
            track.push(status, a & 0x7F);
            if (b !== undefined) track.push(b & 0x7F);
        }

        function midiChannel(musChannel) {
            if (musChannel === 15) return 9;   // percussion
            if (channelMap[musChannel] < 0) {
                channelMap[musChannel] = nextChannel++;
                if (channelMap[musChannel] === 9) channelMap[musChannel] = nextChannel++;
                // first use of the channel: reset its volume
                event(0xB0 | channelMap[musChannel], 0x07, 127);
            }
            return channelMap[musChannel];
        }

        var done = false;
        while (!done && pos < mus.length) {
            var descriptor = mus[pos++];
            var ch = midiChannel(descriptor & 0x0F);
            var key, value;
            switch (descriptor & 0x70) {
                case 0x00:   // release note
                    event(0x80 | ch, mus[pos++], 0);
                    break;
                case 0x10:   // play note, optionally with a new volume
                    key = mus[pos++];
                    if (key & 0x80) velocities[ch] = mus[pos++] & 0x7F;
                    event(0x90 | ch, key, velocities[ch]);
                    break;
                case 0x20:   // pitch wheel, 0..255 with 128 = center
                    value = mus[pos++] * 64;
                    event(0xE0 | ch, value & 0x7F, (value >> 7) & 0x7F);
                    break;
                case 0x30:   // system event
                    key = mus[pos++];
                    if (key >= 10 && key <= 14) event(0xB0 | ch, CONTROLLERS[key], 0);
                    break;
                case 0x40:   // change controller
                    key = mus[pos++];
                    value = Math.min(mus[pos++], 127);
                    if (key === 0) {
                        writeDelay();
                        track.push(0xC0 | ch, value);
                    } else if (key < 10) {
                        event(0xB0 | ch, CONTROLLERS[key], value);
                    }
                    break;
                case 0x50:   // end of measure
                    break;
                case 0x60:   // score end
                    done = true;
                    break;
                default:     // unused event with one data byte
                    pos++;
                    break;
            }
            if (descriptor & 0x80) {
                // time until the next event (variable length)
                var time = 0, b;
                do {
                    b = mus[pos++];
                    time = time * 128 + (b & 0x7F);
                } while ((b & 0x80) && pos < mus.length);
                delay += time;
            }
        }
        // end of track
        writeDelay();
        track.push(0xFF, 0x2F, 0x00);

        // format 0, one track, 70 ticks per quarter note at the default 120 bpm = 140 ticks per second
        var header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 70,
            0x4D, 0x54, 0x72, 0x6B, (track.length >>> 24) & 0xFF, (track.length >>> 16) & 0xFF, (track.length >>> 8) & 0xFF, track.length & 0xFF];
        var midi = new Uint8Array(header.length + track.length);
        midi.set(header, 0);
        midi.set(track, header.length);
        return midi.buffer;
    };
}());

if (typeof module !== 'undefined') module.exports = doomMusToMidi;
