// WebGL renderer for the DOOM screen: draws the 320x200 frame at the canvas' real display resolution
// through a choice of upscaling shaders. doomCreateRenderer returns null when WebGL is not available.
var doomCreateRenderer = (function () {
    'use strict';

    var VERTEX =
        'attribute vec2 pos;' +
        'varying vec2 uv;' +
        'void main() { uv = vec2(pos.x + 1.0, 1.0 - pos.y) * 0.5; gl_Position = vec4(pos, 0.0, 1.0); }';

    var COMMON =
        'precision mediump float;' +
        'uniform sampler2D tex;' +
        'uniform vec2 texSize;' +
        'uniform vec2 outSize;' +
        'varying vec2 uv;' +
        // one source pixel, exactly (sampled at its center)
        'vec3 fetch(vec2 p) { return texture2D(tex, (p + 0.5) / texSize).rgb; }' +
        // "sharp bilinear": scale up by the largest whole factor with hard pixels, then blend only the
        // seams between pixels. Crisp, but without the uneven pixel widths of plain nearest scaling.
        'vec3 sharp(vec2 coord) {' +
        '  vec2 texel = coord * texSize;' +
        '  vec2 scale = max(floor(outSize / texSize), vec2(1.0));' +
        '  vec2 center = fract(texel) - 0.5;' +
        '  vec2 range = 0.5 - 0.5 / scale;' +
        '  vec2 f = (center - clamp(center, -range, range)) * scale + 0.5;' +
        '  return texture2D(tex, (floor(texel) + f) / texSize).rgb;' +
        '}' +
        'bool same(vec3 a, vec3 b) { return all(lessThan(abs(a - b), vec3(0.002))); }';

    var MODES = [
        {
            name: 'Pixels',
            shader: 'void main() { gl_FragColor = vec4(fetch(floor(uv * texSize)), 1.0); }'
        },
        {
            name: 'Sharp',
            shader: 'void main() { gl_FragColor = vec4(sharp(uv), 1.0); }'
        },
        {
            name: 'Smooth',
            shader: 'void main() { gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0); }'
        },
        {
            // Scale2x (EPX): each pixel becomes 2x2, corners take a neighbour's color along diagonal edges
            name: 'Scale2x',
            shader:
                'void main() {' +
                '  vec2 t = uv * texSize;' +
                '  vec2 p = floor(t);' +
                '  vec2 f = fract(t);' +
                '  vec3 P = fetch(p);' +
                '  vec3 A = fetch(p + vec2(0.0, -1.0));' +
                '  vec3 B = fetch(p + vec2(1.0, 0.0));' +
                '  vec3 C = fetch(p + vec2(-1.0, 0.0));' +
                '  vec3 D = fetch(p + vec2(0.0, 1.0));' +
                '  vec3 col = P;' +
                '  if (f.x < 0.5 && f.y < 0.5) { if (same(C, A) && !same(C, D) && !same(A, B)) col = A; }' +
                '  else if (f.y < 0.5) { if (same(A, B) && !same(A, C) && !same(B, D)) col = B; }' +
                '  else if (f.x < 0.5) { if (same(D, C) && !same(D, B) && !same(C, A)) col = C; }' +
                '  else { if (same(B, D) && !same(B, A) && !same(D, C)) col = D; }' +
                '  gl_FragColor = vec4(col, 1.0);' +
                '}'
        },
        {
            // an old monitor: slightly curved glass, scanlines, an aperture grille and darker corners
            name: 'CRT',
            shader:
                'void main() {' +
                '  vec2 c = uv * 2.0 - 1.0;' +
                '  c *= 1.0 + vec2(0.035, 0.05) * (c.yx * c.yx);' +
                '  vec2 cuv = c * 0.5 + 0.5;' +
                '  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }' +
                '  vec3 col = sharp(cuv);' +
                '  float line = abs(fract(cuv.y * texSize.y) - 0.5) * 2.0;' +
                '  col *= 1.0 - 0.5 * line * line;' +
                '  float m = mod(gl_FragCoord.x, 3.0);' +
                '  col *= m < 1.0 ? vec3(1.0, 0.8, 0.8) : (m < 2.0 ? vec3(0.8, 1.0, 0.8) : vec3(0.8, 0.8, 1.0));' +
                '  col *= 1.35 * (1.0 - 0.18 * dot(c, c));' +
                '  gl_FragColor = vec4(col, 1.0);' +
                '}'
        }
    ];

    function compile(gl, type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error('shader: ' + gl.getShaderInfoLog(shader));
        return shader;
    }

    function program(gl, fragment) {
        var p = gl.createProgram();
        gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, COMMON + fragment));
        gl.bindAttribLocation(p, 0, 'pos');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw new Error('program: ' + gl.getProgramInfoLog(p));
        return {
            program: p,
            texSize: gl.getUniformLocation(p, 'texSize'),
            outSize: gl.getUniformLocation(p, 'outSize'),
            tex: gl.getUniformLocation(p, 'tex')
        };
    }

    return function (canvas, width, height) {
        var gl;
        var programs = [];
        try {
            gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
            if (!gl) return null;
            for (var i = 0; i < MODES.length; i++) programs.push(program(gl, MODES[i].shader));
        } catch (e) {
            if (window.console) console.warn('DOOM: WebGL renderer not available, using the 2D canvas', e);
            return null;
        }

        // a quad covering the canvas
        var buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // the frame as an RGBA texture, linear filtering (the shaders sample pixel centers for hard pixels)
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        var mode = 1;

        function render() {
            var p = programs[mode];
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.useProgram(p.program);
            gl.uniform1i(p.tex, 0);
            gl.uniform2f(p.texSize, width, height);
            gl.uniform2f(p.outSize, canvas.width, canvas.height);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        return {
            modes: MODES.map(function (m) { return m.name; }),
            get mode() { return mode; },
            set mode(m) { mode = ((m % MODES.length) + MODES.length) % MODES.length; render(); },
            // rgba: width * height * 4 bytes
            draw: function (rgba) {
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
                render();
            },
            // the canvas is cssWidth x cssHeight on screen: render at the real device pixels
            resize: function (cssWidth, cssHeight) {
                var dpr = window.devicePixelRatio || 1;
                canvas.width = Math.max(1, Math.round(cssWidth * dpr));
                canvas.height = Math.max(1, Math.round(cssHeight * dpr));
                render();
            }
        };
    };
}());
