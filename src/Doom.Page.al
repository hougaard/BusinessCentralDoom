/// <summary>
/// Plays DOOM. The page hosts the "DOOM Screen" control add-in: it receives input events from the
/// add-in, runs the "DOOM Engine" codeunit for one frame and sends the rendered frame back.
/// </summary>
page 66600 "DOOM"
{
    PageType = UserControlHost;
    Caption = 'DOOM';
    ApplicationArea = All;
    UsageCategory = Tasks;

    layout
    {
        area(Content)
        {
            usercontrol(Screen; "DOOM Screen")
            {
                ApplicationArea = All;

                trigger ControlReady()
                begin
                    StartDoom();
                end;

                trigger LoadWadRequested()
                begin
                    ImportWad();
                    StartDoom();
                end;

                trigger RequestFrames(Input: Text; ElapsedMs: Integer; FrameCount: Integer)
                var
                    T0: DateTime;
                    T1: DateTime;
                    Frames: TextBuilder;
                    FrameMs: Integer;
                    i: Integer;
                begin
                    T0 := CurrentDateTime;
                    ApplyInput(Input);
                    if FrameCount < 1 then
                        FrameCount := 1;
                    // DOOM runs at 35 tics per second. When a frame takes longer than ~3 tics,
                    // the game slows down instead of skipping more tics per frame.
                    FrameMs := ElapsedMs div FrameCount;
                    if FrameMs > MaxElapsedMs then
                        FrameMs := MaxElapsedMs;
                    for i := 1 to FrameCount do begin
                        T1 := CurrentDateTime;
                        Doom.Tick(FrameMs);
                        TickMs += CurrentDateTime - T1;
                        if Doom.IsQuitRequested() then begin
                            // the player quit DOOM from the menu (the settings are stored)
                            CurrPage.Close();
                            exit;
                        end;
                        T1 := CurrentDateTime;
                        if i > 1 then
                            Frames.Append(';');
                        Frames.Append(Doom.GetPaletteIfChanged());
                        Frames.Append('!');
                        Frames.Append(Doom.GetFrameDelta());
                        Frames.Append('!');
                        Frames.Append(Doom.GetSoundEvents());
                        EncodeMs += CurrentDateTime - T1;
                        FrameCount_ += 1;
                    end;
                    if FrameCount_ >= 30 then begin
                        CurrPage.Screen.ShowInfo(StrSubstNo('per frame: tick %1ms, encode %2ms || %3',
                            Round(TickMs / FrameCount_, 0.1), Round(EncodeMs / FrameCount_, 0.1), BenchmarkText));
                        FrameCount_ := 0;
                        TickMs := 0;
                        EncodeMs := 0;
                    end;
                    CurrPage.Screen.DrawFrames(Frames.ToText(), CurrentDateTime - T0);
                end;
            }
        }
    }

    var
        Doom: Codeunit "DOOM Engine";
        MaxElapsedMs: Integer;
        FrameCount_: Integer;
        TickMs: Decimal;
        EncodeMs: Decimal;
        BenchmarkText: Text;
        WadFile: Text;
        WadMenuTxt: Label 'DOOM - shareware episode 1,Freedoom: Phase 1 - free with 4 episodes,Freedoom: Phase 2 - free Doom II compatible', Comment = 'StrMenu options: commas separate the options';
        ChooseWadTxt: Label 'Which game do you want to play?';
        ImportingTxt: Label 'Importing #1################## into the WAD table...', Comment = '#1 = WAD file name';

    trigger OnOpenPage()
    begin
        MaxElapsedMs := 86;
        // the WADs that ship with the app as resources (Freedoom: https://freedoom.github.io, see freedoom-COPYING.txt)
        case StrMenu(WadMenuTxt, 1, ChooseWadTxt) of
            0:
                Error('');
            1:
                WadFile := 'doom1.wad';
            2:
                WadFile := 'freedoom1.wad.gz';
            3:
                WadFile := 'freedoom2.wad.gz';
        end;
    end;

    local procedure StartDoom()
    var
        WadLump: Record "DOOM WAD Lump";
        T0: DateTime;
    begin
        if not WadLump.IsWadImported(WadFile) then
            // deserialize the chosen WAD into the WAD table (replaces the WAD imported before)
            ImportWadFromResource(WadFile);
        if not Doom.IsInitialized() then begin
            T0 := CurrentDateTime;
            Doom.SetGame(WadFile); // save games are stored per game
            Doom.Initialize();
            BenchmarkText := StrSubstNo('init %1 | %2', CurrentDateTime - T0, Doom.RunBenchmark());
            CurrPage.Screen.ShowInfo(BenchmarkText);
        end;
        // the add-in plays sound and music itself: send it the sound effects and songs of the WAD
        CurrPage.Screen.LoadAudio(WadLump.GetAudioLumps());
        Doom.GetSoundEvents(); // drop sounds from before the screen was (re)loaded
        // the screen may have been (re)loaded: send a complete first frame, with the music that should be playing
        Doom.ResetFrameDelta();
        CurrPage.Screen.DrawFrames(Doom.GetPaletteIfChanged() + '!' + Doom.GetFrameDelta() + '!' + Doom.GetMusicState(), 0);
        CurrPage.Screen.Start();
    end;

    local procedure ImportWadFromResource(ResourceName: Text)
    var
        WadLump: Record "DOOM WAD Lump";
        Window: Dialog;
    begin
        Window.Open(ImportingTxt, ResourceName);
        WadLump.ImportWadFromResource(ResourceName);
        Window.Close();
    end;

    local procedure ImportWad()
    var
        WadLump: Record "DOOM WAD Lump";
        TempBlob: Codeunit "Temp Blob";
        InS: InStream;
        OutS: OutStream;
        FileName: Text;
        Lumps: Integer;
    begin
        if not UploadIntoStream('Import DOOM WAD file', '', 'WAD files (*.wad)|*.wad|All files (*.*)|*.*', FileName, InS) then
            exit;
        TempBlob.CreateOutStream(OutS);
        CopyStream(OutS, InS);
        Lumps := WadLump.ImportWad(TempBlob, FileName);
        WadFile := FileName;
        Message('%1 imported: %2 lumps.', FileName, Lumps);
    end;

    local procedure ApplyInput(Input: Text)
    var
        Events: JsonArray;
        EventToken: JsonToken;
        Values: JsonArray;
        EventType: Integer;
    begin
        if (Input = '') or (Input = '[]') then
            exit;
        if not Events.ReadFrom(Input) then
            exit;
        foreach EventToken in Events do begin
            Values := EventToken.AsArray();
            EventType := GetInt(Values, 0);
            case EventType of
                0:
                    Doom.KeyDown(GetInt(Values, 1));
                1:
                    Doom.KeyUp(GetInt(Values, 1));
                2:
                    Doom.MouseMove(GetInt(Values, 1), GetInt(Values, 2));
                3:
                    Doom.MouseButtonDown(GetInt(Values, 1));
                4:
                    Doom.MouseButtonUp(GetInt(Values, 1));
            end;
        end;
    end;

    local procedure GetInt(Values: JsonArray; Index: Integer): Integer
    var
        Token: JsonToken;
    begin
        Values.Get(Index, Token);
        exit(Token.AsValue().AsInteger());
    end;
}
