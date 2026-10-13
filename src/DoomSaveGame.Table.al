/// <summary>
/// DOOM save games. DOOM's save slots (doomsav0.dsg .. doomsav5.dsg) are stored per game (WAD file)
/// and user, so they survive between playing sessions. The "DOOM Engine" codeunit reads and writes them.
/// </summary>
table 66601 "DOOM Save Game"
{
    Caption = 'DOOM Save Game';
    DataClassification = CustomerContent;
    DataPerCompany = false;
    LookupPageId = "DOOM Save Games";
    DrillDownPageId = "DOOM Save Games";

    fields
    {
        field(1; Game; Text[250])
        {
            Caption = 'Game (WAD file)';
        }
        field(2; "User ID"; Code[50])
        {
            Caption = 'User ID';
            DataClassification = EndUserIdentifiableInformation;
        }
        field(3; "Slot No."; Integer)
        {
            Caption = 'Slot No.';
        }
        field(4; Description; Text[24])
        {
            Caption = 'Description';
        }
        field(5; Level; Text[10])
        {
            Caption = 'Level';
        }
        field(6; Skill; Option)
        {
            Caption = 'Skill';
            OptionMembers = Baby,Easy,Medium,Hard,Nightmare;
            OptionCaption = 'I''m too young to die,Hey not too rough,Hurt me plenty,Ultra-Violence,Nightmare!';
        }
        field(7; "Saved At"; DateTime)
        {
            Caption = 'Saved At';
        }
        field(8; Size; Integer)
        {
            Caption = 'Size (bytes)';
        }
        field(9; Data; Blob)
        {
            Caption = 'Data';
        }
    }

    keys
    {
        key(PK; Game, "User ID", "Slot No.")
        {
            Clustered = true;
        }
    }
}
