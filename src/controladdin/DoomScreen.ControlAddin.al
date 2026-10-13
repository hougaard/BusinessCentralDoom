/// <summary>
/// Displays DOOM frames (320x200, palette indexed) and sends keyboard and mouse input back to Business Central.
/// </summary>
controladdin "DOOM Screen"
{
    Scripts = 'src/controladdin/mus2mid.js', 'src/controladdin/screen.js';
    StartupScript = 'src/controladdin/doom.js';
    StyleSheets = 'src/controladdin/doom.css';
    RequestedHeight = 640;
    MinimumHeight = 300;
    RequestedWidth = 800;
    MinimumWidth = 320;
    VerticalStretch = true;
    VerticalShrink = true;
    HorizontalStretch = true;
    HorizontalShrink = true;

    /// <summary>The add-in is loaded and ready.</summary>
    event ControlReady();

    /// <summary>
    /// Asks for the next batch of frames. Input is a JSON array of input events since the last request:
    /// [0,key] key down, [1,key] key up, [2,dx,dy] mouse move, [3,button] button down, [4,button] button up.
    /// ElapsedMs is the wall clock time since the previous request, FrameCount the number of frames to render.
    /// </summary>
    event RequestFrames(Input: Text; ElapsedMs: Integer; FrameCount: Integer);

    /// <summary>The user wants to import a WAD file.</summary>
    event LoadWadRequested();

    /// <summary>
    /// Plays a batch of frames, separated by ';'. Each frame is "palette!rows!sounds": palette is empty or the base64
    /// RGB palette, rows is base64 of the changed rows (row number byte + 320 palette indexes per row),
    /// sounds are the sound events of the frame (see "DOOM Engine".GetSoundEvents).
    /// ServerMs is the time the server spent producing the batch.
    /// </summary>
    procedure DrawFrames(Frames: Text; ServerMs: Integer);

    /// <summary>Shows a small diagnostics text (timings) in the corner of the screen.</summary>
    procedure ShowInfo(Info: Text);

    /// <summary>Shows a status text over the screen. ShowLoadButton shows the import WAD button.</summary>
    procedure ShowStatus(Message: Text; ShowLoadButton: Boolean);

    /// <summary>
    /// The sound effect and music lumps of the WAD: lump number:base64 data, separated by '|'.
    /// The add-in plays them itself when the frames contain sound events. Music is played with
    /// spessasynth (spessasynth_core) and a General MIDI sound font, loaded from the jsDelivr CDN.
    /// </summary>
    procedure LoadAudio(Lumps: Text);

    /// <summary>Starts the frame loop.</summary>
    procedure Start();
}
