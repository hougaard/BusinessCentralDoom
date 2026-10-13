/// <summary>
/// The DOOM WAD file, deserialized into one record per lump.
/// DOOM reads its lumps (maps, textures, sprites, sounds, ...) from this table.
/// </summary>
table 66600 "DOOM WAD Lump"
{
    Caption = 'DOOM WAD Lump';
    DataClassification = SystemMetadata;
    DataPerCompany = false;

    fields
    {
        field(1; "Lump No."; Integer)
        {
            Caption = 'Lump No.';
        }
        field(2; Name; Text[8])
        {
            Caption = 'Name';
        }
        field(3; "File Position"; Integer)
        {
            Caption = 'File Position';
        }
        field(4; Size; Integer)
        {
            Caption = 'Size';
        }
        field(5; Data; Blob)
        {
            Caption = 'Data';
        }
        field(6; "WAD Type"; Text[4])
        {
            Caption = 'WAD Type';
        }
        field(7; "WAD File"; Text[250])
        {
            Caption = 'WAD File';
        }
    }

    keys
    {
        key(PK; "Lump No.")
        {
            Clustered = true;
        }
    }

    /// <summary>
    /// The sound effect (DS*) and music (D_*) lumps for the control add-in, which plays them itself:
    /// lump number:base64 data, separated by '|'.
    /// </summary>
    procedure GetAudioLumps(): Text
    var
        Lump: Record "DOOM WAD Lump";
        Base64Convert: Codeunit "Base64 Convert";
        Result: TextBuilder;
        InS: InStream;
    begin
        Lump.SetFilter(Name, 'DS*|D_*');
        Lump.SetAutoCalcFields(Data);
        if Lump.FindSet() then
            repeat
                if Lump.Size > 8 then begin
                    Lump.Data.CreateInStream(InS);
                    if Result.Length > 0 then
                        Result.Append('|');
                    Result.Append(Format(Lump."Lump No.", 0, 9));
                    Result.Append(':');
                    Result.Append(Base64Convert.ToBase64(InS));
                end;
            until Lump.Next() = 0;
        exit(Result.ToText());
    end;

    /// <summary>
    /// Imports a WAD that ships with the app as a resource. Resources are limited to 16 MB,
    /// so bigger WADs are stored gzip compressed (.wad.gz).
    /// </summary>
    procedure ImportWadFromResource(ResourceName: Text): Integer
    var
        TempBlob: Codeunit "Temp Blob";
        DataCompression: Codeunit "Data Compression";
        ResIn: InStream;
        OutS: OutStream;
    begin
        NavApp.GetResource(ResourceName, ResIn);
        TempBlob.CreateOutStream(OutS);
        if ResourceName.EndsWith('.gz') then
            DataCompression.GZipDecompress(ResIn, OutS)
        else
            CopyStream(OutS, ResIn);
        exit(ImportWad(TempBlob, ResourceName));
    end;

    /// <summary>Imports a WAD file that arrives as a list of base64 encoded chunks.</summary>
    procedure ImportWadFromBase64(Chunks: List of [Text]; WadFile: Text): Integer
    var
        Base64Convert: Codeunit "Base64 Convert";
        TempBlob: Codeunit "Temp Blob";
        OutS: OutStream;
        Chunk: Text;
    begin
        TempBlob.CreateOutStream(OutS);
        foreach Chunk in Chunks do
            Base64Convert.FromBase64(Chunk, OutS);
        exit(ImportWad(TempBlob, WadFile));
    end;

    /// <summary>
    /// Deserializes a WAD file into the table.
    /// WAD layout: header (id, number of lumps, directory offset), lump data, directory of
    /// 16 byte entries (file position, size, 8 character name).
    /// The table holds one WAD at a time: importing replaces the previous one. WadFile names it.
    /// </summary>
    procedure ImportWad(var TempBlob: Codeunit "Temp Blob"; WadFile: Text): Integer
    var
        Lump: Record "DOOM WAD Lump";
        InS: InStream;
        LumpOut: OutStream;
        Id: Text[4];
        NumLumps: Integer;
        DirOffset: Integer;
        Positions: List of [Integer];
        Sizes: List of [Integer];
        Names: List of [Text];
        CurPos: Integer;
        i: Integer;
    begin
        if TempBlob.Length() < 12 then
            Error('This is not a WAD file.');
        TempBlob.CreateInStream(InS);
        Id := ReadText(InS, 4);
        if (Id <> 'IWAD') and (Id <> 'PWAD') then
            Error('This is not a WAD file (header is "%1").', Id);
        NumLumps := ReadInt32(InS);
        DirOffset := ReadInt32(InS);
        Skip(InS, DirOffset - 12);
        for i := 1 to NumLumps do begin
            Positions.Add(ReadInt32(InS));
            Sizes.Add(ReadInt32(InS));
            Names.Add(ReadText(InS, 8));
        end;

        Lump.DeleteAll();
        TempBlob.CreateInStream(InS);
        CurPos := 0;
        for i := 1 to NumLumps do begin
            Lump.Init();
            Lump."Lump No." := i - 1;
            Lump.Name := CopyStr(Names.Get(i), 1, MaxStrLen(Lump.Name));
            Lump."File Position" := Positions.Get(i);
            Lump.Size := Sizes.Get(i);
            Lump."WAD Type" := Id;
            Lump."WAD File" := CopyStr(WadFile, 1, MaxStrLen(Lump."WAD File"));
            if Lump.Size > 0 then begin
                if Lump."File Position" < CurPos then begin
                    TempBlob.CreateInStream(InS);
                    CurPos := 0;
                end;
                Skip(InS, Lump."File Position" - CurPos);
                Lump.Data.CreateOutStream(LumpOut);
                CopyStream(LumpOut, InS, Lump.Size);
                CurPos := Lump."File Position" + Lump.Size;
            end;
            Lump.Insert();
        end;
        exit(NumLumps);
    end;

    /// <summary>True when the table holds the given WAD (empty WadFile: any WAD).</summary>
    procedure IsWadImported(WadFile: Text): Boolean
    var
        Lump: Record "DOOM WAD Lump";
    begin
        if WadFile <> '' then
            Lump.SetRange("WAD File", WadFile);
        exit(not Lump.IsEmpty());
    end;

    local procedure ReadInt32(var InS: InStream): Integer
    var
        b: array[4] of Byte;
        Top: Integer;
        i: Integer;
    begin
        for i := 1 to 4 do
            InS.Read(b[i]);
        Top := b[4];
        if Top >= 128 then
            Top -= 256;
        exit(b[1] + 256 * (b[2] + 256 * (b[3] + 256 * Top)));
    end;

    local procedure ReadText(var InS: InStream; Length: Integer): Text
    var
        TB: TextBuilder;
        b: Byte;
        ch: Char;
        i: Integer;
        Ended: Boolean;
    begin
        for i := 1 to Length do begin
            InS.Read(b);
            if b = 0 then
                Ended := true;
            if not Ended then begin
                ch := b;
                TB.Append(ch);
            end;
        end;
        exit(TB.ToText());
    end;

    local procedure Skip(var InS: InStream; Count: Integer)
    var
        TempBlob: Codeunit "Temp Blob";
        Dummy: OutStream;
    begin
        if Count <= 0 then
            exit;
        TempBlob.CreateOutStream(Dummy);
        CopyStream(Dummy, InS, Count);
    end;
}
